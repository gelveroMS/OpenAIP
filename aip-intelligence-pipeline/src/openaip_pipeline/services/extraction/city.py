from __future__ import annotations

import json
import os
import tempfile
import time
from typing import Any, Callable

from openai import OpenAI
from pydantic import BaseModel, Field
from pypdf import PdfReader, PdfWriter

from openaip_pipeline.core.artifact_contract import (
    build_project_key,
    compute_row_signature,
    compute_quality,
    ensure_project_has_provenance,
    make_source_ref,
    make_stage_root,
    normalize_description,
    normalize_identifier,
    normalize_source_refs,
    normalize_text,
    parse_amount,
    to_amount_raw,
)
from openaip_pipeline.core.resources import read_text
from openaip_pipeline.services.extraction.document_metadata import extract_document_metadata
from openaip_pipeline.services.extraction.totals_extractor import extract_totals_from_pdf
from openaip_pipeline.services.openai_utils import build_openai_client, safe_usage_dict


AmountLike = float | int | str | None


class CityAIPProjectRow(BaseModel):
    aip_ref_code: str | None = None
    program_project_description: str | None = None
    implementing_agency: str | None = None
    start_date: str | None = None
    completion_date: str | None = None
    expected_output: str | None = None
    source_of_funds: str | None = None
    personal_services: AmountLike = None
    maintenance_and_other_operating_expenses: AmountLike = None
    capital_outlay: AmountLike = None
    total: AmountLike = None
    climate_change_adaptation: AmountLike = None
    climate_change_mitigation: AmountLike = None
    cc_topology_code: str | None = None
    prm_ncr_lgu_rm_objective_results_indicator: str | None = None


class CityAIPExtraction(BaseModel):
    projects: list[CityAIPProjectRow] = Field(default_factory=list)


class ExtractionResult(BaseModel):
    job_id: str | None = None
    model: str
    source_pdf: str
    extracted: dict[str, Any]
    usage: dict[str, Any]
    payload: dict[str, Any]
    json_str: str


class ExtractionGuardrailError(RuntimeError):
    def __init__(self, reason_code: str, message: str):
        super().__init__(message)
        self.reason_code = reason_code


def _read_positive_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        parsed = int(raw.strip())
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _read_positive_float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        parsed = float(raw.strip())
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _resolve_max_pages(value: int | None) -> int:
    if isinstance(value, int) and value > 0:
        return value
    return _read_positive_int_env("PIPELINE_EXTRACT_MAX_PAGES", 200)


def _resolve_parse_timeout_seconds(value: float | None) -> float:
    if isinstance(value, (int, float)) and float(value) > 0:
        return float(value)
    return _read_positive_float_env("PIPELINE_PARSE_TIMEOUT_SECONDS", 20.0)


def _resolve_extract_timeout_seconds(value: float | None) -> float:
    if isinstance(value, (int, float)) and float(value) > 0:
        return float(value)
    return _read_positive_float_env("PIPELINE_EXTRACT_TIMEOUT_SECONDS", 1800.0)


# Security proof:
# - PIPELINE_EXTRACT_MAX_PAGES (default 200) rejects oversized page-count PDFs with PDF_PAGE_LIMIT_EXCEEDED.
# - PIPELINE_PARSE_TIMEOUT_SECONDS (default 20) rejects slow parse with PARSE_TIMEOUT.
# - PIPELINE_EXTRACT_TIMEOUT_SECONDS (default 1800) bounds per-run extraction time with EXTRACT_TIMEOUT.


def extract_single_page_pdf(original_pdf_path: str, page_index: int) -> str:
    reader = PdfReader(original_pdf_path)
    if len(reader.pages) == 0:
        raise ValueError("PDF has no pages")
    if page_index < 0 or page_index >= len(reader.pages):
        raise IndexError(f"page_index out of range: {page_index}")
    writer = PdfWriter()
    writer.add_page(reader.pages[page_index])
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    with open(temp_file.name, "wb") as file_handle:
        writer.write(file_handle)
    return temp_file.name


