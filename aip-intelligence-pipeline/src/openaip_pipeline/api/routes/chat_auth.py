from __future__ import annotations

import hashlib
import hmac
import inspect
import json
import logging
import os
import threading
import time
from typing import Any

from fastapi import HTTPException, Request

_CHAT_AUTH_LOCK = threading.Lock()
_CHAT_NONCE_CACHE: dict[tuple[str, str, str, str], float] = {}
_CHAT_EXPECTED_AUDIENCE = "website-backend"
_CHAT_MAX_CLOCK_SKEW_SECONDS = 60
_CHAT_NONCE_TTL_SECONDS = 120

logger = logging.getLogger(__name__)


def _load_chat_hmac_secret() -> bytes:
    secret = os.getenv("PIPELINE_HMAC_SECRET", "").strip()
    if not secret:
        raise HTTPException(status_code=500, detail="PIPELINE_HMAC_SECRET is not configured.")
    return secret.encode("utf-8")


def _build_signature_payload(*, aud: str, ts: str, nonce: str, raw_body: str) -> str:
    return f"{aud}|{ts}|{nonce}|{raw_body}"


def _prune_nonce_cache_locked(now: float) -> None:
    expired = [key for key, expires_at in _CHAT_NONCE_CACHE.items() if expires_at <= now]
    for key in expired:
        _CHAT_NONCE_CACHE.pop(key, None)


def _log_chat_auth_failure(*, request: Request, reason: str, aud: str | None, ts: str | None) -> None:
    payload = {
        "event": "chat_auth_failure",
        "reason": reason,
        "aud": aud,
        "ts": ts,
        "path": request.url.path,
        "method": request.method.upper(),
        "remote_addr": request.client.host if request.client else None,
    }
    logger.warning(json.dumps(payload, separators=(",", ":"), sort_keys=True))


def _log_chat_auth_verified(*, request: Request, aud: str, ts: str) -> None:
    payload = {
        "event": "chat_auth_verified",
        "aud": aud,
        "ts": ts,
        "path": request.url.path,
        "method": request.method.upper(),
        "remote_addr": request.client.host if request.client else None,
    }
    logger.info(json.dumps(payload, separators=(",", ":"), sort_keys=True))


async def require_chat_signed_auth(request: Request) -> None:
    aud = (request.headers.get("x-pipeline-aud") or "").strip()
    ts = (request.headers.get("x-pipeline-ts") or "").strip()
    nonce = (request.headers.get("x-pipeline-nonce") or "").strip()
    provided_sig = (request.headers.get("x-pipeline-sig") or "").strip().lower()

    if not aud or not ts or not nonce or not provided_sig:
        _log_chat_auth_failure(request=request, reason="missing_header", aud=aud or None, ts=ts or None)
        raise HTTPException(status_code=401, detail="Unauthorized.")

    if aud != _CHAT_EXPECTED_AUDIENCE:
        _log_chat_auth_failure(request=request, reason="unauthorized_audience", aud=aud, ts=ts)
        raise HTTPException(status_code=401, detail="Unauthorized.")

    try:
        ts_seconds = int(ts)
    except ValueError as error:
        _log_chat_auth_failure(request=request, reason="invalid_timestamp", aud=aud, ts=ts)
        raise HTTPException(status_code=401, detail="Unauthorized.") from error

    now_seconds = int(time.time())
    if abs(now_seconds - ts_seconds) > _CHAT_MAX_CLOCK_SKEW_SECONDS:
        _log_chat_auth_failure(request=request, reason="stale_timestamp", aud=aud, ts=ts)
        raise HTTPException(status_code=401, detail="Unauthorized.")

    body_bytes = await request.body()
    try:
        raw_body = body_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        _log_chat_auth_failure(request=request, reason="invalid_body_encoding", aud=aud, ts=ts)
        raise HTTPException(status_code=401, detail="Unauthorized.") from error

    canonical = _build_signature_payload(aud=aud, ts=ts, nonce=nonce, raw_body=raw_body)
    expected_sig = hmac.new(_load_chat_hmac_secret(), canonical.encode("utf-8"), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(provided_sig, expected_sig):
        _log_chat_auth_failure(request=request, reason="invalid_signature", aud=aud, ts=ts)
        raise HTTPException(status_code=401, detail="Unauthorized.")

    body_hash = hashlib.sha256(body_bytes).hexdigest()
    nonce_key = (aud, nonce, ts, body_hash)
    now = time.time()
    with _CHAT_AUTH_LOCK:
        _prune_nonce_cache_locked(now)
        existing = _CHAT_NONCE_CACHE.get(nonce_key)
        if existing and existing > now:
            _log_chat_auth_failure(request=request, reason="replayed_request", aud=aud, ts=ts)
            raise HTTPException(status_code=401, detail="Unauthorized.")
        # In-memory replay cache is process-local. Use Redis/DB for multi-instance deployments.
        _CHAT_NONCE_CACHE[nonce_key] = now + float(_CHAT_NONCE_TTL_SECONDS)

    _log_chat_auth_verified(request=request, aud=aud, ts=ts)


def require_internal_token(request: Request) -> Any:
    # Backward-compatible auth hook kept patchable in tests.
    return require_chat_signed_auth(request)


async def chat_auth_dependency(request: Request) -> None:
    result = require_internal_token(request)
    if inspect.isawaitable(result):
        await result

