from __future__ import annotations

import json
import inspect
import logging
import os
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from openaip_pipeline.api.routes.chat_auth import require_internal_token
from openaip_pipeline.core.settings import Settings
from openaip_pipeline.services.chat import check_year_availability_preflight, maybe_answer_with_sql
from openaip_pipeline.services.intent import (
    AIP_ONLY_RESPONSE,
    DEFAULT_CLARIFICATION_RESPONSE,
    IntentClassificationError,
    IntentResult,
    NON_RETRIEVAL_INTENTS,
    classify_message,
)
from openaip_pipeline.services.openai_utils import build_openai_client
from openaip_pipeline.services.rag.rag import answer_with_rag, build_retrieval_query

logger = logging.getLogger(__name__)

_STRUCTURED_SQL_INTENTS: set[str] = {
    "metadata_query",
    "total_aggregation",
    "category_aggregation",
    "line_item_lookup",
    "compare_years",
}


def _trace_enabled() -> bool:
    explicit = os.getenv("PIPELINE_CHAT_TRACE_ENABLED")
    if explicit is not None:
        return explicit.strip().lower() in {"1", "true", "yes", "on"}
    inherited = os.getenv("PIPELINE_TRACE_ENABLED", "false")
    return inherited.strip().lower() in {"1", "true", "yes", "on"}


def _trace_log(event: str, **fields: Any) -> None:
    if not _trace_enabled():
        return
    payload = {"trace": "chat", "event": event}
    payload.update(fields)
    logger.info(json.dumps(payload, separators=(",", ":"), sort_keys=True))


def _preview(text: str, *, limit: int = 180) -> str:
    normalized = " ".join((text or "").split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3].rstrip() + "..."


def _require_internal_token(request: Request) -> Any:
    # Backward-compatible auth hook kept patchable in tests.
    return require_internal_token(request)


async def _chat_auth_dependency(request: Request) -> None:
    result = _require_internal_token(request)
    if inspect.isawaitable(result):
        await result


router = APIRouter(prefix="/v1/chat", tags=["chat"], dependencies=[Depends(_chat_auth_dependency)])


class RetrievalScopeTarget(BaseModel):
    scope_type: Literal["barangay", "city", "municipality"]
    scope_id: str = Field(min_length=1)
    scope_name: str = Field(min_length=1, max_length=200)


class RetrievalScope(BaseModel):
    mode: Literal["global", "own_barangay", "named_scopes"] = "global"
    targets: list[RetrievalScopeTarget] = Field(default_factory=list)


class RetrievalFilters(BaseModel):
    fiscal_year: int | None = Field(default=None, ge=2000, le=2100)
    scope_type: Literal["barangay", "city", "municipality"] | None = None
    scope_name: str | None = Field(default=None, min_length=1, max_length=200)
    document_type: str | None = Field(default=None, min_length=1, max_length=40)
    office_name: str | None = Field(default=None, min_length=1, max_length=200)
    theme_tags: list[str] = Field(default_factory=list)
    sector_tags: list[str] = Field(default_factory=list)


class ScopeFallback(BaseModel):
    scope_type: Literal["barangay", "city"]
    scope_name: str = Field(min_length=1, max_length=200)
    scope_id: str | None = Field(default=None, min_length=1)


class ChatAnswerRequest(BaseModel):
    question: str = Field(min_length=1, max_length=12000)
    retrieval_scope: RetrievalScope = Field(default_factory=RetrievalScope)
    retrieval_mode: Literal["qa", "overview"] = "qa"
    retrieval_filters: RetrievalFilters = Field(default_factory=RetrievalFilters)
    scope_fallback: ScopeFallback | None = None
    model_name: str | None = None
    top_k: int = Field(default=5, ge=1, le=30)
    min_similarity: float = Field(default=0.10, ge=0.0, le=1.0)


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


def _normalize_result_payload(result: dict[str, Any], *, default_question: str) -> dict[str, Any]:
    citations = list(result.get("citations") or [])
    refused = bool(result.get("refused"))
    retrieval_meta = dict(result.get("retrieval_meta") or {})
    if "status" not in retrieval_meta:
        if refused:
            retrieval_meta["status"] = "refusal"
        elif str(retrieval_meta.get("reason") or "") == "clarification_needed":
            retrieval_meta["status"] = "clarification"
        else:
            retrieval_meta["status"] = "answer"
    if "context_count" not in retrieval_meta:
        retrieval_meta["context_count"] = len(citations)
    return {
        "question": str(result.get("question") or default_question),
        "answer": str(result.get("answer") or ""),
        "refused": refused,
        "citations": citations,
        "retrieval_meta": retrieval_meta,
        "context_count": int(result.get("context_count") or len(citations)),
    }