def _normalize_city_row(*, row: dict[str, Any], page: int, row_index: int) -> tuple[dict[str, Any], int]:
    normalized_ref = normalize_identifier(row.get("aip_ref_code"))
    raw_ref = normalize_text(row.get("aip_ref_code"))
    key_normalized_change = 1 if (raw_ref or "").replace("\n", " ").strip() != (normalized_ref or "") else 0
    ps_raw = to_amount_raw(row.get("personal_services"))
    mooe_raw = to_amount_raw(row.get("maintenance_and_other_operating_expenses"))
    co_raw = to_amount_raw(row.get("capital_outlay"))
    total_raw = to_amount_raw(row.get("total"))
    normalized: dict[str, Any] = {
        "aip_ref_code": normalized_ref,
        "program_project_description": normalize_description(row.get("program_project_description")) or "Unspecified project",
        "implementing_agency": normalize_identifier(row.get("implementing_agency")),
        "start_date": normalize_identifier(row.get("start_date")),
        "completion_date": normalize_identifier(row.get("completion_date")),
        "expected_output": normalize_description(row.get("expected_output")),
        "source_of_funds": normalize_description(row.get("source_of_funds")),
        "amounts": {
            "personal_services_raw": ps_raw,
            "mooe_raw": mooe_raw,
            "financial_expenses_raw": None,
            "capital_outlay_raw": co_raw,
            "total_raw": total_raw,
            "personal_services": parse_amount(ps_raw),
            "maintenance_and_other_operating_expenses": parse_amount(mooe_raw),
            "financial_expenses": None,
            "capital_outlay": parse_amount(co_raw),
            "total": parse_amount(total_raw),
        },
        "errors": None,
        "source_refs": [],
    }
    row_signature = compute_row_signature(normalized)
    normalized["source_refs"] = [
        make_source_ref(
            page=page,
            kind="table_row",
            table_index=0,
            row_index=row_index,
            evidence_text=normalize_description(row.get("program_project_description")),
            row_signature=row_signature,
        )
    ]
    climate = {
        "climate_change_adaptation": normalize_identifier(row.get("climate_change_adaptation")),
        "climate_change_mitigation": normalize_identifier(row.get("climate_change_mitigation")),
        "cc_topology_code": normalize_identifier(row.get("cc_topology_code")),
        "prm_ncr_lgu_rm_objective_results_indicator": normalize_identifier(
            row.get("prm_ncr_lgu_rm_objective_results_indicator")
        ),
    }
    if any(value is not None for value in climate.values()):
        normalized["climate"] = climate

    normalized["project_key"] = build_project_key(normalized)
    normalized_project_key = normalize_identifier(normalized["project_key"])
    if normalized_project_key != normalized["project_key"]:
        key_normalized_change += 1
        normalized["project_key"] = normalized_project_key
    return ensure_project_has_provenance(normalized), key_normalized_change


def _dedupe_projects(projects: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[tuple[str, str, str, str, str, str], dict[str, Any]] = {}
    order: list[tuple[str, str, str, str, str, str]] = []
    for project in projects:
        amounts = project.get("amounts", {})
        key = (
            str(project.get("project_key") or ""),
            str(project.get("program_project_description") or ""),
            str(project.get("implementing_agency") or ""),
            str(project.get("start_date") or ""),
            str(project.get("completion_date") or ""),
            str(amounts.get("total_raw") if isinstance(amounts, dict) else ""),
        )
        existing = merged.get(key)
        if existing is None:
            merged[key] = project
            order.append(key)
            continue
        existing_refs = existing.get("source_refs") if isinstance(existing, dict) else []
        incoming_refs = project.get("source_refs") if isinstance(project, dict) else []
        existing["source_refs"] = normalize_source_refs(
            [*(existing_refs or []), *(incoming_refs or [])], default_kind="table_row"
        )
    return [merged[key] for key in order]


def extract_city_aip_from_pdf_page(
    *,
    client: OpenAI,
    pdf_path: str,
    page_index: int,
    total_pages: int,
    model: str,
    system_prompt: str,
    user_prompt: str,
) -> tuple[CityAIPExtraction, dict[str, Any]]:
    page_pdf = extract_single_page_pdf(pdf_path, page_index)
    with open(page_pdf, "rb") as file_handle:
        uploaded = client.files.create(file=file_handle, purpose="user_data")
    response = client.responses.parse(
        model=model,
        input=[
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "input_file", "file_id": uploaded.id},
                    {"type": "input_text", "text": user_prompt},
                ],
            },
        ],
        text_format=CityAIPExtraction,
        temperature=0,
    )
    try:
        os.remove(page_pdf)
    except OSError:
        pass
    parsed: CityAIPExtraction = response.output_parsed
    return parsed, safe_usage_dict(response)


