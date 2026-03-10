from __future__ import annotations

import json
import os
import time
from collections import deque
from typing import Any, Callable

from openai import OpenAI

from openaip_pipeline.core.artifact_contract import SCHEMA_VERSION, make_stage_root, normalize_source_refs
from openaip_pipeline.core.clock import now_utc_iso
from openaip_pipeline.core.resources import read_text
from openaip_pipeline.services.chunking.context_window import (
    chunk_items_by_token_budget,
    estimate_tokens_from_json,
    estimate_tokens_from_text,
    is_context_limit_error,
    sum_usage,
)
from openaip_pipeline.services.openai_utils import build_openai_client, safe_usage_dict


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


class ValidationResult:
    def __init__(
        self,
        validated_obj: dict[str, Any],
        validated_json_str: str,
        usage: dict[str, Any],
        elapsed_seconds: float,
        model: str,
        chunk_usages: list[dict[str, Any]] | None = None,
        chunk_elapsed_seconds: list[float] | None = None,
    ):
        self.validated_obj = validated_obj
        self.validated_json_str = validated_json_str
        self.usage = usage
        self.elapsed_seconds = elapsed_seconds
        self.model = model
        self.chunk_usages = chunk_usages or []
        self.chunk_elapsed_seconds = chunk_elapsed_seconds or []


def _fallback_document() -> dict[str, Any]:
    year = int(now_utc_iso()[:4])
    return {
        "lgu": {"name": "Unknown LGU", "type": "unknown"},
        "fiscal_year": year,
        "source": {"document_type": "unknown", "page_count": None},
    }


def _flatten_project_for_model(project: dict[str, Any], char_limit: int) -> dict[str, Any]:
    amounts = project.get("amounts") if isinstance(project.get("amounts"), dict) else {}
    climate = project.get("climate") if isinstance(project.get("climate"), dict) else {}
    raw_errors = project.get("errors") if isinstance(project.get("errors"), list) else None
    errors = (
        [
            truncated
            for truncated in (_truncate_text(item, char_limit) for item in raw_errors)
            if truncated
        ][:10]
        if raw_errors
        else None
    )
    return {
        "aip_ref_code": _truncate_text(project.get("aip_ref_code"), char_limit),
        "program_project_description": _truncate_text(
            project.get("program_project_description"), char_limit
        ),
        "implementing_agency": _truncate_text(project.get("implementing_agency"), char_limit),
        "start_date": _truncate_text(project.get("start_date"), char_limit),
        "completion_date": _truncate_text(project.get("completion_date"), char_limit),
        "expected_output": _truncate_text(project.get("expected_output"), char_limit),
        "source_of_funds": _truncate_text(project.get("source_of_funds"), char_limit),
        "personal_services": amounts.get("personal_services"),
        "maintenance_and_other_operating_expenses": amounts.get(
            "maintenance_and_other_operating_expenses"
        ),
        "capital_outlay": amounts.get("capital_outlay"),
        "total": amounts.get("total"),
        "climate_change_adaptation": climate.get("climate_change_adaptation"),
        "climate_change_mitigation": climate.get("climate_change_mitigation"),
        "cc_topology_code": _truncate_text(climate.get("cc_topology_code"), char_limit),
        "prm_ncr_lgu_rm_objective_results_indicator": _truncate_text(
            climate.get("prm_ncr_lgu_rm_objective_results_indicator"),
            char_limit,
        ),
        "errors": errors,
    }


def _to_error_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    return [text] if text else []


def _append_rule_errors(existing: Any, additions: list[str]) -> list[str] | None:
    merged = _to_error_list(existing)
    for item in additions:
        text = str(item).strip()
        if text and text not in merged:
            merged.append(text)
    return merged or None


def _validate_provenance(project: dict[str, Any]) -> list[str]:
    refs = normalize_source_refs(project.get("source_refs"), default_kind="table_row")
    if not refs:
        return ["R_PROVENANCE missing provenance: page unknown"]
    for ref in refs:
        page = ref.get("page")
        if isinstance(page, int) and page >= 1:
            return []
    return ["R_PROVENANCE missing provenance: page unknown"]


