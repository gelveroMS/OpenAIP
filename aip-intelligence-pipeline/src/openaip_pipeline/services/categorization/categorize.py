from __future__ import annotations

import json
import os
import time
from collections import deque
from typing import Any, Callable, Literal

from openai import OpenAI
from pydantic import BaseModel, Field, field_validator

from openaip_pipeline.core.artifact_contract import (
    SCHEMA_VERSION,
    infer_sector_code,
    make_stage_root,
    normalize_category,
)
from openaip_pipeline.core.clock import now_utc_iso
from openaip_pipeline.core.resources import read_text
from openaip_pipeline.services.chunking.context_window import (
    chunk_items_by_token_budget,
    estimate_tokens_from_text,
    is_context_limit_error,
    sum_usage,
)
from openaip_pipeline.services.openai_utils import build_openai_client, safe_usage_dict


Category = Literal["Infrastructure", "Healthcare", "Other", "infrastructure", "health", "other"]


class ProjectForCategorization(BaseModel):
    aip_ref_code: str | None = None
    program_project_description: str | None = None
    implementing_agency: str | None = None
    expected_output: str | None = None
    source_of_funds: str | None = None


class CategorizedItem(BaseModel):
    index: int
    category: Category


class CategorizationResponse(BaseModel):
    items: list[CategorizedItem] = Field(default_factory=list)

    @field_validator("items")
    @classmethod
    def _unique_indices(cls, value: list[CategorizedItem]) -> list[CategorizedItem]:
        indices = [item.index for item in value]
        if len(set(indices)) != len(indices):
            raise ValueError("Duplicate indices in categorization response.")
        return value


class CategorizationResult:
    def __init__(
        self,
        categorized_obj: dict[str, Any],
        categorized_json_str: str,
        usage: dict[str, Any],
        elapsed_seconds: float,
        model: str,
    ):
        self.categorized_obj = categorized_obj
        self.categorized_json_str = categorized_json_str
        self.usage = usage
        self.elapsed_seconds = elapsed_seconds
        self.model = model


