from __future__ import annotations

import json
import os
import time
from typing import Any

from openai import OpenAI

from openaip_pipeline.core.artifact_contract import (
    SCHEMA_VERSION,
    collect_summary_evidence,
    make_stage_root,
    normalize_source_refs,
)
from openaip_pipeline.core.clock import now_utc_iso
from openaip_pipeline.core.resources import read_text
from openaip_pipeline.services.openai_utils import build_openai_client, safe_usage_dict


class SummarizationResult:
    def __init__(
        self,
        summary_text: str,
        summary_obj: dict[str, Any],
        summary_json_str: str,
        usage: dict[str, Any],
        elapsed_seconds: float,
        model: str,
    ):
        self.summary_text = summary_text
        self.summary_obj = summary_obj
        self.summary_json_str = summary_json_str
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


def _compact_source_ref(ref: dict[str, Any], char_limit: int) -> dict[str, Any]:
    return {
        "page": ref.get("page"),
        "kind": ref.get("kind"),
        "evidence_text": _truncate_text(ref.get("evidence_text"), char_limit),
    }


def _compact_project_for_summary(project: dict[str, Any], char_limit: int) -> dict[str, Any]:
    amounts = project.get("amounts") if isinstance(project.get("amounts"), dict) else {}
    refs = normalize_source_refs(project.get("source_refs"), default_kind="table_row")
    compact_refs = [_compact_source_ref(ref, char_limit=char_limit) for ref in refs[:8]]
    return {
        "project_key": _truncate_text(project.get("project_key"), char_limit),
        "aip_ref_code": _truncate_text(project.get("aip_ref_code"), char_limit),
        "program_project_description": _truncate_text(project.get("program_project_description"), char_limit),
        "implementing_agency": _truncate_text(project.get("implementing_agency"), char_limit),
        "start_date": _truncate_text(project.get("start_date"), char_limit),
        "completion_date": _truncate_text(project.get("completion_date"), char_limit),
        "expected_output": _truncate_text(project.get("expected_output"), char_limit),
        "source_of_funds": _truncate_text(project.get("source_of_funds"), char_limit),
        "amounts": {
            "personal_services": amounts.get("personal_services"),
            "maintenance_and_other_operating_expenses": amounts.get(
                "maintenance_and_other_operating_expenses"
            ),
            "financial_expenses": amounts.get("financial_expenses"),
            "capital_outlay": amounts.get("capital_outlay"),
            "total": amounts.get("total"),
        },
        "errors": project.get("errors") if isinstance(project.get("errors"), list) else None,
        "source_refs": compact_refs,
    }


def _sum_usage(usages: list[dict[str, Any]]) -> dict[str, Any]:
    def _sum_key(key: str) -> int | None:
        values = [usage.get(key) for usage in usages if isinstance(usage.get(key), int)]
        return sum(values) if values else None

    return {
        "input_tokens": _sum_key("input_tokens"),
        "output_tokens": _sum_key("output_tokens"),
        "total_tokens": _sum_key("total_tokens"),
    }


def _estimate_tokens_from_text(text: str) -> int:
    if not text:
        return 0
    return max(1, (len(text.encode("utf-8")) + 3) // 4)


def _estimate_payload_tokens(payload_obj: dict[str, Any]) -> int:
    return _estimate_tokens_from_text(json.dumps(payload_obj, ensure_ascii=False, separators=(",", ":")))


def _chunk_projects_by_token_budget(
    *,
    projects: list[dict[str, Any]],
    static_payload: dict[str, Any],
    budget_tokens: int,
) -> list[list[dict[str, Any]]]:
    if not projects:
        return []

    chunks: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for project in projects:
        candidate = [*current, project]
        candidate_tokens = _estimate_payload_tokens({**static_payload, "projects": candidate})
        if not current or candidate_tokens <= budget_tokens:
            current = candidate
            continue
        chunks.append(current)
        current = [project]

    if current:
        chunks.append(current)
    return chunks


def _extract_summary_text(output_text: str) -> str:
    parsed = json.loads(output_text)
    summary_text = str(parsed.get("summary") or "").strip()
    return summary_text or "No summary generated."


def _is_context_limit_error(error: Exception) -> bool:
    code = str(getattr(error, "code", "") or "").lower()
    if code and "context" in code:
        return True
    message = str(error).lower()
    return any(
        marker in message
        for marker in (
            "context length",
            "maximum context length",
            "context window",
            "too many tokens",
        )
    )


def _call_summary_map(
    *,
    payload_chunk: dict[str, Any],
    system_prompt: str,
    model: str,
    client: OpenAI,
) -> tuple[str, dict[str, Any]]:
    response = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(payload_chunk, ensure_ascii=False)},
        ],
        text={"format": {"type": "json_object"}},
    )
    return _extract_summary_text(response.output_text), safe_usage_dict(response)


def _call_summary_reduce(
    *,
    chunk_summaries: list[str],
    reduce_prompt: str,
    model: str,
    client: OpenAI,
) -> tuple[str, dict[str, Any]]:
    payload = {
        "chunk_summaries": chunk_summaries,
        "count": len(chunk_summaries),
    }
    response = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": reduce_prompt},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        text={"format": {"type": "json_object"}},
    )
    return _extract_summary_text(response.output_text), safe_usage_dict(response)


