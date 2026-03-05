from __future__ import annotations

from datetime import date, datetime
from typing import Any
from urllib.error import HTTPError

from openaip_pipeline.adapters.supabase.client import SupabaseRestClient
from openaip_pipeline.adapters.supabase.dto import ExtractionRunDTO, UploadedFileDTO
from openaip_pipeline.core.clock import now_utc_iso
from openaip_pipeline.services.line_items.embedding_text import build_line_item_embedding_text


ACTIVE_STAGE_ORDER = ["extract", "validate", "summarize", "categorize"]
STAGE_WEIGHTS: dict[str, int] = {"extract": 40, "validate": 20, "summarize": 15, "categorize": 25}
STAGE_START_MESSAGES: dict[str, str] = {
    "extract": "Starting extraction...",
    "validate": "Starting validation...",
    "summarize": "Starting summarization...",
    "categorize": "Starting categorization...",
}


def _clamp_pct(value: float) -> int:
    return max(0, min(100, int(round(value))))


def _compute_overall_pct(stage: str, stage_progress_pct: int) -> int:
    stage_progress_pct = _clamp_pct(stage_progress_pct)
    if stage not in STAGE_WEIGHTS:
        return 100 if stage_progress_pct >= 100 else 0
    completed_weight = 0.0
    for ordered_stage in ACTIVE_STAGE_ORDER:
        if ordered_stage == stage:
            break
        completed_weight += STAGE_WEIGHTS[ordered_stage]
    current_weight = STAGE_WEIGHTS[stage]
    overall = completed_weight + (current_weight * (stage_progress_pct / 100.0))
    return _clamp_pct(overall)


def _to_float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    text = text.replace("₱", "").replace(",", "").replace(" ", "")
    if text.startswith("(") and text.endswith(")"):
        text = "-" + text[1:-1]
    try:
        return float(text)
    except ValueError:
        return None


def _to_int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    try:
        return int(str(value).strip())
    except ValueError:
        return None


def _map_category(value: Any) -> str:
    if not isinstance(value, str):
        return "other"
    lowered = value.strip().lower()
    if lowered == "healthcare":
        return "health"
    if lowered == "infrastructure":
        return "infrastructure"
    if lowered == "health":
        return "health"
    return "other"


def _normalize_errors(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str):
        return [value]
    return value


def _normalize_text_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _to_iso_date_or_none(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if not text:
        return None
    for fmt in (
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%m/%d/%Y",
        "%m-%d-%Y",
        "%b %d, %Y",
        "%B %d, %Y",
        "%d %b %Y",
        "%d %B %Y",
    ):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text).date().isoformat()
    except ValueError:
        return None


def _derive_sector_code(aip_ref_code: Any) -> str | None:
    text = _normalize_text_or_none(aip_ref_code)
    if not text:
        return None
    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) >= 4:
        return digits[:4]
    return None


def _first_source_ref(project: dict[str, Any]) -> dict[str, Any] | None:
    refs = project.get("source_refs")
    if not isinstance(refs, list):
        return None
    for ref in refs:
        if isinstance(ref, dict):
            return ref
    return None


def _normalize_resume_stage(value: Any) -> str:
    text = _normalize_text_or_none(value)
    if not text:
        return "extract"
    lowered = text.lower()
    if lowered == "embed":
        return "categorize"
    if lowered in STAGE_START_MESSAGES:
        return lowered
    return "extract"


