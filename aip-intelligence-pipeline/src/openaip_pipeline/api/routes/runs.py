from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import threading
import time
import traceback
import uuid
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from openaip_pipeline.adapters.supabase.client import SupabaseRestClient
from openaip_pipeline.adapters.supabase.repositories import PipelineRepository
from openaip_pipeline.core.settings import Settings
from openaip_pipeline.services.categorization.categorize import (
    categorize_from_summarized_json_str,
    write_categorized_json_file,
)
from openaip_pipeline.services.extraction.barangay import run_extraction as run_barangay_extraction
from openaip_pipeline.services.extraction.city import run_extraction as run_city_extraction
from openaip_pipeline.services.summarization.summarize import (
    summarize_aip_overall_json_str,
)
from openaip_pipeline.services.validation.barangay import validate_projects_json_str as validate_barangay
from openaip_pipeline.services.validation.city import validate_projects_json_str as validate_city

_MAX_CLOCK_SKEW_SECONDS = 60
_RUNS_GUARD_LOCK = threading.Lock()
_NONCE_CACHE: dict[tuple[str, str], float] = {}
_RATE_BUCKETS_BY_AUD: dict[str, deque[float]] = {}
_RATE_BUCKET_GLOBAL: deque[float] = deque()
_ENQUEUE_DEDUPE_CACHE: dict[str, dict[str, Any]] = {}
_ENQUEUE_INFLIGHT: dict[str, threading.Event] = {}
logger = logging.getLogger(__name__)


def _optional_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        parsed = int(value.strip())
    except (TypeError, ValueError):
        return default
    return max(1, parsed)


def _load_runs_security_config() -> dict[str, Any]:
    secret = os.getenv("PIPELINE_RUNS_HMAC_SECRET", "").strip()
    if not secret:
        raise HTTPException(status_code=500, detail="PIPELINE_RUNS_HMAC_SECRET is not configured.")
    audience_raw = os.getenv("PIPELINE_RUNS_ALLOWED_AUDIENCES", "")
    allowed_audiences = {part.strip() for part in audience_raw.split(",") if part.strip()}
    if not allowed_audiences:
        raise HTTPException(status_code=500, detail="PIPELINE_RUNS_ALLOWED_AUDIENCES is not configured.")
    return {
        "secret": secret.encode("utf-8"),
        "allowed_audiences": allowed_audiences,
        "rate_limit_window_seconds": _optional_int("PIPELINE_RUNS_RATE_LIMIT_WINDOW_SECONDS", 60),
        "rate_limit_per_aud": _optional_int("PIPELINE_RUNS_RATE_LIMIT_PER_AUD", 30),
        "rate_limit_global": _optional_int("PIPELINE_RUNS_RATE_LIMIT_GLOBAL", 120),
        "nonce_ttl_seconds": _optional_int("PIPELINE_RUNS_NONCE_TTL_SECONDS", 120),
        "dedupe_ttl_seconds": _optional_int("PIPELINE_RUNS_DEDUPE_TTL_SECONDS", 30),
    }


def _request_id(request: Request) -> str:
    supplied = (request.headers.get("x-request-id") or "").strip()
    return supplied or str(uuid.uuid4())


def _log_runs_auth_failure(
    *,
    request: Request,
    request_id: str,
    run_id: str | None,
    reason: str,
    aud: str | None,
    ts: str | None,
) -> None:
    payload = {
        "event": "runs_auth_failure",
        "request_id": request_id,
        "run_id": run_id,
        "reason": reason,
        "aud": aud,
        "method": request.method.upper(),
        "path": request.url.path,
        "remote_addr": request.client.host if request.client else None,
        "ts": ts,
    }
    logger.warning(json.dumps(payload, separators=(",", ":"), sort_keys=True))


