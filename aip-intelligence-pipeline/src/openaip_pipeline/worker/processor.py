from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
import tempfile
import time
import traceback
from typing import Any

from openaip_pipeline.adapters.supabase.repositories import PipelineRepository
from openaip_pipeline.core.settings import Settings
from openaip_pipeline.services.categorization.categorize import categorize_from_summarized_json_str
from openaip_pipeline.services.extraction.barangay import run_extraction as run_barangay_extraction
from openaip_pipeline.services.extraction.city import run_extraction as run_city_extraction
from openaip_pipeline.services.openai_utils import build_openai_client
from openaip_pipeline.services.rag.rag import answer_with_rag
from openaip_pipeline.services.scaling.scale_amounts import scale_validated_amounts_json_str
from openaip_pipeline.services.summarization.summarize import summarize_aip_overall_json_str
from openaip_pipeline.services.validation.barangay import validate_projects_json_str as validate_barangay
from openaip_pipeline.services.validation.city import validate_projects_json_str as validate_city
from openaip_pipeline.worker.progress import clamp_pct, read_positive_float_env, run_with_heartbeat

VALIDATION_FIXED_BATCH_SIZE = 25


class PipelineGuardrailError(RuntimeError):
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


def _normalize_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _extract_reason_code(error: Exception) -> str:
    reason_code = getattr(error, "reason_code", None)
    if isinstance(reason_code, str) and reason_code.strip():
        return reason_code.strip().upper()
    return "PIPELINE_ERROR"


def _set_run_error_code(*, repo: PipelineRepository, run_id: str, reason_code: str) -> None:
    repo.client.update(
        "extraction_runs",
        {"error_code": reason_code},
        filters={"id": f"eq.{run_id}"},
    )


def _enforce_retry_guardrail(*, repo: PipelineRepository, run_id: str, aip_id: str, fallback_uploaded_file_id: str | None) -> None:
    retry_window_seconds = _read_positive_int_env("PIPELINE_RETRY_FAILURE_WINDOW_SECONDS", 6 * 60 * 60)
    retry_threshold = _read_positive_int_env("PIPELINE_RETRY_FAILURE_THRESHOLD", 5)

    run_rows = repo.client.select(
        "extraction_runs",
        select="created_by,uploaded_file_id",
        filters={"id": f"eq.{run_id}"},
        limit=1,
    )
    run_row = run_rows[0] if run_rows else {}
    created_by = _normalize_optional_text(run_row.get("created_by"))
    uploaded_file_id = _normalize_optional_text(run_row.get("uploaded_file_id")) or fallback_uploaded_file_id

    if not created_by or not uploaded_file_id:
        return

    window_start = datetime.now(timezone.utc) - timedelta(seconds=retry_window_seconds)
    failed_rows = repo.client.select(
        "extraction_runs",
        select="id",
        filters={
            "created_by": f"eq.{created_by}",
            "uploaded_file_id": f"eq.{uploaded_file_id}",
            "aip_id": f"eq.{aip_id}",
            "status": "eq.failed",
            "created_at": f"gte.{window_start.isoformat()}",
        },
        limit=retry_threshold,
    )
    if len(failed_rows) >= retry_threshold:
        raise PipelineGuardrailError(
            "RUN_RETRY_BLOCKED",
            (
                "Retry blocked after repeated failed processing attempts for the same "
                f"uploader/file within {retry_window_seconds} seconds."
            ),
        )


# Security proof:
# - PIPELINE_RETRY_FAILURE_THRESHOLD (default 5) + PIPELINE_RETRY_FAILURE_WINDOW_SECONDS (default 21600) block endless retries.
# - PIPELINE_EMBED_TIMEOUT_SECONDS (default 300) bounds embedding duration with EMBED_TIMEOUT.
# - Failed runs persist extraction_runs.error_code (for example RUN_RETRY_BLOCKED, EMBED_TIMEOUT, PARSE_TIMEOUT).


def _sanitize_error(message: str, settings: Settings) -> str:
    sanitized = message
    for secret in [settings.openai_api_key, settings.supabase_service_key]:
        if secret:
            sanitized = sanitized.replace(secret, "[REDACTED]")
    return sanitized