def _summarize_map_chunk_with_backoff(
    *,
    projects_chunk: list[dict[str, Any]],
    static_payload: dict[str, Any],
    system_prompt: str,
    model: str,
    client: OpenAI,
    usages: list[dict[str, Any]],
) -> list[str]:
    payload_chunk = {**static_payload, "projects": projects_chunk}
    try:
        summary_text, usage = _call_summary_map(
            payload_chunk=payload_chunk,
            system_prompt=system_prompt,
            model=model,
            client=client,
        )
        usages.append(usage)
        return [summary_text]
    except Exception as error:
        if not _is_context_limit_error(error):
            raise
        if len(projects_chunk) <= 1:
            raise RuntimeError(
                "Summarization exceeded context window for a single project chunk."
            ) from error
        midpoint = len(projects_chunk) // 2
        left = _summarize_map_chunk_with_backoff(
            projects_chunk=projects_chunk[:midpoint],
            static_payload=static_payload,
            system_prompt=system_prompt,
            model=model,
            client=client,
            usages=usages,
        )
        right = _summarize_map_chunk_with_backoff(
            projects_chunk=projects_chunk[midpoint:],
            static_payload=static_payload,
            system_prompt=system_prompt,
            model=model,
            client=client,
            usages=usages,
        )
        return [*left, *right]


def _reduce_summaries_with_backoff(
    *,
    chunk_summaries: list[str],
    reduce_prompt: str,
    model: str,
    client: OpenAI,
    usages: list[dict[str, Any]],
) -> str:
    if not chunk_summaries:
        return "No summary generated."
    if len(chunk_summaries) == 1:
        return chunk_summaries[0]

    try:
        reduced_text, usage = _call_summary_reduce(
            chunk_summaries=chunk_summaries,
            reduce_prompt=reduce_prompt,
            model=model,
            client=client,
        )
        usages.append(usage)
        return reduced_text
    except Exception as error:
        if not _is_context_limit_error(error):
            raise
        if len(chunk_summaries) <= 1:
            raise RuntimeError("Summarization reduce stage exceeded context window.") from error
        midpoint = len(chunk_summaries) // 2
        left_text = _reduce_summaries_with_backoff(
            chunk_summaries=chunk_summaries[:midpoint],
            reduce_prompt=reduce_prompt,
            model=model,
            client=client,
            usages=usages,
        )
        right_text = _reduce_summaries_with_backoff(
            chunk_summaries=chunk_summaries[midpoint:],
            reduce_prompt=reduce_prompt,
            model=model,
            client=client,
            usages=usages,
        )
        return _reduce_summaries_with_backoff(
            chunk_summaries=[left_text, right_text],
            reduce_prompt=reduce_prompt,
            model=model,
            client=client,
            usages=usages,
        )


def _fallback_document() -> dict[str, Any]:
    year = int(now_utc_iso()[:4])
    return {
        "lgu": {"name": "Unknown LGU", "type": "unknown"},
        "fiscal_year": year,
        "source": {"document_type": "unknown", "page_count": None},
    }