class PipelineRepository:
    def __init__(self, client: SupabaseRestClient):
        self.client = client

    def assert_progress_tracking_ready(self) -> None:
        try:
            self.client.select(
                "extraction_runs",
                select="id,overall_progress_pct,stage_progress_pct,progress_message,progress_updated_at",
                order="created_at.desc",
                limit=1,
            )
        except Exception as error:
            raise RuntimeError(
                "Progress tracking columns are unavailable in extraction_runs. "
                "Apply website/docs/sql/2026-02-19_extraction_run_progress.sql."
            ) from error

    def claim_next_queued_run(self) -> ExtractionRunDTO | None:
        rows = self.client.select(
            "extraction_runs",
            select=(
                "id,aip_id,uploaded_file_id,retry_of_run_id,resume_from_stage,"
                "model_name,status,stage,created_at"
            ),
            filters={"status": "eq.queued"},
            order="created_at.asc",
            limit=1,
        )
        if not rows:
            return None
        candidate = rows[0]
        initial_stage = _normalize_resume_stage(candidate.get("resume_from_stage"))
        claimed = self.client.update(
            "extraction_runs",
            {
                "status": "running",
                "stage": initial_stage,
                "started_at": now_utc_iso(),
                "finished_at": None,
                "error_code": None,
                "error_message": None,
                "overall_progress_pct": 0,
                "stage_progress_pct": 0,
                "progress_message": STAGE_START_MESSAGES[initial_stage],
                "progress_updated_at": now_utc_iso(),
            },
            filters={"id": f"eq.{candidate['id']}", "status": "eq.queued"},
            select=(
                "id,aip_id,uploaded_file_id,retry_of_run_id,resume_from_stage,"
                "model_name,status,stage,created_at"
            ),
        )
        if not claimed:
            return None
        return ExtractionRunDTO.from_row(claimed[0])

    def enqueue_run(
        self,
        *,
        aip_id: str,
        uploaded_file_id: str | None,
        model_name: str,
        created_by: str | None = None,
        retry_of_run_id: str | None = None,
        resume_from_stage: str | None = None,
    ) -> ExtractionRunDTO:
        normalized_resume_stage = _normalize_resume_stage(resume_from_stage) if resume_from_stage else None
        stage = normalized_resume_stage or "extract"
        row = {
            "aip_id": aip_id,
            "uploaded_file_id": uploaded_file_id,
            "retry_of_run_id": retry_of_run_id,
            "stage": stage,
            "resume_from_stage": normalized_resume_stage,
            "status": "queued",
            "model_name": model_name,
            "created_by": created_by,
        }
        inserted = self.client.insert(
            "extraction_runs",
            row,
            select=(
                "id,aip_id,uploaded_file_id,retry_of_run_id,resume_from_stage,"
                "model_name,status,stage,created_at"
            ),
        )
        if not inserted:
            raise RuntimeError("Failed to enqueue extraction run.")
        return ExtractionRunDTO.from_row(inserted[0])

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        rows = self.client.select(
            "extraction_runs",
            select=(
                "id,aip_id,uploaded_file_id,retry_of_run_id,resume_from_stage,"
                "stage,status,error_code,error_message,"
                "started_at,finished_at,created_at,overall_progress_pct,stage_progress_pct,"
                "progress_message,progress_updated_at"
            ),
            filters={"id": f"eq.{run_id}"},
            limit=1,
        )
        return rows[0] if rows else None

    def get_uploaded_file(self, run: ExtractionRunDTO | dict[str, Any]) -> UploadedFileDTO:
        uploaded_file_id = run.uploaded_file_id if isinstance(run, ExtractionRunDTO) else run.get("uploaded_file_id")
        if uploaded_file_id:
            rows = self.client.select(
                "uploaded_files",
                select="id,aip_id,bucket_id,object_name,original_file_name",
                filters={"id": f"eq.{uploaded_file_id}"},
                limit=1,
            )
            if rows:
                return UploadedFileDTO.from_row(rows[0])
        aip_id = run.aip_id if isinstance(run, ExtractionRunDTO) else run["aip_id"]
        rows = self.client.select(
            "uploaded_files",
            select="id,aip_id,bucket_id,object_name,original_file_name,created_at",
            filters={"aip_id": f"eq.{aip_id}", "is_current": "eq.true"},
            order="created_at.desc",
            limit=1,
        )
        if not rows:
            raise RuntimeError("No uploaded file found for extraction run.")
        return UploadedFileDTO.from_row(rows[0])

    def get_aip_scope(self, aip_id: str) -> str:
        context = self.get_aip_context(aip_id)
        if context.get("city_id"):
            return "city"
        if context.get("municipality_id"):
            return "municipality"
        return "barangay"

    def get_aip_context(self, aip_id: str) -> dict[str, Any]:
        rows = self.client.select(
            "aips",
            select="id,fiscal_year,barangay_id,city_id,municipality_id",
            filters={"id": f"eq.{aip_id}"},
            limit=1,
        )
        if not rows:
            raise RuntimeError("AIP not found for extraction run.")
        return rows[0]

    def set_run_progress(
        self,
        *,
        run_id: str,
        stage: str,
        stage_progress_pct: int,
        progress_message: str | None = None,
    ) -> None:
        patch: dict[str, Any] = {
            "stage": stage,
            "status": "running",
            "stage_progress_pct": _clamp_pct(stage_progress_pct),
            "overall_progress_pct": _compute_overall_pct(stage, stage_progress_pct),
            "progress_updated_at": now_utc_iso(),
        }
        if progress_message is not None:
            patch["progress_message"] = progress_message
        self.client.update("extraction_runs", patch, filters={"id": f"eq.{run_id}"})

    def set_run_stage(self, *, run_id: str, stage: str) -> None:
        self.set_run_progress(
            run_id=run_id,
            stage=stage,
            stage_progress_pct=0,
            progress_message=STAGE_START_MESSAGES.get(stage, f"Starting {stage}..."),
        )

    def set_run_failed(self, *, run_id: str, stage: str, error_message: str) -> None:
        self.client.update(
            "extraction_runs",
            {
                "status": "failed",
                "stage": stage,
                "finished_at": now_utc_iso(),
                "error_message": error_message,
                "progress_message": error_message,
                "progress_updated_at": now_utc_iso(),
            },
            filters={"id": f"eq.{run_id}"},
        )

    def set_run_succeeded(self, *, run_id: str) -> None:
        self.client.update(
            "extraction_runs",
            {
                "status": "succeeded",
                "stage": "categorize",
                "finished_at": now_utc_iso(),
                "error_code": None,
                "error_message": None,
                "overall_progress_pct": 100,
                "stage_progress_pct": 100,
                "progress_message": None,
                "progress_updated_at": now_utc_iso(),
            },
            filters={"id": f"eq.{run_id}"},
        )

    def insert_artifact(
        self,
        *,
        run_id: str,
        aip_id: str,
        artifact_type: str,
        artifact_json: dict[str, Any] | None,
        artifact_text: str | None = None,
    ) -> str:
        rows = self.client.insert(
            "extraction_artifacts",
            {
                "run_id": run_id,
                "aip_id": aip_id,
                "artifact_type": artifact_type,
                "artifact_json": artifact_json,
                "artifact_text": artifact_text,
            },
            select="id",
        )
        if not rows:
            raise RuntimeError(f"Failed to insert artifact: {artifact_type}")
        return str(rows[0]["id"])

    def get_stage_artifact(self, *, run_id: str, artifact_type: str) -> dict[str, Any] | None:
        rows = self.client.select(
            "extraction_artifacts",
            select="artifact_json",
            filters={
                "run_id": f"eq.{run_id}",
                "artifact_type": f"eq.{artifact_type}",
            },
            order="created_at.desc",
            limit=1,
        )
        if not rows:
            return None
        payload = rows[0].get("artifact_json")
        if not isinstance(payload, dict):
            return None
        return payload

    def get_parent_run_id(self, *, run_id: str) -> str | None:
        rows = self.client.select(
            "extraction_runs",
            select="retry_of_run_id",
            filters={"id": f"eq.{run_id}"},
            limit=1,
        )
        if not rows:
            return None
        parent = rows[0].get("retry_of_run_id")
        text = _normalize_text_or_none(parent)
        return text

    def upsert_aip_totals(self, *, aip_id: str, totals: Any) -> None:
        if not isinstance(totals, list) or not totals:
            return

        aip_context = self.get_aip_context(aip_id)
        fiscal_year = _to_int_or_none(aip_context.get("fiscal_year"))
        if fiscal_year is None:
            return

        barangay_id = aip_context.get("barangay_id")
        city_id = aip_context.get("city_id")
        municipality_id = aip_context.get("municipality_id")

        for item in totals:
            if not isinstance(item, dict):
                continue
            if str(item.get("source_label") or "").strip() != "total_investment_program":
                continue

            value = _to_float_or_none(item.get("value"))
            evidence_text = str(item.get("evidence_text") or "").strip()
            if value is None or not evidence_text:
                continue

            page_no = _to_int_or_none(item.get("page_no"))
            currency = str(item.get("currency") or "PHP").strip() or "PHP"
            payload = {
                "aip_id": aip_id,
                "fiscal_year": fiscal_year,
                "barangay_id": barangay_id,
                "city_id": city_id,
                "municipality_id": municipality_id,
                "total_investment_program": value,
                "currency": currency,
                "page_no": page_no,
                "evidence_text": evidence_text,
                "source_label": "total_investment_program",
            }
            self.client.insert(
                "aip_totals",
                payload,
                on_conflict="aip_id,source_label",
                upsert=True,
            )

    def upsert_projects(
        self,
        *,
        aip_id: str,
        extraction_artifact_id: str,
        projects: Any,
    ) -> None:
        if not isinstance(projects, list):
            return
        existing_rows = self.client.select(
            "projects",
            select="id,aip_ref_code,is_human_edited",
            filters={"aip_id": f"eq.{aip_id}"},
        )
        existing_by_ref = {
            row["aip_ref_code"].lower(): row
            for row in existing_rows
            if isinstance(row.get("aip_ref_code"), str) and row.get("aip_ref_code")
        }
        for raw in projects:
            if not isinstance(raw, dict):
                continue
            ref_code = str(raw.get("aip_ref_code") or "").strip()
            if not ref_code:
                continue
            ref_key = ref_code.lower()
            existing = existing_by_ref.get(ref_key)
            if existing and bool(existing.get("is_human_edited")):
                continue
            amounts = raw.get("amounts") if isinstance(raw.get("amounts"), dict) else {}
            climate = raw.get("climate") if isinstance(raw.get("climate"), dict) else {}
            classification = raw.get("classification") if isinstance(raw.get("classification"), dict) else {}
            payload = {
                "extraction_artifact_id": extraction_artifact_id,
                "aip_ref_code": ref_code,
                "program_project_description": str(raw.get("program_project_description") or "Unspecified project"),
                "implementing_agency": raw.get("implementing_agency"),
                "start_date": raw.get("start_date"),
                "completion_date": raw.get("completion_date"),
                "expected_output": raw.get("expected_output"),
                "source_of_funds": raw.get("source_of_funds"),
                "personal_services": _to_float_or_none(
                    amounts.get("personal_services", raw.get("personal_services"))
                ),
                "maintenance_and_other_operating_expenses": _to_float_or_none(
                    amounts.get(
                        "maintenance_and_other_operating_expenses",
                        raw.get("maintenance_and_other_operating_expenses"),
                    )
                ),
                "financial_expenses": _to_float_or_none(amounts.get("financial_expenses", raw.get("financial_expenses"))),
                "capital_outlay": _to_float_or_none(amounts.get("capital_outlay", raw.get("capital_outlay"))),
                "total": _to_float_or_none(amounts.get("total", raw.get("total"))),
                "climate_change_adaptation": climate.get(
                    "climate_change_adaptation", raw.get("climate_change_adaptation")
                ),
                "climate_change_mitigation": climate.get(
                    "climate_change_mitigation", raw.get("climate_change_mitigation")
                ),
                "cc_topology_code": climate.get("cc_topology_code", raw.get("cc_topology_code")),
                "prm_ncr_lgu_rm_objective_results_indicator": climate.get(
                    "prm_ncr_lgu_rm_objective_results_indicator",
                    raw.get("prm_ncr_lgu_rm_objective_results_indicator"),
                ),
                "errors": _normalize_errors(raw.get("errors")),
                "category": _map_category(classification.get("category", raw.get("category"))),
            }
            if existing:
                self.client.update("projects", payload, filters={"id": f"eq.{existing['id']}"})
                continue
            create_payload = dict(payload)
            create_payload["aip_id"] = aip_id
            try:
                inserted = self.client.insert("projects", create_payload, select="id,aip_ref_code,is_human_edited")
                if inserted:
                    existing_by_ref[ref_key] = inserted[0]
            except HTTPError as error:
                if error.code != 409:
                    raise RuntimeError(
                        (
                            "Failed to insert project row. "
                            f"aip_id={aip_id} aip_ref_code={ref_code} error={error}"
                        )
                    ) from error
                conflict_rows = self.client.select(
                    "projects",
                    select="id,aip_ref_code,is_human_edited",
                    filters={"aip_id": f"eq.{aip_id}", "aip_ref_code": f"eq.{ref_code}"},
                    limit=1,
                )
                if not conflict_rows:
                    raise RuntimeError(
                        (
                            "Project insert returned HTTP 409 but lookup found no conflicting row. "
                            f"aip_id={aip_id} aip_ref_code={ref_code} error={error}"
                        )
                    ) from error
                conflict_row = conflict_rows[0]
                existing_by_ref[ref_key] = conflict_row
                if bool(conflict_row.get("is_human_edited")):
                    continue
                self.client.update("projects", payload, filters={"id": f"eq.{conflict_row['id']}"})

    def upsert_aip_line_items(self, *, aip_id: str, projects: Any) -> list[dict[str, Any]]:
        if not isinstance(projects, list) or not projects:
            return []

        aip_context = self.get_aip_context(aip_id)
        fiscal_year = _to_int_or_none(aip_context.get("fiscal_year"))
        if fiscal_year is None:
            return []

        barangay_id = _normalize_text_or_none(aip_context.get("barangay_id"))
        existing_rows = self.client.select(
            "aip_line_items",
            select="id,aip_ref_code,page_no,row_no,table_no",
            filters={"aip_id": f"eq.{aip_id}"},
        )

        existing_by_ref: dict[str, dict[str, Any]] = {}
        existing_by_provenance: dict[tuple[int, int, int], dict[str, Any]] = {}
        for existing in existing_rows:
            existing_id = _normalize_text_or_none(existing.get("id"))
            if not existing_id:
                continue
            ref_code = _normalize_text_or_none(existing.get("aip_ref_code"))
            if ref_code:
                existing_by_ref[ref_code.lower()] = existing
                continue
            page_no = _to_int_or_none(existing.get("page_no"))
            row_no = _to_int_or_none(existing.get("row_no"))
            table_no = _to_int_or_none(existing.get("table_no"))
            if page_no is not None and row_no is not None and table_no is not None:
                existing_by_provenance[(page_no, row_no, table_no)] = existing

        upserted_items: list[dict[str, Any]] = []
        for raw_project in projects:
            if not isinstance(raw_project, dict):
                continue

            amounts = raw_project.get("amounts") if isinstance(raw_project.get("amounts"), dict) else {}
            classification = (
                raw_project.get("classification") if isinstance(raw_project.get("classification"), dict) else {}
            )

            source_ref = _first_source_ref(raw_project) or {}
            page_no = _to_int_or_none(source_ref.get("page"))
            row_no = _to_int_or_none(source_ref.get("row_index"))
            table_no = _to_int_or_none(source_ref.get("table_index"))

            aip_ref_code = _normalize_text_or_none(raw_project.get("aip_ref_code"))
            if not aip_ref_code and (page_no is None or row_no is None or table_no is None):
                # Skip rows without a stable idempotent key.
                continue
            sector_code = (
                _normalize_text_or_none(raw_project.get("sector_code"))
                or _normalize_text_or_none(classification.get("sector_code"))
                or _derive_sector_code(aip_ref_code)
            )
            sector_name = (
                _normalize_text_or_none(raw_project.get("sector_name"))
                or _normalize_text_or_none(classification.get("sector_name"))
            )
            payload = {
                "aip_id": aip_id,
                "fiscal_year": fiscal_year,
                "barangay_id": barangay_id,
                "aip_ref_code": aip_ref_code,
                "sector_code": sector_code,
                "sector_name": sector_name,
                "program_project_title": _normalize_text_or_none(raw_project.get("program_project_description"))
                or "Unspecified project",
                "implementing_agency": _normalize_text_or_none(raw_project.get("implementing_agency")),
                "start_date": _to_iso_date_or_none(raw_project.get("start_date")),
                "end_date": _to_iso_date_or_none(raw_project.get("completion_date")),
                "fund_source": _normalize_text_or_none(raw_project.get("source_of_funds")),
                "ps": _to_float_or_none(amounts.get("personal_services", raw_project.get("personal_services"))),
                "mooe": _to_float_or_none(
                    amounts.get(
                        "maintenance_and_other_operating_expenses",
                        raw_project.get("maintenance_and_other_operating_expenses"),
                    )
                ),
                "co": _to_float_or_none(amounts.get("capital_outlay", raw_project.get("capital_outlay"))),
                "fe": _to_float_or_none(amounts.get("financial_expenses", raw_project.get("financial_expenses"))),
                "total": _to_float_or_none(amounts.get("total", raw_project.get("total"))),
                "expected_output": _normalize_text_or_none(raw_project.get("expected_output")),
                "page_no": page_no,
                "row_no": row_no,
                "table_no": table_no,
            }

            existing: dict[str, Any] | None = None
            if aip_ref_code:
                existing = existing_by_ref.get(aip_ref_code.lower())
            elif page_no is not None and row_no is not None and table_no is not None:
                existing = existing_by_provenance.get((page_no, row_no, table_no))

            if existing:
                existing_id = _normalize_text_or_none(existing.get("id"))
                if not existing_id:
                    continue
                updated = self.client.update(
                    "aip_line_items",
                    payload,
                    filters={"id": f"eq.{existing_id}"},
                    select="id",
                )
                row_id = _normalize_text_or_none(updated[0].get("id")) if updated else existing_id
                payload_with_id = {
                    **payload,
                    "id": row_id,
                    "barangay_name": None,
                    "embedding_text": build_line_item_embedding_text(
                        {
                            **payload,
                            "id": row_id,
                            "barangay_id": barangay_id,
                            "barangay_name": None,
                        }
                    ),
                }
                upserted_items.append(payload_with_id)
                continue

            inserted = self.client.insert("aip_line_items", payload, select="id")
            if not inserted:
                continue
            row_id = _normalize_text_or_none(inserted[0].get("id"))
            if not row_id:
                continue

            created_row = {
                "id": row_id,
                "aip_ref_code": aip_ref_code,
                "page_no": page_no,
                "row_no": row_no,
                "table_no": table_no,
            }
            if aip_ref_code:
                existing_by_ref[aip_ref_code.lower()] = created_row
            elif page_no is not None and row_no is not None and table_no is not None:
                existing_by_provenance[(page_no, row_no, table_no)] = created_row

            payload_with_id = {
                **payload,
                "id": row_id,
                "barangay_name": None,
                "embedding_text": build_line_item_embedding_text(
                    {
                        **payload,
                        "id": row_id,
                        "barangay_id": barangay_id,
                        "barangay_name": None,
                    }
                ),
            }
            upserted_items.append(payload_with_id)

        return upserted_items

    def upsert_aip_line_item_embeddings(
        self,
        *,
        line_items: list[dict[str, Any]],
        model: str,
    ) -> None:
        if not line_items:
            return

        for item in line_items:
            line_item_id = _normalize_text_or_none(item.get("line_item_id"))
            embedding = item.get("embedding")
            if not line_item_id or not isinstance(embedding, list):
                continue
            if not all(isinstance(value, (int, float)) for value in embedding):
                continue
            payload = {
                "line_item_id": line_item_id,
                "embedding": embedding,
                "model": model,
            }
            self.client.insert(
                "aip_line_item_embeddings",
                payload,
                on_conflict="line_item_id",
                upsert=True,
            )