def _validate_total_city(project: dict[str, Any]) -> list[str]:
    amounts = project.get("amounts")
    if not isinstance(amounts, dict):
        return []
    total = amounts.get("total")
    if not isinstance(total, (int, float)):
        return []
    ps = amounts.get("personal_services")
    mooe = amounts.get("maintenance_and_other_operating_expenses")
    co = amounts.get("capital_outlay")
    expected = float(ps or 0) + float(mooe or 0) + float(co or 0)
    if abs(float(total) - expected) <= 1.0:
        return []
    return [f"R005 total mismatch: expected {expected:.2f} but got {float(total):.2f}"]


def _build_chunk_payload(
    static_payload: dict[str, Any],
    chunk_indices: list[int],
    flattened_projects: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        **static_payload,
        "projects": [flattened_projects[index] for index in chunk_indices],
    }


def _split_chunk(chunk_indices: list[int], chunk_queue: deque[list[int]]) -> tuple[list[int], list[int]]:
    midpoint = len(chunk_indices) // 2
    left_chunk = chunk_indices[:midpoint]
    right_chunk = chunk_indices[midpoint:]
    chunk_queue.appendleft(right_chunk)
    chunk_queue.appendleft(left_chunk)
    return left_chunk, right_chunk


def validate_projects_json_str(
    extraction_json_str: str,
    model: str = "gpt-5.2",
    batch_size: int | None = 25,
    on_progress: Callable[[int, int, int, int, str], None] | None = None,
    client: OpenAI | None = None,
) -> ValidationResult:
    try:
        extraction_obj = json.loads(extraction_json_str)
    except json.JSONDecodeError as error:
        raise ValueError(f"Input is not valid JSON string: {error}") from error

    if not isinstance(extraction_obj, dict):
        raise ValueError("Top-level JSON must be an object/dict.")
    projects = extraction_obj.get("projects")
    if not isinstance(projects, list):
        raise ValueError('Top-level key "projects" must be a list.')
    if batch_size is not None and batch_size <= 0:
        raise ValueError("batch_size must be >= 1 when provided.")

    total_projects = len(projects)
    merged_projects = json.loads(json.dumps(projects, ensure_ascii=False))

    if total_projects > 0:
        validate_context_window_tokens = _read_positive_int_env(
            "PIPELINE_VALIDATE_CONTEXT_WINDOW_TOKENS", 128000
        )
        validate_response_buffer_tokens = _read_positive_int_env(
            "PIPELINE_VALIDATE_RESPONSE_BUFFER_TOKENS", 2000
        )
        validate_project_field_char_limit = _read_positive_int_env(
            "PIPELINE_VALIDATE_PROJECT_FIELD_CHAR_LIMIT", 500
        )

        flattened_projects = [
            _flatten_project_for_model(project, validate_project_field_char_limit)
            if isinstance(project, dict)
            else {}
            for project in projects
        ]
        static_payload: dict[str, Any] = {}
        resolved_client = client or build_openai_client()
        system_prompt = read_text("prompts/validation/city_system.txt")
        prompt_tokens = estimate_tokens_from_text(system_prompt)
        usable_context_tokens = max(
            1024,
            validate_context_window_tokens
            - prompt_tokens,
            - validate_response_buffer_tokens,
        )
        input_budget_tokens = max(1024, usable_context_tokens // 2)
        initial_chunks = chunk_items_by_token_budget(
            items=list(range(total_projects)),
            static_payload=static_payload,
            add_item_fn=lambda payload, chunk: _build_chunk_payload(
                payload, chunk, flattened_projects
            ),
            budget_tokens=input_budget_tokens,
            max_items_per_chunk=batch_size,
        )
        chunk_queue: deque[list[int]] = deque(initial_chunks)
        total_chunks_planned = len(initial_chunks)
        completed_chunks = 0
        done_projects = 0

        if on_progress:
            on_progress(
                0,
                total_projects,
                0,
                total_chunks_planned,
                (
                    "Validation preflight: "
                    f"{total_projects} project(s) planned across {total_chunks_planned} chunk(s)."
                ),
            )

        overall_start = time.perf_counter()
        chunk_usages: list[dict[str, Any]] = []
        chunk_times: list[float] = []

        while chunk_queue:
            chunk_indices = chunk_queue.popleft()
            chunk_size = len(chunk_indices)
            if chunk_size == 0:
                continue

            payload_obj = _build_chunk_payload(
                static_payload, chunk_indices, flattened_projects
            )
            chunk_input_tokens = estimate_tokens_from_json(payload_obj)
            remaining_output_budget = (
                validate_context_window_tokens
                - prompt_tokens
                - validate_response_buffer_tokens
                - chunk_input_tokens
            )
            max_output_tokens = max(32, remaining_output_budget)
            current_chunk_no = completed_chunks + 1
            if on_progress:
                on_progress(
                    min(done_projects, total_projects),
                    total_projects,
                    current_chunk_no,
                    total_chunks_planned,
                    (
                        "Validation chunk start: "
                        f"processing chunk {current_chunk_no}/{total_chunks_planned} "
                        f"with {chunk_size} project(s)."
                    ),
                )
            batch_start = time.perf_counter()
            try:
                response = resolved_client.responses.create(
                    model=model,
                    input=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": json.dumps(payload_obj, ensure_ascii=False)},
                    ],
                    text={"format": {"type": "json_object"}},
                    max_output_tokens=max_output_tokens,
                )
            except Exception as error:
                if not is_context_limit_error(error):
                    raise
                if chunk_size <= 1:
                    index = chunk_indices[0]
                    ref_code = (
                        str(merged_projects[index].get("aip_ref_code") or "").strip()
                        if isinstance(merged_projects[index], dict)
                        else ""
                    )
                    raise RuntimeError(
                        (
                            "Validation chunk exceeds model context window for a single project. "
                            f"index={index} aip_ref_code={ref_code or 'unknown'} "
                            f"chunk={current_chunk_no}/{total_chunks_planned}"
                        )
                    ) from error
                left_chunk, right_chunk = _split_chunk(chunk_indices, chunk_queue)
                total_chunks_planned += 1
                if on_progress:
                    on_progress(
                        min(done_projects, total_projects),
                        total_projects,
                        current_chunk_no,
                        total_chunks_planned,
                        (
                            "Validation chunk split (context overflow): "
                            f"chunk {current_chunk_no} exceeded context and was split into "
                            f"{len(left_chunk)}+{len(right_chunk)} project(s)."
                        ),
                    )
                continue

            batch_elapsed = round(time.perf_counter() - batch_start, 4)
            usage = safe_usage_dict(response)
            response_status = str(getattr(response, "status", "") or "").strip().lower()
            incomplete_details = getattr(response, "incomplete_details", None)
            response_text = getattr(response, "output_text", None)
            invalid_reason: str | None = None
            validated_chunk_projects: list[Any] | None = None

            if response_status == "incomplete":
                invalid_reason = f"response status=incomplete details={incomplete_details!r}"
            elif not isinstance(response_text, str) or not response_text.strip():
                invalid_reason = "empty response.output_text"
            else:
                try:
                    validated_chunk_obj = json.loads(response_text)
                except json.JSONDecodeError as error:
                    invalid_reason = f"response JSON parse error: {error.msg}"
                else:
                    parsed_projects = (
                        validated_chunk_obj.get("projects")
                        if isinstance(validated_chunk_obj, dict)
                        else None
                    )
                    if not isinstance(parsed_projects, list):
                        invalid_reason = (
                            "missing projects list in model output "
                            f"(type={type(parsed_projects).__name__})"
                        )
                    elif len(parsed_projects) != chunk_size:
                        invalid_reason = (
                            "partial projects list in model output "
                            f"(expected={chunk_size}, got={len(parsed_projects)})"
                        )
                    else:
                        validated_chunk_projects = parsed_projects

            if invalid_reason:
                chunk_usages.append(usage)
                chunk_times.append(batch_elapsed)
                if chunk_size <= 1:
                    index = chunk_indices[0]
                    ref_code = (
                        str(merged_projects[index].get("aip_ref_code") or "").strip()
                        if isinstance(merged_projects[index], dict)
                        else ""
                    )
                    raise RuntimeError(
                        (
                            "Validation chunk returned invalid model output for a single project. "
                            f"index={index} aip_ref_code={ref_code or 'unknown'} "
                            f"chunk={current_chunk_no}/{total_chunks_planned} reason={invalid_reason}"
                        )
                    )
                left_chunk, right_chunk = _split_chunk(chunk_indices, chunk_queue)
                total_chunks_planned += 1
                if on_progress:
                    on_progress(
                        min(done_projects, total_projects),
                        total_projects,
                        current_chunk_no,
                        total_chunks_planned,
                        (
                            "Validation chunk split (partial output): "
                            f"chunk {current_chunk_no} returned invalid output and was split into "
                            f"{len(left_chunk)}+{len(right_chunk)} project(s). "
                            f"reason={invalid_reason}"
                        ),
                    )
                continue

            for local_idx, original_idx in enumerate(chunk_indices):
                candidate = validated_chunk_projects[local_idx]
                merged_projects[original_idx]["errors"] = (
                    candidate.get("errors", None)
                    if isinstance(candidate, dict)
                    else None
                )

            chunk_usages.append(usage)
            chunk_times.append(batch_elapsed)
            done_projects += chunk_size
            completed_chunks += 1
            if on_progress:
                on_progress(
                    min(done_projects, total_projects),
                    total_projects,
                    completed_chunks,
                    total_chunks_planned,
                    (
                        f"Validating projects {min(done_projects, total_projects)}/{total_projects} "
                        f"(chunk {completed_chunks}/{total_chunks_planned})..."
                    ),
                )

        usage_total = sum_usage(chunk_usages)
        overall_elapsed = round(time.perf_counter() - overall_start, 4)
    else:
        usage_total = {"input_tokens": None, "output_tokens": None, "total_tokens": None}
        overall_elapsed = 0.0
        chunk_usages = []
        chunk_times = []
        if on_progress:
            on_progress(0, 0, 1, 1, "No projects to validate.")

    for project in merged_projects:
        if not isinstance(project, dict):
            continue
        rule_errors = [*_validate_provenance(project), *_validate_total_city(project)]
        project["errors"] = _append_rule_errors(project.get("errors"), rule_errors)

    warnings = extraction_obj.get("warnings") if isinstance(extraction_obj.get("warnings"), list) else []
    if any(
        isinstance(project, dict)
        and isinstance(project.get("errors"), list)
        and any("R_PROVENANCE" in str(error) for error in project.get("errors", []))
        for project in merged_projects
    ):
        warnings = [
            *warnings,
            {
                "code": "PROVENANCE_VALIDATION_ISSUE",
                "message": "One or more projects still have missing provenance after validation.",
                "details": {
                    "count": sum(
                        1
                        for project in merged_projects
                        if isinstance(project, dict)
                        and isinstance(project.get("errors"), list)
                        and any("R_PROVENANCE" in str(error) for error in project.get("errors", []))
                    )
                },
                "source_refs": [],
            },
        ]

    validated_obj = make_stage_root(
        stage="validate",
        aip_id=str(extraction_obj.get("aip_id") or "unknown-aip"),
        uploaded_file_id=str(extraction_obj.get("uploaded_file_id")) if extraction_obj.get("uploaded_file_id") else None,
        document=extraction_obj.get("document") if isinstance(extraction_obj.get("document"), dict) else _fallback_document(),
        projects=merged_projects,
        totals=extraction_obj.get("totals") if isinstance(extraction_obj.get("totals"), list) else [],
        summary=extraction_obj.get("summary") if isinstance(extraction_obj.get("summary"), dict) else None,
        warnings=warnings,
        quality=extraction_obj.get("quality") if isinstance(extraction_obj.get("quality"), dict) else None,
        generated_at=now_utc_iso(),
        schema_version=str(extraction_obj.get("schema_version") or SCHEMA_VERSION),
    )

    return ValidationResult(
        validated_obj=validated_obj,
        validated_json_str=json.dumps(validated_obj, ensure_ascii=False, indent=2),
        usage=usage_total,
        elapsed_seconds=overall_elapsed,
        model=model,
        chunk_usages=chunk_usages,
        chunk_elapsed_seconds=chunk_times,
    )
