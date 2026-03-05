from __future__ import annotations

import json
import time
from typing import Any, Callable

from openai import OpenAI

from openaip_pipeline.core.artifact_contract import SCHEMA_VERSION, make_stage_root, normalize_source_refs
from openaip_pipeline.core.clock import now_utc_iso
from openaip_pipeline.core.resources import read_text
from openaip_pipeline.services.openai_utils import build_openai_client, safe_usage_dict


def _split_into_fixed_size_chunks(items: list[Any], chunk_size: int) -> list[list[Any]]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be >= 1")
    return [items[start : start + chunk_size] for start in range(0, len(items), chunk_size)]


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


def _sum_usage(usages: list[dict[str, Any]]) -> dict[str, Any]:
    def s(key: str) -> int | None:
        vals = [u.get(key) for u in usages if isinstance(u.get(key), int)]
        return sum(vals) if vals else None

    return {"input_tokens": s("input_tokens"), "output_tokens": s("output_tokens"), "total_tokens": s("total_tokens")}


def _fallback_document() -> dict[str, Any]:
    year = int(now_utc_iso()[:4])
    return {
        "lgu": {"name": "Unknown LGU", "type": "unknown"},
        "fiscal_year": year,
        "source": {"document_type": "unknown", "page_count": None},
    }


def _flatten_project_for_model(project: dict[str, Any]) -> dict[str, Any]:
    amounts = project.get("amounts") if isinstance(project.get("amounts"), dict) else {}
    climate = project.get("climate") if isinstance(project.get("climate"), dict) else {}
    return {
        "aip_ref_code": project.get("aip_ref_code"),
        "program_project_description": project.get("program_project_description"),
        "implementing_agency": project.get("implementing_agency"),
        "start_date": project.get("start_date"),
        "completion_date": project.get("completion_date"),
        "expected_output": project.get("expected_output"),
        "source_of_funds": project.get("source_of_funds"),
        "personal_services": amounts.get("personal_services"),
        "maintenance_and_other_operating_expenses": amounts.get("maintenance_and_other_operating_expenses"),
        "capital_outlay": amounts.get("capital_outlay"),
        "total": amounts.get("total"),
        "climate_change_adaptation": climate.get("climate_change_adaptation"),
        "climate_change_mitigation": climate.get("climate_change_mitigation"),
        "cc_topology_code": climate.get("cc_topology_code"),
        "prm_ncr_lgu_rm_objective_results_indicator": climate.get("prm_ncr_lgu_rm_objective_results_indicator"),
        "errors": project.get("errors"),
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
    return [f"R004 total mismatch: expected {expected:.2f} but got {float(total):.2f}"]


def validate_projects_json_str(
    extraction_json_str: str,
    model: str = "gpt-5.2",
    batch_size: int = 25,
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

    total_projects = len(projects)
    merged_projects = json.loads(json.dumps(projects, ensure_ascii=False))

    if total_projects > 0:
        chunks = _split_into_fixed_size_chunks(projects, batch_size)
        total_batches = len(chunks)
        overall_start = time.perf_counter()
        chunk_usages: list[dict[str, Any]] = []
        chunk_times: list[float] = []
        cursor = 0

        resolved_client = client or build_openai_client()
        system_prompt = read_text("prompts/validation/city_system.txt")

        for batch_index, chunk in enumerate(chunks, start=1):
            chunk_size = len(chunk)
            if chunk_size == 0:
                continue
            batch_start = time.perf_counter()
            payload_obj = {"projects": [_flatten_project_for_model(project) for project in chunk if isinstance(project, dict)]}
            response = resolved_client.responses.create(
                model=model,
                input=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": json.dumps(payload_obj, ensure_ascii=False)},
                ],
                text={"format": {"type": "json_object"}},
            )
            batch_elapsed = round(time.perf_counter() - batch_start, 4)
            usage = safe_usage_dict(response)
            validated_chunk_obj = json.loads(response.output_text)
            validated_chunk_projects = validated_chunk_obj.get("projects")
            if not isinstance(validated_chunk_projects, list) or len(validated_chunk_projects) != chunk_size:
                raise RuntimeError(
                    f"Batch {batch_index}: invalid model output. expected={chunk_size}, got={len(validated_chunk_projects) if isinstance(validated_chunk_projects, list) else type(validated_chunk_projects)}"
                )
            for local_idx in range(chunk_size):
                original_idx = cursor + local_idx
                merged_projects[original_idx]["errors"] = validated_chunk_projects[local_idx].get("errors", None)
            cursor += chunk_size
            chunk_usages.append(usage)
            chunk_times.append(batch_elapsed)
            done_projects = min(cursor, total_projects)
            if on_progress:
                on_progress(
                    done_projects,
                    total_projects,
                    batch_index,
                    total_batches,
                    f"Validating projects {done_projects}/{total_projects} (batch {batch_index}/{total_batches})...",
                )
        usage_total = _sum_usage(chunk_usages)
        overall_elapsed = round(time.perf_counter() - overall_start, 4)
    else:
        usage_total = {"input_tokens": None, "output_tokens": None, "total_tokens": None}
        overall_elapsed = 0.0
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
                "details": {"count": sum(1 for project in merged_projects if isinstance(project, dict) and isinstance(project.get("errors"), list) and any("R_PROVENANCE" in str(error) for error in project.get("errors", [])) )},
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
    )