def _read_positive_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        parsed = int(raw.strip())
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _truncate_text(value: Any, char_limit: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[: max(1, char_limit)]


def _build_classification_text(project: ProjectForCategorization) -> str:
    parts: list[str] = []
    if project.aip_ref_code:
        parts.append(f"RefCode: {project.aip_ref_code}")
    if project.program_project_description:
        parts.append(f"Description: {project.program_project_description}")
    if project.implementing_agency:
        parts.append(f"ImplementingAgency: {project.implementing_agency}")
    if project.expected_output:
        parts.append(f"ExpectedOutput: {project.expected_output}")
    if project.source_of_funds:
        parts.append(f"SourceOfFunds: {project.source_of_funds}")
    return "\n".join(parts).strip() or "No details provided."


def _build_user_text(item_texts: list[str]) -> str:
    numbered = [f"ITEM {idx}\n{text}" for idx, text in enumerate(item_texts)]
    return "Items:\n\n" + "\n\n---\n\n".join(numbered)


def _build_chunk_estimate_payload(
    static_payload: dict[str, Any],
    chunk_indices: list[int],
    item_texts: list[str],
) -> dict[str, Any]:
    chunk_texts = [item_texts[index] for index in chunk_indices]
    return {
        **static_payload,
        "user_text": _build_user_text(chunk_texts),
    }


def categorize_batch(
    *,
    batch: list[ProjectForCategorization],
    model: str,
    client: OpenAI,
    batch_no: int | None = None,
    total_batches: int | None = None,
) -> tuple[CategorizationResponse, dict[str, Any]]:
    user_text = _build_user_text([_build_classification_text(project) for project in batch])
    system_prompt = read_text("prompts/categorization/system.txt")
    response = client.responses.parse(
        model=model,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        text_format=CategorizationResponse,
        temperature=0,
    )
    parsed: CategorizationResponse = response.output_parsed
    usage = safe_usage_dict(response)
    tag = ""
    if batch_no is not None and total_batches is not None:
        tag = f" chunk={batch_no}/{total_batches}"
    print(f"[CATEGORIZATION]{tag} count={len(batch)}", flush=True)
    return parsed, usage


def categorize_all_projects(
    *,
    projects_raw: list[dict[str, Any]],
    model: str,
    batch_size: int | None,
    on_progress: Callable[[int, int, int, int], None] | None,
    client: OpenAI,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if batch_size is not None and batch_size <= 0:
        raise ValueError("batch_size must be >= 1 when provided.")

    total = len(projects_raw)
    if total == 0:
        return projects_raw, {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

    categorize_context_window_tokens = _read_positive_int_env(
        "PIPELINE_CATEGORIZE_CONTEXT_WINDOW_TOKENS", 128000
    )
    categorize_response_buffer_tokens = _read_positive_int_env(
        "PIPELINE_CATEGORIZE_RESPONSE_BUFFER_TOKENS", 2000
    )
    categorize_project_field_char_limit = _read_positive_int_env(
        "PIPELINE_CATEGORIZE_PROJECT_FIELD_CHAR_LIMIT", 500
    )
    minimal = [
        ProjectForCategorization(
            aip_ref_code=_truncate_text(row.get("aip_ref_code"), categorize_project_field_char_limit),
            program_project_description=_truncate_text(
                row.get("program_project_description"),
                categorize_project_field_char_limit,
            ),
            implementing_agency=_truncate_text(
                row.get("implementing_agency"),
                categorize_project_field_char_limit,
            ),
            expected_output=_truncate_text(row.get("expected_output"), categorize_project_field_char_limit),
            source_of_funds=_truncate_text(
                row.get("source_of_funds"),
                categorize_project_field_char_limit,
            ),
        )
        for row in projects_raw
    ]
    item_texts = [_build_classification_text(project) for project in minimal]
    static_payload = {"stage": "categorization"}
    system_prompt = read_text("prompts/categorization/system.txt")
    prompt_tokens = estimate_tokens_from_text(system_prompt + "\nItems:\n\n")
    input_budget_tokens = max(
        1024,
        categorize_context_window_tokens
        - categorize_response_buffer_tokens
        - prompt_tokens,
    )

    initial_chunks = chunk_items_by_token_budget(
        items=list(range(total)),
        static_payload=static_payload,
        add_item_fn=lambda payload, chunk: _build_chunk_estimate_payload(
            payload, chunk, item_texts
        ),
        budget_tokens=input_budget_tokens,
        max_items_per_chunk=batch_size,
    )
    chunk_queue: deque[list[int]] = deque(initial_chunks)
    total_chunks_planned = len(initial_chunks)
    completed_chunks = 0
    done_projects = 0
    chunk_usages: list[dict[str, Any]] = []

    while chunk_queue:
        chunk_indices = chunk_queue.popleft()
        chunk_size = len(chunk_indices)
        if chunk_size == 0:
            continue

        try:
            parsed, usage = categorize_batch(
                batch=[minimal[index] for index in chunk_indices],
                model=model,
                client=client,
                batch_no=completed_chunks + 1,
                total_batches=total_chunks_planned,
            )
        except Exception as error:
            if not is_context_limit_error(error):
                raise
            if chunk_size <= 1:
                index = chunk_indices[0]
                ref_code = str(projects_raw[index].get("aip_ref_code") or "").strip()
                raise RuntimeError(
                    (
                        "Categorization chunk exceeds model context window for a single project. "
                        f"index={index} aip_ref_code={ref_code or 'unknown'}"
                    )
                ) from error
            midpoint = chunk_size // 2
            left_chunk = chunk_indices[:midpoint]
            right_chunk = chunk_indices[midpoint:]
            chunk_queue.appendleft(right_chunk)
            chunk_queue.appendleft(left_chunk)
            total_chunks_planned += 1
            continue

        idx_to_cat = {item.index: normalize_category(item.category) for item in parsed.items}
        out_of_range_indices = [index for index in idx_to_cat if index < 0 or index >= chunk_size]
        if out_of_range_indices:
            raise RuntimeError(
                (
                    "Invalid categorization response indices for chunk: "
                    f"indices={out_of_range_indices} chunk_size={chunk_size}"
                )
            )
        for local_idx, global_idx in enumerate(chunk_indices):
            row = projects_raw[global_idx]
            classification = row.get("classification") if isinstance(row.get("classification"), dict) else {}
            classification["category"] = idx_to_cat.get(local_idx, "other")
            classification["sector_code"] = infer_sector_code(row.get("aip_ref_code"))
            row["classification"] = classification

        chunk_usages.append(usage)
        done_projects += chunk_size
        completed_chunks += 1
        if on_progress:
            on_progress(
                min(done_projects, total),
                total,
                completed_chunks,
                total_chunks_planned,
            )

    return projects_raw, sum_usage(chunk_usages)


def _fallback_document() -> dict[str, Any]:
    year = int(now_utc_iso()[:4])
    return {
        "lgu": {"name": "Unknown LGU", "type": "unknown"},
        "fiscal_year": year,
        "source": {"document_type": "unknown", "page_count": None},
    }


def categorize_from_summarized_json_str(
    summarized_json_str: str,
    model: str = "gpt-5.2",
    batch_size: int | None = 25,
    heartbeat_seconds: float = 10.0,
    on_progress: Callable[[int, int, int, int], None] | None = None,
    client: OpenAI | None = None,
) -> CategorizationResult:
    try:
        doc = json.loads(summarized_json_str)
    except json.JSONDecodeError as error:
        raise ValueError(f"Input is not valid JSON string: {error}") from error
    projects = doc.get("projects", [])
    if not isinstance(projects, list):
        raise ValueError("Invalid input: top-level 'projects' must be a list.")
    resolved_client = client or build_openai_client()
    started = time.perf_counter()
    last_beat = started

    def beat(message: str) -> None:
        nonlocal last_beat
        now = time.perf_counter()
        if now - last_beat >= heartbeat_seconds:
            print(f"[CATEGORIZATION] {message}", flush=True)
            last_beat = now

    beat("Starting categorization")
    updated_projects, usage = categorize_all_projects(
        projects_raw=projects,
        model=model,
        batch_size=batch_size,
        on_progress=on_progress,
        client=resolved_client,
    )
    elapsed = round(time.perf_counter() - started, 4)
    categorized = make_stage_root(
        stage="categorize",
        aip_id=str(doc.get("aip_id") or "unknown-aip"),
        uploaded_file_id=str(doc.get("uploaded_file_id")) if doc.get("uploaded_file_id") else None,
        document=doc.get("document") if isinstance(doc.get("document"), dict) else _fallback_document(),
        projects=updated_projects,
        totals=doc.get("totals") if isinstance(doc.get("totals"), list) else [],
        summary=doc.get("summary") if isinstance(doc.get("summary"), dict) else None,
        warnings=doc.get("warnings") if isinstance(doc.get("warnings"), list) else [],
        quality=doc.get("quality") if isinstance(doc.get("quality"), dict) else None,
        generated_at=now_utc_iso(),
        schema_version=str(doc.get("schema_version") or SCHEMA_VERSION),
    )
    return CategorizationResult(
        categorized_obj=categorized,
        categorized_json_str=json.dumps(categorized, ensure_ascii=False, indent=2),
        usage=usage,
        elapsed_seconds=elapsed,
        model=model,
    )


def write_categorized_json_file(categorized_json_str: str, out_path: str) -> str:
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as file_handle:
        file_handle.write(categorized_json_str)
    return out_path
