from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import threading
import time
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from openaip_pipeline.core.settings import Settings
from openaip_pipeline.services.intent.chat_shortcuts import maybe_handle_conversational_intent
from openaip_pipeline.services.intent.router import IntentRouter
from openaip_pipeline.services.openai_utils import build_openai_client
from openaip_pipeline.services.rag.rag import answer_with_rag

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


async def _require_chat_signed_auth(request: Request) -> None:
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


router = APIRouter(prefix="/v1/chat", tags=["chat"], dependencies=[Depends(_require_chat_signed_auth)])
logger = logging.getLogger(__name__)
_INTENT_ROUTER = IntentRouter()


class RetrievalScopeTarget(BaseModel):
    scope_type: Literal["barangay", "city", "municipality"]
    scope_id: str = Field(min_length=1)
    scope_name: str = Field(min_length=1, max_length=200)


class RetrievalScope(BaseModel):
    mode: Literal["global", "own_barangay", "named_scopes"] = "global"
    targets: list[RetrievalScopeTarget] = Field(default_factory=list)


class ChatAnswerRequest(BaseModel):
    question: str = Field(min_length=1, max_length=12000)
    retrieval_scope: RetrievalScope = Field(default_factory=RetrievalScope)
    model_name: str | None = None
    top_k: int = Field(default=8, ge=1, le=30)
    min_similarity: float = Field(default=0.3, ge=0.0, le=1.0)


class ChatAnswerResponse(BaseModel):
    question: str
    answer: str
    refused: bool
    citations: list[dict[str, Any]]
    retrieval_meta: dict[str, Any]
    context_count: int


class QueryEmbeddingRequest(BaseModel):
    text: str = Field(min_length=1, max_length=12000)
    model_name: str | None = None


class QueryEmbeddingResponse(BaseModel):
    embedding: list[float]
    model: str
    dimensions: int


def _intent_router_enabled() -> bool:
    value = os.getenv("INTENT_ROUTER_ENABLED", "false").strip().lower()
    return value in {"1", "true", "yes", "on"}


@router.post("/answer", response_model=ChatAnswerResponse)
def chat_answer(
    req: ChatAnswerRequest,
) -> ChatAnswerResponse:
    if _intent_router_enabled():
        intent_result = _INTENT_ROUTER.route(req.question)
        logger.info(
            "Intent router: intent=%s confidence=%.3f method=%s",
            intent_result.intent.value,
            intent_result.confidence,
            intent_result.method,
        )
        shortcut = maybe_handle_conversational_intent(req.question, intent_result)
        if shortcut is not None:
            return ChatAnswerResponse(
                question=req.question,
                answer=shortcut["message"],
                refused=False,
                citations=[],
                retrieval_meta={
                    "reason": "conversational_shortcut",
                    "intent": intent_result.intent.value,
                    "confidence": intent_result.confidence,
                    "method": intent_result.method,
                    "feature_flag": "INTENT_ROUTER_ENABLED",
                },
                context_count=0,
            )

    settings = Settings.load(require_supabase=True, require_openai=True)
    model_name = (req.model_name or settings.pipeline_model).strip() or settings.pipeline_model

    result = answer_with_rag(
        supabase_url=settings.supabase_url,
        supabase_service_key=settings.supabase_service_key,
        openai_api_key=settings.openai_api_key,
        embeddings_model=settings.embedding_model,
        chat_model=model_name,
        question=req.question,
        retrieval_scope=req.retrieval_scope.model_dump(),
        top_k=req.top_k,
        min_similarity=req.min_similarity,
    )

    return ChatAnswerResponse(
        question=str(result.get("question") or req.question),
        answer=str(result.get("answer") or ""),
        refused=bool(result.get("refused")),
        citations=list(result.get("citations") or []),
        retrieval_meta=dict(result.get("retrieval_meta") or {}),
        context_count=int(result.get("context_count") or 0),
    )


@router.post("/embed-query", response_model=QueryEmbeddingResponse)
def embed_query(
    req: QueryEmbeddingRequest,
) -> QueryEmbeddingResponse:
    settings = Settings.load(require_supabase=False, require_openai=True)
    model_name = (req.model_name or settings.embedding_model).strip() or settings.embedding_model

    client = build_openai_client(settings.openai_api_key)
    response = client.embeddings.create(model=model_name, input=req.text)
    data = list(getattr(response, "data", []) or [])
    if not data:
        raise HTTPException(status_code=500, detail="Embedding response is empty.")

    embedding = getattr(data[0], "embedding", None)
    if not isinstance(embedding, list) or not embedding:
        raise HTTPException(status_code=500, detail="Embedding vector missing in response.")
    if not all(isinstance(value, (int, float)) for value in embedding):
        raise HTTPException(status_code=500, detail="Embedding vector contains invalid values.")

    normalized = [float(value) for value in embedding]
    return QueryEmbeddingResponse(
        embedding=normalized,
        model=model_name,
        dimensions=len(normalized),
    )