def _log_runs_throttle(
    *,
    request: Request,
    request_id: str,
    run_id: str | None,
    reason: str,
    aud: str,
) -> None:
    payload = {
        "event": "runs_throttle",
        "request_id": request_id,
        "run_id": run_id,
        "reason": reason,
        "aud": aud,
        "method": request.method.upper(),
        "path": request.url.path,
        "remote_addr": request.client.host if request.client else None,
    }
    logger.warning(json.dumps(payload, separators=(",", ":"), sort_keys=True))


def _prune_nonce_cache_locked(now: float) -> None:
    expired = [key for key, expires_at in _NONCE_CACHE.items() if expires_at <= now]
    for key in expired:
        _NONCE_CACHE.pop(key, None)


def _prune_rate_buckets_locked(now: float, window_seconds: int) -> None:
    cutoff = now - float(window_seconds)
    while _RATE_BUCKET_GLOBAL and _RATE_BUCKET_GLOBAL[0] <= cutoff:
        _RATE_BUCKET_GLOBAL.popleft()
    empty_audiences: list[str] = []
    for aud, bucket in _RATE_BUCKETS_BY_AUD.items():
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if not bucket:
            empty_audiences.append(aud)
    for aud in empty_audiences:
        _RATE_BUCKETS_BY_AUD.pop(aud, None)


def _prune_enqueue_dedupe_locked(now: float) -> None:
    expired = [key for key, value in _ENQUEUE_DEDUPE_CACHE.items() if float(value.get("expires_at", 0.0)) <= now]
    for key in expired:
        _ENQUEUE_DEDUPE_CACHE.pop(key, None)


def _build_signature_payload(
    *,
    aud: str,
    ts: str,
    nonce: str,
    method: str,
    path: str,
    body: bytes,
) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    return "\n".join([aud, ts, nonce, method.upper(), path, body_hash])


def _enforce_rate_limit(
    *,
    aud: str,
    request: Request,
    request_id: str,
    run_id: str | None,
    window_seconds: int,
    per_aud_limit: int,
    global_limit: int,
) -> None:
    now = time.time()
    with _RUNS_GUARD_LOCK:
        _prune_rate_buckets_locked(now, window_seconds)
        aud_bucket = _RATE_BUCKETS_BY_AUD.setdefault(aud, deque())
        if len(aud_bucket) >= per_aud_limit:
            _log_runs_throttle(
                request=request,
                request_id=request_id,
                run_id=run_id,
                reason="per_audience_limit",
                aud=aud,
            )
            raise HTTPException(status_code=429, detail="Too many requests.")
        if len(_RATE_BUCKET_GLOBAL) >= global_limit:
            _log_runs_throttle(
                request=request,
                request_id=request_id,
                run_id=run_id,
                reason="global_limit",
                aud=aud,
            )
            raise HTTPException(status_code=429, detail="Too many requests.")
        aud_bucket.append(now)
        _RATE_BUCKET_GLOBAL.append(now)