def _system_citation(snippet: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "source_id": "S0",
        "scope_type": "system",
        "scope_name": "System",
        "snippet": snippet,
        "insufficient": True,
        "metadata": metadata or {},
    }


def _classifier_meta(classification: IntentResult) -> dict[str, Any]:
    return {
        "intent": classification.intent,
        "classifier_confidence": classification.confidence,
        "classifier_method": classification.classifier_method,
        "needs_retrieval": classification.needs_retrieval,
        "entities": dict(classification.entities),
        "route_hint": classification.route_hint,
    }


def _merge_classifier_meta(retrieval_meta: dict[str, Any], classification: IntentResult) -> dict[str, Any]:
    merged = dict(retrieval_meta)
    merged.update(_classifier_meta(classification))
    return merged


def _normalize_scope_name(scope_type: str, scope_name: str) -> str:
    cleaned = " ".join(scope_name.strip().split())
    if not cleaned:
        return cleaned
    lowered = cleaned.lower()
    if scope_type == "barangay":
        if lowered.startswith("barangay "):
            stripped = cleaned[9:].strip()
            return stripped if stripped else cleaned
        return cleaned
    if scope_type == "city":
        if lowered.startswith("city of "):
            base = cleaned[8:].strip()
            return f"{base} City" if base else cleaned
        if lowered.startswith("city "):
            base = cleaned[5:].strip()
            return f"{base} City" if base else cleaned
        if lowered.endswith(" city"):
            return cleaned
        return f"{cleaned} City"
    return cleaned