def summarize_aip_overall_json_str(
    validated_json_str: str,
    model: str = "gpt-5.2",
    heartbeat_seconds: float = 5.0,
    client: OpenAI | None = None,
) -> SummarizationResult:
    try:
        validated_obj = json.loads(validated_json_str)
    except json.JSONDecodeError as error:
        raise ValueError(f"Input is not valid JSON string: {error}") from error
    projects = validated_obj.get("projects")
    if not isinstance(projects, list):
        raise ValueError("Input JSON must contain top-level 'projects' array.")

    start_ts = time.perf_counter()
    last_beat = start_ts

    def beat(msg: str) -> None:
        nonlocal last_beat
        now = time.perf_counter()
        if now - last_beat >= heartbeat_seconds:
            print(f"[SUMMARY] {msg} | elapsed={now - start_ts:.1f}s", flush=True)
            last_beat = now

    summarize_context_window_tokens = _read_positive_int_env(
        "PIPELINE_SUMMARIZE_CONTEXT_WINDOW_TOKENS", 128000
    )
    summarize_response_buffer_tokens = _read_positive_int_env(
        "PIPELINE_SUMMARIZE_RESPONSE_BUFFER_TOKENS", 2000
    )
    summarize_project_field_char_limit = _read_positive_int_env(
        "PIPELINE_SUMMARIZE_PROJECT_FIELD_CHAR_LIMIT", 500
    )

    compact_projects = [
        _compact_project_for_summary(project, summarize_project_field_char_limit)
        for project in projects
        if isinstance(project, dict)
    ]
    static_payload = {
        "aip_id": validated_obj.get("aip_id"),
        "uploaded_file_id": validated_obj.get("uploaded_file_id"),
        "document": validated_obj.get("document")
        if isinstance(validated_obj.get("document"), dict)
        else _fallback_document(),
        "warnings": validated_obj.get("warnings")
        if isinstance(validated_obj.get("warnings"), list)
        else [],
        "totals": validated_obj.get("totals")
        if isinstance(validated_obj.get("totals"), list)
        else [],
    }

    resolved_client = client or build_openai_client()
    system_prompt = read_text("prompts/summarization/system.txt")
    reduce_prompt = read_text("prompts/summarization/reduce_system.txt")
    prompt_tokens = _estimate_tokens_from_text(system_prompt)
    input_budget_tokens = max(
        1024,
        summarize_context_window_tokens
        - summarize_response_buffer_tokens
        - prompt_tokens,
    )
    project_chunks = _chunk_projects_by_token_budget(
        projects=compact_projects,
        static_payload=static_payload,
        budget_tokens=input_budget_tokens,
    )
    if not project_chunks and compact_projects:
        project_chunks = [compact_projects]

    print(
        (
            "[SUMMARY] map-reduce start "
            f"projects={len(compact_projects)} chunks={len(project_chunks)} "
            f"input_budget_tokens={input_budget_tokens}"
        ),
        flush=True,
    )

    usages: list[dict[str, Any]] = []
    chunk_summaries: list[str] = []
    for chunk_index, chunk in enumerate(project_chunks, start=1):
        beat(f"Summarizing chunk {chunk_index}/{len(project_chunks)}")
        summaries = _summarize_map_chunk_with_backoff(
            projects_chunk=chunk,
            static_payload=static_payload,
            system_prompt=system_prompt,
            model=model,
            client=resolved_client,
            usages=usages,
        )
        chunk_summaries.extend(summaries)

    if len(chunk_summaries) <= 1:
        final_summary_text = chunk_summaries[0] if chunk_summaries else "No summary generated."
    else:
        beat("Reducing chunk summaries")
        final_summary_text = _reduce_summaries_with_backoff(
            chunk_summaries=chunk_summaries,
            reduce_prompt=reduce_prompt,
            model=model,
            client=resolved_client,
            usages=usages,
        )
    reduce_rounds = max(0, len(usages) - len(chunk_summaries))

    print(
        (
            "[SUMMARY] map-reduce complete "
            f"map_outputs={len(chunk_summaries)} reduce_rounds={reduce_rounds} "
            f"calls={len(usages)}"
        ),
        flush=True,
    )

    elapsed = round(time.perf_counter() - start_ts, 4)
    summary_text = final_summary_text.strip()
    summary_refs, evidence_keys = collect_summary_evidence(projects, summary_text=summary_text)
    summary_block = {
        "text": summary_text or "No summary generated.",
        "source_refs": summary_refs,
        "evidence_project_keys": evidence_keys or None,
    }
    summary_artifact = make_stage_root(
        stage="summarize",
        aip_id=str(validated_obj.get("aip_id") or "unknown-aip"),
        uploaded_file_id=str(validated_obj.get("uploaded_file_id")) if validated_obj.get("uploaded_file_id") else None,
        document=validated_obj.get("document") if isinstance(validated_obj.get("document"), dict) else _fallback_document(),
        projects=projects,
        totals=validated_obj.get("totals") if isinstance(validated_obj.get("totals"), list) else [],
        summary=summary_block,
        warnings=validated_obj.get("warnings") if isinstance(validated_obj.get("warnings"), list) else [],
        quality=validated_obj.get("quality") if isinstance(validated_obj.get("quality"), dict) else None,
        generated_at=now_utc_iso(),
        schema_version=str(validated_obj.get("schema_version") or SCHEMA_VERSION),
    )
    return SummarizationResult(
        summary_text=summary_block["text"],
        summary_obj=summary_artifact,
        summary_json_str=json.dumps(summary_artifact, ensure_ascii=False, indent=2),
        usage=_sum_usage(usages),
        elapsed_seconds=elapsed,
        model=model,
    )


def attach_summary_to_validated_json_str(validated_json_str: str, summary_text: str) -> str:
    parsed = json.loads(validated_json_str)
    projects = parsed.get("projects") if isinstance(parsed.get("projects"), list) else []
    refs, evidence_keys = collect_summary_evidence(projects, summary_text=summary_text)
    summary_block = {
        "text": summary_text.strip() or "No summary generated.",
        "source_refs": refs,
        "evidence_project_keys": evidence_keys or None,
    }
    merged = make_stage_root(
        stage="summarize",
        aip_id=str(parsed.get("aip_id") or "unknown-aip"),
        uploaded_file_id=str(parsed.get("uploaded_file_id")) if parsed.get("uploaded_file_id") else None,
        document=parsed.get("document") if isinstance(parsed.get("document"), dict) else _fallback_document(),
        projects=projects,
        totals=parsed.get("totals") if isinstance(parsed.get("totals"), list) else [],
        summary=summary_block,
        warnings=parsed.get("warnings") if isinstance(parsed.get("warnings"), list) else [],
        quality=parsed.get("quality") if isinstance(parsed.get("quality"), dict) else None,
        generated_at=now_utc_iso(),
        schema_version=str(parsed.get("schema_version") or SCHEMA_VERSION),
    )
    return json.dumps(merged, ensure_ascii=False, indent=2)