def _persist_stage_artifact(
    *,
    repo: PipelineRepository,
    run_id: str,
    aip_id: str,
    stage: str,
    payload: dict[str, Any],
    text: str | None,
) -> str:
    return repo.insert_artifact(
        run_id=run_id,
        aip_id=aip_id,
        artifact_type=stage,
        artifact_json=payload,
        artifact_text=text,
    )


def _embed_line_items(*, settings: Settings, line_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not line_items:
        return []

    batch_size = max(1, min(128, int(os.getenv("PIPELINE_LINE_ITEM_EMBED_BATCH_SIZE", "64") or "64")))
    embed_timeout_seconds = read_positive_float_env("PIPELINE_EMBED_TIMEOUT_SECONDS", 300.0)
    embed_started = time.perf_counter()
    client = build_openai_client(settings.openai_api_key)
    embedded: list[dict[str, Any]] = []

    for start in range(0, len(line_items), batch_size):
        if time.perf_counter() - embed_started > embed_timeout_seconds:
            raise PipelineGuardrailError(
                "EMBED_TIMEOUT",
                f"Embedding exceeded timeout ({embed_timeout_seconds:.2f}s).",
            )

        batch = line_items[start : start + batch_size]
        texts = [str(item.get("embedding_text") or "").strip() for item in batch]
        if not all(texts):
            continue

        response = client.embeddings.create(model=settings.embedding_model, input=texts)
        data = list(getattr(response, "data", []) or [])
        for index, row in enumerate(batch):
            if index >= len(data):
                continue
            line_item_id = str(row.get("id") or "").strip()
            embedding = getattr(data[index], "embedding", None)
            if not line_item_id or not isinstance(embedding, list):
                continue
            if not all(isinstance(value, (int, float)) for value in embedding):
                continue
            embedded.append(
                {
                    "line_item_id": line_item_id,
                    "embedding": [float(value) for value in embedding],
                }
            )
    return embedded


def _normalize_resume_start_stage(value: Any) -> str:
    stage = _normalize_optional_text(value)
    if not stage:
        return "extract"
    lowered = stage.lower()
    if lowered == "embed":
        return "categorize"
    if lowered in {"extract", "validate", "scale_amounts", "summarize", "categorize"}:
        return lowered
    return "extract"


def _required_input_artifact_type(start_stage: str) -> str | None:
    if start_stage == "validate":
        return "extract"
    if start_stage == "scale_amounts":
        return "validate"
    if start_stage == "summarize":
        return "scale_amounts"
    if start_stage == "categorize":
        return "summarize"
    return None


def _is_resumable_stage_payload(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    projects = payload.get("projects")
    return isinstance(projects, list)


def _extract_summary_text(payload: dict[str, Any]) -> str | None:
    summary = payload.get("summary")
    if not isinstance(summary, dict):
        return None
    text = summary.get("text")
    if not isinstance(text, str):
        return None
    cleaned = text.strip()
    return cleaned or None


def _find_artifact_in_run_lineage(
    *,
    repo: PipelineRepository,
    start_run_id: str,
    artifact_type: str,
) -> tuple[dict[str, Any] | None, str | None]:
    visited: set[str] = set()
    cursor: str | None = start_run_id
    while cursor and cursor not in visited:
        visited.add(cursor)
        artifact = repo.get_stage_artifact(run_id=cursor, artifact_type=artifact_type)
        if artifact is not None:
            return artifact, cursor
        cursor = repo.get_parent_run_id(run_id=cursor)
    return None, None


def process_run(*, repo: PipelineRepository, settings: Settings, run: dict[str, Any]) -> None:
    run_id = str(run["id"])
    aip_id = str(run["aip_id"])
    model_name = str(run.get("model_name") or settings.pipeline_model)
    current_stage = _normalize_resume_start_stage(run.get("resume_from_stage"))
    tmp_pdf_path: str | None = None
    try:
        _enforce_retry_guardrail(
            repo=repo,
            run_id=run_id,
            aip_id=aip_id,
            fallback_uploaded_file_id=_normalize_optional_text(run.get("uploaded_file_id")),
        )

        start_stage = _normalize_resume_start_stage(run.get("resume_from_stage"))
        extraction_payload: dict[str, Any] | None = None
        validation_payload: dict[str, Any] | None = None
        scaled_payload: dict[str, Any] | None = None
        summary_payload: dict[str, Any] | None = None
        summary_text: str | None = None

        required_artifact_type = _required_input_artifact_type(start_stage)
        if required_artifact_type:
            prerequisite_payload, source_run_id = _find_artifact_in_run_lineage(
                repo=repo,
                start_run_id=run_id,
                artifact_type=required_artifact_type,
            )
            if not _is_resumable_stage_payload(prerequisite_payload):
                print(
                    (
                        f"[WORKER][RESUME] run={run_id} stage={start_stage} missing/corrupt "
                        f"{required_artifact_type} artifact in retry lineage; falling back to extract"
                    ),
                    flush=True,
                )
                start_stage = "extract"
            else:
                print(
                    (
                        f"[WORKER][RESUME] run={run_id} stage={start_stage} "
                        f"reusing {required_artifact_type} artifact from run={source_run_id}"
                    ),
                    flush=True,
                )
                if required_artifact_type == "extract":
                    extraction_payload = prerequisite_payload
                elif required_artifact_type == "validate":
                    validation_payload = prerequisite_payload
                elif required_artifact_type == "scale_amounts":
                    scaled_payload = prerequisite_payload
                elif required_artifact_type == "summarize":
                    summary_payload = prerequisite_payload
                    summary_text = _extract_summary_text(summary_payload)

        current_stage = start_stage
        aip_scope = repo.get_aip_scope(aip_id)
        extraction_fn = run_city_extraction if aip_scope == "city" else run_barangay_extraction
        validation_fn = validate_city if aip_scope == "city" else validate_barangay
        if required_artifact_type == "extract" and aip_scope != "city":
            repo.upsert_aip_totals(
                aip_id=aip_id,
                totals=extraction_payload.get("totals")
                if isinstance(extraction_payload, dict)
                else [],
            )
        if required_artifact_type == "scale_amounts" and aip_scope == "city":
            repo.upsert_aip_totals(
                aip_id=aip_id,
                totals=scaled_payload.get("totals")
                if isinstance(scaled_payload, dict)
                else [],
            )
        if start_stage == "extract":
            current_stage = "extract"
            repo.set_run_stage(run_id=run_id, stage=current_stage)
            uploaded = repo.get_uploaded_file(run)
            signed_url = repo.client.create_signed_url(uploaded.bucket_id, uploaded.object_name, expires_in=600)
            pdf_bytes = repo.client.download_bytes(signed_url)
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(pdf_bytes)
                tmp_pdf_path = tmp.name

            def extraction_progress(done_pages: int, total_pages: int) -> None:
                if total_pages <= 0:
                    return
                pct = clamp_pct((done_pages * 100) / total_pages)
                repo.set_run_progress(
                    run_id=run_id,
                    stage=current_stage,
                    stage_progress_pct=pct,
                    progress_message=f"Extracting page {done_pages}/{total_pages}...",
                )

            extraction_res = extraction_fn(
                tmp_pdf_path,
                model=model_name,
                job_id=run_id,
                aip_id=aip_id,
                uploaded_file_id=uploaded.id,
                on_progress=extraction_progress,
            )
            extraction_payload = extraction_res.payload
            repo.set_run_progress(
                run_id=run_id,
                stage=current_stage,
                stage_progress_pct=100,
                progress_message="Extraction complete.",
            )
            _persist_stage_artifact(
                repo=repo,
                run_id=run_id,
                aip_id=aip_id,
                stage="extract",
                payload=extraction_payload,
                text=None,
            )
            if aip_scope != "city":
                repo.upsert_aip_totals(
                    aip_id=aip_id,
                    totals=extraction_payload.get("totals")
                    if isinstance(extraction_payload, dict)
                    else [],
                )

        if start_stage in {"extract", "validate"}:
            if not _is_resumable_stage_payload(extraction_payload):
                raise RuntimeError("Validation cannot start because extraction payload is unavailable.")

            current_stage = "validate"
            repo.set_run_stage(run_id=run_id, stage=current_stage)
            repo.set_run_progress(
                run_id=run_id,
                stage=current_stage,
                stage_progress_pct=0,
                progress_message=(
                    "Validation configured with fixed chunk size: "
                    f"{VALIDATION_FIXED_BATCH_SIZE} project(s) per request."
                ),
            )

            def validation_progress(
                done_projects: int,
                total_projects: int,
                batch_no: int,
                total_batches: int,
                message: str,
            ) -> None:
                pct = 100 if total_projects <= 0 else clamp_pct((done_projects * 100) / total_projects)
                repo.set_run_progress(
                    run_id=run_id,
                    stage=current_stage,
                    stage_progress_pct=pct,
                    progress_message=message,
                )
                print(
                    (
                        "[WORKER][VALIDATE] "
                        f"run={run_id} done={done_projects}/{total_projects} "
                        f"chunk={batch_no}/{total_batches} message={message}"
                    ),
                    flush=True,
                )

            validation_res = validation_fn(
                json.dumps(extraction_payload, ensure_ascii=False),
                model=model_name,
                batch_size=VALIDATION_FIXED_BATCH_SIZE,
                on_progress=validation_progress,
            )
            validation_payload = validation_res.validated_obj
            repo.set_run_progress(
                run_id=run_id,
                stage=current_stage,
                stage_progress_pct=100,
                progress_message="Validation complete.",
            )
            _persist_stage_artifact(
                repo=repo,
                run_id=run_id,
                aip_id=aip_id,
                stage="validate",
                payload=validation_payload,
                text=None,
            )

        if start_stage in {"extract", "validate", "scale_amounts"}:
            if not _is_resumable_stage_payload(validation_payload):
                raise RuntimeError("Amount scaling cannot start because validation payload is unavailable.")

            current_stage = "scale_amounts"
            repo.set_run_stage(run_id=run_id, stage=current_stage)
            repo.set_run_progress(
                run_id=run_id,
                stage=current_stage,
                stage_progress_pct=0,
                progress_message="Scaling city monetary fields by 1000...",
            )
            scale_res = scale_validated_amounts_json_str(
                json.dumps(validation_payload, ensure_ascii=False),
                scope=aip_scope,
            )
            scaled_payload = scale_res.scaled_obj
            repo.set_run_progress(
                run_id=run_id,
                stage=current_stage,
                stage_progress_pct=100,
                progress_message="Amount scaling complete.",
            )
            _persist_stage_artifact(
                repo=repo,
                run_id=run_id,
                aip_id=aip_id,
                stage="scale_amounts",
                payload=scaled_payload,
                text=None,
            )
            if aip_scope == "city":
                repo.upsert_aip_totals(
                    aip_id=aip_id,
                    totals=scaled_payload.get("totals")
                    if isinstance(scaled_payload, dict)
                    else [],
                )

        if start_stage in {"extract", "validate", "scale_amounts", "summarize"}:
            if not _is_resumable_stage_payload(scaled_payload):
                raise RuntimeError("Summarization cannot start because scaled payload is unavailable.")

            current_stage = "summarize"
            repo.set_run_stage(run_id=run_id, stage=current_stage)
            summary_res = run_with_heartbeat(
                repo=repo,
                run_id=run_id,
                stage=current_stage,
                expected_seconds=read_positive_float_env("PIPELINE_SUMMARIZE_EXPECTED_SECONDS", 60.0),
                message_prefix="Generating summary",
                fn=lambda: summarize_aip_overall_json_str(
                    json.dumps(scaled_payload, ensure_ascii=False),
                    model=model_name,
                ),
            )
            summary_payload = summary_res.summary_obj
            summary_text = summary_res.summary_text
            _persist_stage_artifact(
                repo=repo,
                run_id=run_id,
                aip_id=aip_id,
                stage="summarize",
                payload=summary_payload,
                text=summary_text,
            )

        if not _is_resumable_stage_payload(summary_payload):
            raise RuntimeError("Categorization cannot start because summarize payload is unavailable.")

        current_stage = "categorize"
        repo.set_run_stage(run_id=run_id, stage=current_stage)

        def categorize_progress(
            categorized_count: int,
            total_count: int,
            batch_no: int,
            total_batches: int,
        ) -> None:
            pct = 100 if total_count <= 0 else clamp_pct((categorized_count * 100) / total_count)
            repo.set_run_progress(
                run_id=run_id,
                stage=current_stage,
                stage_progress_pct=pct,
                progress_message=(
                    f"Categorizing projects {categorized_count}/{total_count} "
                    f"(chunk {batch_no}/{total_batches})..."
                ),
            )

        categorized_res = categorize_from_summarized_json_str(
            json.dumps(summary_payload, ensure_ascii=False),
            model=model_name,
            batch_size=settings.batch_size,
            on_progress=categorize_progress,
        )
        repo.set_run_progress(
            run_id=run_id,
            stage=current_stage,
            stage_progress_pct=100,
            progress_message="Categorization complete. Saving artifacts...",
        )
        categorize_artifact_id = _persist_stage_artifact(
            repo=repo,
            run_id=run_id,
            aip_id=aip_id,
            stage="categorize",
            payload=categorized_res.categorized_obj,
            text=summary_text,
        )
        repo.upsert_projects(
            aip_id=aip_id,
            extraction_artifact_id=categorize_artifact_id,
            projects=categorized_res.categorized_obj.get("projects", []),
        )
        line_items = repo.upsert_aip_line_items(
            aip_id=aip_id,
            projects=categorized_res.categorized_obj.get("projects", []),
        )
        if line_items:
            embedded_rows = _embed_line_items(settings=settings, line_items=line_items)
            repo.upsert_aip_line_item_embeddings(
                line_items=embedded_rows,
                model=settings.embedding_model,
            )

        if settings.enable_rag:
            rag_query = os.getenv("PIPELINE_RAG_TRACE_QUERY", "").strip()
            if rag_query:
                rag_trace = answer_with_rag(
                    supabase_url=settings.supabase_url,
                    supabase_service_key=settings.supabase_service_key,
                    openai_api_key=settings.openai_api_key,
                    embeddings_model=settings.embedding_model,
                    chat_model=model_name,
                    question=rag_query,
                    metadata_filter={"aip_id": aip_id, "run_id": run_id},
                )
                _persist_stage_artifact(
                    repo=repo,
                    run_id=run_id,
                    aip_id=aip_id,
                    stage="embed",
                    payload={"rag_trace": rag_trace},
                    text=None,
                )

        repo.set_run_progress(
            run_id=run_id,
            stage=current_stage,
            stage_progress_pct=100,
            progress_message="Finalizing processing run. Redirecting shortly...",
        )
        repo.set_run_succeeded(run_id=run_id)
        print(f"[WORKER] run {run_id} succeeded")
    except Exception as error:
        reason_code = _extract_reason_code(error)
        trace_summary = "".join(traceback.format_exception(type(error), error, error.__traceback__))
        sanitized_trace = _sanitize_error(trace_summary, settings)
        sanitized_message = _sanitize_error(str(error), settings)
        try:
            _persist_stage_artifact(
                repo=repo,
                run_id=run_id,
                aip_id=aip_id,
                stage=current_stage
                if current_stage in {"extract", "validate", "scale_amounts", "summarize", "categorize", "embed"}
                else "extract",
                payload={
                    "error": sanitized_message,
                    "reason_code": reason_code,
                    "trace_summary": sanitized_trace[:8000],
                },
                text=None,
            )
        except Exception:
            pass
        repo.set_run_failed(run_id=run_id, stage=current_stage, error_message=sanitized_message)
        try:
            _set_run_error_code(repo=repo, run_id=run_id, reason_code=reason_code)
        except Exception:
            pass
        print(f"[WORKER] run {run_id} failed: {reason_code} {sanitized_message}")
    finally:
        if tmp_pdf_path and os.path.exists(tmp_pdf_path):
            try:
                os.remove(tmp_pdf_path)
            except OSError:
                pass