def _apply_scope_fallback(
    *,
    filters_payload: dict[str, Any],
    scope_payload: dict[str, Any],
    scope_fallback: ScopeFallback | None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    fallback_meta: dict[str, Any] = {
        "scope_fallback_applied": False,
        "scope_fallback_mode": "none",
    }
    if scope_fallback is None:
        return filters_payload, scope_payload, fallback_meta

    scope_type_value = filters_payload.get("scope_type")
    scope_name_value = filters_payload.get("scope_name")
    resolved_current_scope = isinstance(scope_type_value, str) and scope_type_value.strip().lower() in {
        "barangay",
        "city",
    } and isinstance(scope_name_value, str) and bool(scope_name_value.strip())

    if resolved_current_scope:
        fallback_meta["scope_fallback_mode"] = "skipped_current_scope_present"
        return filters_payload, scope_payload, fallback_meta

    fallback_scope_type = scope_fallback.scope_type.strip().lower()
    fallback_scope_name = _normalize_scope_name(fallback_scope_type, scope_fallback.scope_name)
    if not fallback_scope_name:
        fallback_meta["scope_fallback_mode"] = "skipped_invalid_fallback"
        return filters_payload, scope_payload, fallback_meta

    updated_filters = dict(filters_payload)
    updated_filters["scope_type"] = fallback_scope_type
    updated_filters["scope_name"] = fallback_scope_name

    updated_scope_payload = dict(scope_payload)
    scope_id = (scope_fallback.scope_id or "").strip()
    if scope_id and not list(updated_scope_payload.get("targets") or []):
        updated_scope_payload["mode"] = "named_scopes"
        updated_scope_payload["targets"] = [
            {
                "scope_type": fallback_scope_type,
                "scope_id": scope_id,
                "scope_name": fallback_scope_name,
            }
        ]
        fallback_meta["scope_fallback_mode"] = "sql_and_rag"
    else:
        fallback_meta["scope_fallback_mode"] = "rag_only"

    fallback_meta["scope_fallback_applied"] = True
    return updated_filters, updated_scope_payload, fallback_meta


def _apply_entity_filters(filters_payload: dict[str, Any], classification: IntentResult) -> dict[str, Any]:
    def _normalized_tag(value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = " ".join(value.strip().split()).lower()
        return normalized if normalized else None

    def _merge_tags(existing: Any, additions: list[str]) -> list[str]:
        deduped: list[str] = []
        seen: set[str] = set()
        for candidate in [*(existing if isinstance(existing, list) else []), *additions]:
            if not isinstance(candidate, str):
                continue
            normalized = _normalized_tag(candidate)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            deduped.append(normalized)
        return deduped

    entities = classification.entities
    merged = dict(filters_payload)

    existing_scope_type = merged.get("scope_type")
    if isinstance(existing_scope_type, str):
        normalized_existing_scope_type = existing_scope_type.strip().lower()
        if normalized_existing_scope_type in {"barangay", "city"}:
            merged["scope_type"] = normalized_existing_scope_type
            existing_scope_name = merged.get("scope_name")
            if isinstance(existing_scope_name, str) and existing_scope_name.strip():
                merged["scope_name"] = _normalize_scope_name(normalized_existing_scope_type, existing_scope_name)
        else:
            merged.pop("scope_type", None)
            merged.pop("scope_name", None)

    fiscal_year = entities.get("fiscal_year")
    if "fiscal_year" not in merged and isinstance(fiscal_year, int):
        merged["fiscal_year"] = fiscal_year

    barangay = entities.get("barangay")
    city = entities.get("city")

    entity_scope_type = entities.get("scope_type")
    normalized_entity_scope_type = (
        entity_scope_type.strip().lower()
        if isinstance(entity_scope_type, str) and entity_scope_type.strip().lower() in {"barangay", "city"}
        else None
    )
    entity_scope_name = entities.get("scope_name")
    normalized_entity_scope_name = (
        entity_scope_name.strip() if isinstance(entity_scope_name, str) and entity_scope_name.strip() else None
    )

    if "scope_type" not in merged:
        if isinstance(barangay, str) and barangay.strip():
            merged["scope_type"] = "barangay"
            merged["scope_name"] = _normalize_scope_name("barangay", barangay)
        elif isinstance(city, str) and city.strip():
            merged["scope_type"] = "city"
            merged["scope_name"] = _normalize_scope_name("city", city)
        elif normalized_entity_scope_type and normalized_entity_scope_name:
            merged["scope_type"] = normalized_entity_scope_type
            merged["scope_name"] = _normalize_scope_name(normalized_entity_scope_type, normalized_entity_scope_name)
    elif "scope_name" not in merged:
        resolved_scope_type = merged.get("scope_type")
        if resolved_scope_type == "barangay" and isinstance(barangay, str) and barangay.strip():
            merged["scope_name"] = _normalize_scope_name("barangay", barangay)
        elif resolved_scope_type == "city" and isinstance(city, str) and city.strip():
            merged["scope_name"] = _normalize_scope_name("city", city)
        elif normalized_entity_scope_name:
            merged["scope_name"] = _normalize_scope_name(str(resolved_scope_type or ""), normalized_entity_scope_name)

    sector_tag = _normalized_tag(entities.get("sector"))
    if sector_tag:
        merged["sector_tags"] = _merge_tags(merged.get("sector_tags"), [sector_tag])

    theme_candidates = [
        _normalized_tag(entities.get("topic")),
        _normalized_tag(entities.get("project_type")),
        _normalized_tag(entities.get("budget_term")),
    ]
    theme_tags = [tag for tag in theme_candidates if tag]
    if theme_tags:
        merged["theme_tags"] = _merge_tags(merged.get("theme_tags"), theme_tags)

    return merged


def _build_short_circuit_response(*, question: str, classification: IntentResult) -> ChatAnswerResponse:
    retrieval_meta = _classifier_meta(classification)
    retrieval_meta.update(
        {
            "reason": "conversational_shortcut",
            "route_family": "conversational",
            "context_count": 0,
        }
    )

    if classification.intent == "out_of_scope":
        retrieval_meta.update(
            {
                "status": "refusal",
                "refusal_reason": "unsupported_request",
            }
        )
        return ChatAnswerResponse(
            question=question,
            answer=classification.friendly_response or AIP_ONLY_RESPONSE,
            refused=True,
            citations=[],
            retrieval_meta=retrieval_meta,
            context_count=0,
        )

    if classification.intent == "clarification":
        retrieval_meta["status"] = "clarification"
        return ChatAnswerResponse(
            question=question,
            answer=classification.friendly_response or DEFAULT_CLARIFICATION_RESPONSE,
            refused=False,
            citations=[],
            retrieval_meta=retrieval_meta,
            context_count=0,
        )

    retrieval_meta["status"] = "answer"
    return ChatAnswerResponse(
        question=question,
        answer=classification.friendly_response or "How can I help you with OpenAIP data?",
        refused=False,
        citations=[],
        retrieval_meta=retrieval_meta,
        context_count=0,
    )


def _build_classifier_failure_response(*, question: str, reason: str) -> ChatAnswerResponse:
    return ChatAnswerResponse(
        question=question,
        answer="I couldn't process your request right now. Please try again in a moment.",
        refused=True,
        citations=[_system_citation("Intent classification failed before retrieval execution.", {"error": reason})],
        retrieval_meta={
            "reason": "pipeline_error",
            "status": "refusal",
            "route_family": "pipeline_fallback",
            "intent": "classification_error",
            "classifier_confidence": 0.0,
            "classifier_method": "error",
            "needs_retrieval": False,
            "entities": {},
            "route_hint": None,
            "context_count": 1,
        },
        context_count=1,
    )


def _build_year_unavailable_clarification_response(
    *,
    question: str,
    classification: IntentResult,
    preflight_result: dict[str, Any],
) -> ChatAnswerResponse:
    requested_year = preflight_result.get("requested_fiscal_year")
    available_years = [
        int(year)
        for year in list(preflight_result.get("available_fiscal_years") or [])
        if isinstance(year, int) or (isinstance(year, float) and year.is_integer())
    ]
    scope_payload = dict(preflight_result.get("year_availability_scope") or {})
    scope_name = str(scope_payload.get("scope_name") or "the selected scope").strip() or "the selected scope"

    if available_years:
        years_label = ", ".join(f"FY {year}" for year in available_years)
        answer = (
            f"No published records were found for FY {requested_year} in {scope_name}. "
            f"Available fiscal years: {years_label}."
        )
    else:
        answer = (
            f"No published records were found for FY {requested_year} in {scope_name}. "
            "No published fiscal years are currently available in that scope."
        )

    retrieval_meta = _classifier_meta(classification)
    retrieval_meta.update(
        {
            "reason": "clarification_needed",
            "status": "clarification",
            "route_family": "year_availability",
            "context_count": 0,
            "clarification_type": "year_unavailable",
            "requested_fiscal_year": requested_year,
            "available_fiscal_years": available_years,
            "year_availability_scope": {
                "scope_type": str(scope_payload.get("scope_type") or "global"),
                "scope_name": scope_name,
            },
        }
    )
    return ChatAnswerResponse(
        question=question,
        answer=answer,
        refused=False,
        citations=[],
        retrieval_meta=retrieval_meta,
        context_count=0,
    )


@router.post("/answer", response_model=ChatAnswerResponse)
def chat_answer(
    req: ChatAnswerRequest,
) -> ChatAnswerResponse:
    _trace_log(
        "request_received",
        question_preview=_preview(req.question),
        retrieval_mode=req.retrieval_mode,
        top_k=req.top_k,
        min_similarity=req.min_similarity,
    )
    settings = Settings.load(require_supabase=True, require_openai=False)
    intent_model_override = (req.model_name or "").strip()
    model_name = (req.model_name or settings.pipeline_model).strip() or settings.pipeline_model

    try:
        classification = classify_message(
            message=req.question,
            openai_api_key=settings.openai_api_key,
            default_model=intent_model_override,
        )
    except IntentClassificationError as error:
        _trace_log("classification_failed", error=str(error))
        logger.exception("Intent classification failed: %s", error)
        return _build_classifier_failure_response(question=req.question, reason=str(error))

    _trace_log(
        "classification_complete",
        intent=classification.intent,
        confidence=classification.confidence,
        classifier_method=classification.classifier_method,
        needs_retrieval=classification.needs_retrieval,
        route_hint=classification.route_hint,
        entities=classification.entities,
    )

    if classification.intent in NON_RETRIEVAL_INTENTS or not classification.needs_retrieval:
        response = _build_short_circuit_response(question=req.question, classification=classification)
        _trace_log(
            "short_circuit_response",
            intent=classification.intent,
            status=response.retrieval_meta.get("status"),
            reason=response.retrieval_meta.get("reason"),
            refused=response.refused,
        )
        return response

    scope_payload = req.retrieval_scope.model_dump()
    filters_payload = _apply_entity_filters(
        req.retrieval_filters.model_dump(exclude_none=True),
        classification,
    )
    filters_payload, scope_payload, scope_fallback_meta = _apply_scope_fallback(
        filters_payload=filters_payload,
        scope_payload=scope_payload,
        scope_fallback=req.scope_fallback,
    )
    _trace_log(
        "retrieval_started",
        scope_mode=scope_payload.get("mode"),
        scope_targets_count=len(scope_payload.get("targets") or []),
        retrieval_filters=filters_payload,
        scope_fallback_applied=scope_fallback_meta.get("scope_fallback_applied"),
        scope_fallback_mode=scope_fallback_meta.get("scope_fallback_mode"),
    )
    year_preflight = check_year_availability_preflight(
        supabase_url=settings.supabase_url,
        supabase_service_key=settings.supabase_service_key,
        question=req.question,
        retrieval_scope=scope_payload,
        retrieval_filters=filters_payload,
    )
    _trace_log(
        "year_availability_preflight",
        decision=year_preflight.get("decision"),
        reason=year_preflight.get("reason"),
        requested_fiscal_year=year_preflight.get("requested_fiscal_year"),
        available_fiscal_years=year_preflight.get("available_fiscal_years"),
        scope=year_preflight.get("year_availability_scope"),
    )
    if str(year_preflight.get("decision") or "") == "year_unavailable":
        response = _build_year_unavailable_clarification_response(
            question=req.question,
            classification=classification,
            preflight_result=year_preflight,
        )
        _trace_log(
            "year_availability_short_circuit",
            status=response.retrieval_meta.get("status"),
            reason=response.retrieval_meta.get("reason"),
            refused=response.refused,
            requested_fiscal_year=response.retrieval_meta.get("requested_fiscal_year"),
            available_fiscal_years=response.retrieval_meta.get("available_fiscal_years"),
        )
        return response

    sql_result = maybe_answer_with_sql(
        supabase_url=settings.supabase_url,
        supabase_service_key=settings.supabase_service_key,
        question=req.question,
        retrieval_scope=scope_payload,
        retrieval_filters=filters_payload,
    )
    if sql_result is not None:
        normalized = _normalize_result_payload(sql_result, default_question=req.question)
        normalized["retrieval_meta"]["sql_attempted"] = True
        normalized["retrieval_meta"]["sql_scoped"] = True
        normalized["retrieval_meta"]["fallback_source"] = "sql"
        normalized["retrieval_meta"] = _merge_classifier_meta(normalized["retrieval_meta"], classification)
        _trace_log(
            "sql_answered",
            status=normalized["retrieval_meta"].get("status"),
            reason=normalized["retrieval_meta"].get("reason"),
            refused=normalized["refused"],
            context_count=normalized["context_count"],
        )
        return ChatAnswerResponse(
            question=normalized["question"],
            answer=normalized["answer"],
            refused=normalized["refused"],
            citations=normalized["citations"],
            retrieval_meta=normalized["retrieval_meta"],
            context_count=normalized["context_count"],
        )
    _trace_log("sql_no_answer")

    retrieval_query = build_retrieval_query(
        question=req.question,
        entities=classification.entities,
    )

    if not settings.openai_api_key:
        settings = Settings.load(require_supabase=True, require_openai=True)

    rag_result = answer_with_rag(
        supabase_url=settings.supabase_url,
        supabase_service_key=settings.supabase_service_key,
        openai_api_key=settings.openai_api_key,
        embeddings_model=settings.embedding_model,
        chat_model=model_name,
        question=req.question,
        retrieval_query=retrieval_query,
        retrieval_scope=scope_payload,
        retrieval_mode=req.retrieval_mode,
        retrieval_filters=filters_payload,
        top_k=req.top_k,
        min_similarity=req.min_similarity,
        sql_fallback=True,
    )
    normalized = _normalize_result_payload(rag_result, default_question=req.question)
    normalized["retrieval_meta"]["sql_attempted"] = True
    normalized["retrieval_meta"]["sql_scoped"] = False
    normalized["retrieval_meta"]["fallback_source"] = "rag"
    normalized["retrieval_meta"] = _merge_classifier_meta(normalized["retrieval_meta"], classification)
    _trace_log(
        "rag_completed",
        status=normalized["retrieval_meta"].get("status"),
        reason=normalized["retrieval_meta"].get("reason"),
        refused=normalized["refused"],
        context_count=normalized["context_count"],
        evidence_gate_decision=normalized["retrieval_meta"].get("evidence_gate_decision"),
        evidence_gate_reason=normalized["retrieval_meta"].get("evidence_gate_reason"),
    )
    return ChatAnswerResponse(
        question=normalized["question"],
        answer=normalized["answer"],
        refused=normalized["refused"],
        citations=normalized["citations"],
        retrieval_meta=normalized["retrieval_meta"],
        context_count=normalized["context_count"],
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