async def _require_runs_auth(request: Request) -> None:
    config = _load_runs_security_config()
    request_id = _request_id(request)
    run_id = request.path_params.get("run_id")
    aud = (request.headers.get("aud") or "").strip()
    ts = (request.headers.get("ts") or "").strip()
    nonce = (request.headers.get("nonce") or "").strip()
    provided_sig = (request.headers.get("sig") or "").strip()

    request.state.request_id = request_id
    request.state.runs_auth_aud = aud

    if not aud or not ts or not nonce or not provided_sig:
        _log_runs_auth_failure(
            request=request,
            request_id=request_id,
            run_id=run_id,
            reason="missing_header",
            aud=aud or None,
            ts=ts or None,
        )
        raise HTTPException(status_code=401, detail="Unauthorized.")

    if aud not in config["allowed_audiences"]:
        _log_runs_auth_failure(
            request=request,
            request_id=request_id,
            run_id=run_id,
            reason="unauthorized_audience",
            aud=aud,
            ts=ts,
        )
        raise HTTPException(status_code=401, detail="Unauthorized.")

    try:
        ts_seconds = int(ts)
    except ValueError as error:
        _log_runs_auth_failure(
            request=request,
            request_id=request_id,
            run_id=run_id,
            reason="invalid_timestamp",
            aud=aud,
            ts=ts,
        )
        raise HTTPException(status_code=401, detail="Unauthorized.") from error

    now_seconds = int(time.time())
    if abs(now_seconds - ts_seconds) > _MAX_CLOCK_SKEW_SECONDS:
        _log_runs_auth_failure(
            request=request,
            request_id=request_id,
            run_id=run_id,
            reason="stale_timestamp",
            aud=aud,
            ts=ts,
        )
        raise HTTPException(status_code=401, detail="Unauthorized.")

    body = await request.body()
    canonical = _build_signature_payload(
        aud=aud,
        ts=ts,
        nonce=nonce,
        method=request.method,
        path=request.url.path,
        body=body,
    )
    expected_sig = hmac.new(
        config["secret"],
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(provided_sig.lower(), expected_sig):
        _log_runs_auth_failure(
            request=request,
            request_id=request_id,
            run_id=run_id,
            reason="invalid_signature",
            aud=aud,
            ts=ts,
        )
        raise HTTPException(status_code=401, detail="Unauthorized.")

    now = time.time()
    with _RUNS_GUARD_LOCK:
        _prune_nonce_cache_locked(now)
        nonce_key = (aud, nonce)
        existing = _NONCE_CACHE.get(nonce_key)
        if existing and existing > now:
            _log_runs_auth_failure(
                request=request,
                request_id=request_id,
                run_id=run_id,
                reason="replayed_nonce",
                aud=aud,
                ts=ts,
            )
            raise HTTPException(status_code=401, detail="Unauthorized.")
        # In-memory nonce replay defense for single-process deployment.
        # For multi-instance, replace with Redis SETNX+TTL or DB unique+expiration.
        _NONCE_CACHE[nonce_key] = now + float(config["nonce_ttl_seconds"])

    _enforce_rate_limit(
        aud=aud,
        request=request,
        request_id=request_id,
        run_id=run_id,
        window_seconds=int(config["rate_limit_window_seconds"]),
        per_aud_limit=int(config["rate_limit_per_aud"]),
        global_limit=int(config["rate_limit_global"]),
    )


router = APIRouter(prefix="/v1/runs", tags=["runs"], dependencies=[Depends(_require_runs_auth)])


class EnqueueRunRequest(BaseModel):
    aip_id: str
    uploaded_file_id: str | None = None
    model_name: str = "gpt-5.2"
    created_by: str | None = None


class EnqueueRunResponse(BaseModel):
    run_id: str
    status: str


class LocalRunRequest(BaseModel):
    pdf_path: str
    scope: str = Field("barangay", pattern="^(barangay|city)$")
    model: str = "gpt-5.2"
    batch_size: int = Field(25, ge=1, le=200)


class LocalRunResponse(BaseModel):
    run_id: str
    output_file: str
    summary: str
    usage: dict[str, Any]


def _repo() -> PipelineRepository:
    settings = Settings.load(require_supabase=True, require_openai=False)
    client = SupabaseRestClient.from_settings(settings)
    return PipelineRepository(client)


def _build_enqueue_dedupe_key(aud: str, req: EnqueueRunRequest) -> str:
    key_payload = {
        "aud": aud,
        "aip_id": req.aip_id,
        "uploaded_file_id": req.uploaded_file_id,
        "model_name": req.model_name,
        "created_by": req.created_by,
    }
    serialized = json.dumps(key_payload, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


@router.post("/enqueue", response_model=EnqueueRunResponse)
def enqueue_run(req: EnqueueRunRequest, request: Request) -> EnqueueRunResponse:
    config = _load_runs_security_config()
    aud = str(getattr(request.state, "runs_auth_aud", "unknown") or "unknown")
    dedupe_key = _build_enqueue_dedupe_key(aud, req)

    while True:
        now = time.time()
        with _RUNS_GUARD_LOCK:
            _prune_enqueue_dedupe_locked(now)
            cached = _ENQUEUE_DEDUPE_CACHE.get(dedupe_key)
            if cached and float(cached.get("expires_at", 0.0)) > now:
                return EnqueueRunResponse(run_id=str(cached["run_id"]), status=str(cached["status"]))
            inflight = _ENQUEUE_INFLIGHT.get(dedupe_key)
            if inflight is None:
                inflight = threading.Event()
                _ENQUEUE_INFLIGHT[dedupe_key] = inflight
                owner = True
            else:
                owner = False
        if owner:
            break
        inflight.wait(timeout=1.0)

    try:
        row = _repo().enqueue_run(
            aip_id=req.aip_id,
            uploaded_file_id=req.uploaded_file_id,
            model_name=req.model_name,
            created_by=req.created_by,
        )
        response = EnqueueRunResponse(run_id=row.id, status=row.status)
        with _RUNS_GUARD_LOCK:
            # In-memory idempotency cache for single-process deployment.
            # For multi-instance, move this to Redis/DB key-value with TTL.
            _ENQUEUE_DEDUPE_CACHE[dedupe_key] = {
                "run_id": response.run_id,
                "status": response.status,
                "expires_at": time.time() + float(config["dedupe_ttl_seconds"]),
            }
        return response
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    finally:
        with _RUNS_GUARD_LOCK:
            inflight = _ENQUEUE_INFLIGHT.pop(dedupe_key, None)
            if inflight:
                inflight.set()


@router.get("/{run_id}")
def get_run_status(run_id: str) -> dict[str, Any]:
    row = _repo().get_run(run_id)
    if not row:
        raise HTTPException(status_code=404, detail="Run not found.")
    return row


@router.post("/dev/local", response_model=LocalRunResponse)
def run_local(req: LocalRunRequest) -> LocalRunResponse:
    settings = Settings.load(require_openai=True, require_supabase=False)
    if not settings.dev_routes:
        raise HTTPException(status_code=403, detail="Dev routes are disabled.")
    if not os.path.exists(req.pdf_path):
        raise HTTPException(status_code=404, detail=f"PDF not found: {req.pdf_path}")
    run_id = str(uuid.uuid4())
    usage: dict[str, Any] = {}
    try:
        if req.scope == "city":
            extraction_res = run_city_extraction(
                req.pdf_path, model=req.model, job_id=run_id, aip_id=run_id, uploaded_file_id=None
            )
            validation_res = validate_city(extraction_res.json_str, model=req.model)
        else:
            extraction_res = run_barangay_extraction(
                req.pdf_path, model=req.model, job_id=run_id, aip_id=run_id, uploaded_file_id=None
            )
            validation_res = validate_barangay(extraction_res.json_str, model=req.model)
        usage["extraction"] = extraction_res.usage
        usage["validation"] = validation_res.usage
        summary_res = summarize_aip_overall_json_str(validation_res.validated_json_str, model=req.model)
        usage["summarization"] = summary_res.usage
        categorized_res = categorize_from_summarized_json_str(
            summary_res.summary_json_str,
            model=req.model,
            batch_size=req.batch_size,
        )
        usage["categorization"] = categorized_res.usage
        out_dir = Path("data/outputs")
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"aip_categorized.{run_id}.json"
        write_categorized_json_file(categorized_res.categorized_json_str, str(out_path))
        return LocalRunResponse(
            run_id=run_id,
            output_file=str(out_path),
            summary=summary_res.summary_text,
            usage=usage,
        )
    except HTTPException:
        raise
    except Exception as error:
        traceback_text = "".join(traceback.format_exception(type(error), error, error.__traceback__))
        raise HTTPException(
            status_code=500,
            detail=json.dumps({"error": str(error), "traceback": traceback_text}),
        ) from error