def extract_city_aip_from_pdf_all_pages(
    *,
    client: OpenAI,
    pdf_path: str,
    model: str,
    on_progress: Callable[[int, int], None] | None,
    max_pages: int | None = None,
    parse_timeout_seconds: float | None = None,
    extract_timeout_seconds: float | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any], int]:
    parse_started = time.perf_counter()
    reader = PdfReader(pdf_path)
    parse_elapsed = time.perf_counter() - parse_started
    parse_timeout = _resolve_parse_timeout_seconds(parse_timeout_seconds)
    if parse_elapsed > parse_timeout:
        raise ExtractionGuardrailError(
            "PARSE_TIMEOUT",
            f"PDF parsing exceeded timeout ({parse_timeout:.2f}s).",
        )

    total_pages = len(reader.pages)
    if total_pages == 0:
        raise ValueError("PDF has no pages")

    resolved_max_pages = _resolve_max_pages(max_pages)
    if total_pages > resolved_max_pages:
        raise ExtractionGuardrailError(
            "PDF_PAGE_LIMIT_EXCEEDED",
            f"PDF has {total_pages} pages, exceeding limit of {resolved_max_pages}.",
        )

    extract_timeout = _resolve_extract_timeout_seconds(extract_timeout_seconds)
    extract_started = time.perf_counter()

    projects: list[dict[str, Any]] = []
    project_key_normalized_changes_count = 0
    usage_total: dict[str, Any] = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    system_prompt = read_text("prompts/extraction/city_system.txt")
    user_prompt = read_text("prompts/extraction/city_user.txt")
    for index in range(total_pages):
        if time.perf_counter() - extract_started > extract_timeout:
            raise ExtractionGuardrailError(
                "EXTRACT_TIMEOUT",
                f"Extraction exceeded timeout ({extract_timeout:.2f}s) after {index} page(s).",
            )
        page_data, page_usage = extract_city_aip_from_pdf_page(
            client=client,
            pdf_path=pdf_path,
            page_index=index,
            total_pages=total_pages,
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )
        for row_index, row in enumerate(page_data.projects):
            row_payload = row.model_dump(mode="python")
            normalized_row, normalized_changes = _normalize_city_row(row=row_payload, page=index + 1, row_index=row_index)
            project_key_normalized_changes_count += normalized_changes
            projects.append(normalized_row)
        for key in ["input_tokens", "output_tokens", "total_tokens"]:
            value = page_usage.get(key)
            if isinstance(value, int) and isinstance(usage_total.get(key), int):
                usage_total[key] += value
            else:
                usage_total[key] = None
        if on_progress:
            on_progress(index + 1, total_pages)
    deduped = _dedupe_projects(projects)
    return deduped, {**usage_total, "project_key_normalized_changes_count": project_key_normalized_changes_count}, total_pages


def run_extraction(
    pdf_path: str,
    model: str = "gpt-5.2",
    job_id: str | None = None,
    aip_id: str | None = None,
    uploaded_file_id: str | None = None,
    on_progress: Callable[[int, int], None] | None = None,
    client: OpenAI | None = None,
    max_pages: int | None = None,
    parse_timeout_seconds: float | None = None,
    extract_timeout_seconds: float | None = None,
) -> ExtractionResult:
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    resolved_client = client or build_openai_client()
    start_ts = time.perf_counter()
    projects, usage, page_count = extract_city_aip_from_pdf_all_pages(
        client=resolved_client,
        pdf_path=pdf_path,
        model=model,
        on_progress=on_progress,
        max_pages=max_pages,
        parse_timeout_seconds=parse_timeout_seconds,
        extract_timeout_seconds=extract_timeout_seconds,
    )
    document, doc_warnings = extract_document_metadata(pdf_path, scope="city", page_count_hint=page_count)
    fiscal_year = int(document.get("fiscal_year") or 0)
    lgu_name = None
    if isinstance(document.get("lgu"), dict):
        name_value = (document.get("lgu") or {}).get("name")
        if isinstance(name_value, str):
            lgu_name = name_value
    totals = (
        extract_totals_from_pdf(pdf_path=pdf_path, fiscal_year=fiscal_year, barangay_name=lgu_name)
        if fiscal_year > 0
        else []
    )
    warnings = list(doc_warnings)
    if not totals:
        print("[EXTRACTION][CITY] totals_not_found: total_investment_program", flush=True)
        warnings.append(
            {
                "code": "TOTALS_NOT_FOUND",
                "message": "totals_not_found: total_investment_program",
                "details": {"source_label": "total_investment_program"},
                "source_refs": [],
            }
        )

    quality = compute_quality(
        projects=projects,
        document=document,
        warnings=warnings,
        project_key_normalized_changes_count=int(usage.get("project_key_normalized_changes_count") or 0),
    )
    payload = make_stage_root(
        stage="extract",
        aip_id=aip_id or job_id or "local-aip",
        uploaded_file_id=uploaded_file_id,
        document=document,
        projects=projects,
        warnings=warnings,
        quality=quality,
        totals=totals,
    )
    json_str = json.dumps(payload, indent=2, ensure_ascii=False)
    elapsed = round(time.perf_counter() - start_ts, 4)
    print(f"[EXTRACTION][CITY] elapsed={elapsed:.2f}s projects={len(projects)} totals={len(totals)}", flush=True)
    return ExtractionResult(
        job_id=job_id,
        model=model,
        source_pdf=pdf_path,
        extracted={"projects": projects, "totals": totals},
        usage=usage,
        payload=payload,
        json_str=json_str,
    )
