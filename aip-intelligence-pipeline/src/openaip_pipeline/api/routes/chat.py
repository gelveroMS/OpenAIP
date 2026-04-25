from __future__ import annotations

import json
import inspect
import logging
import os
import re
import threading
import time
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
from openaip_pipeline.services.intent.rules import (
    extract_known_barangay_from_text,
    extract_known_city_from_text,
    looks_like_broad_aip_query,
)
from openaip_pipeline.services.openai_utils import build_openai_client
from openaip_pipeline.services.query_intent import detect_exhaustive_intent
from openaip_pipeline.services.rag.rag import answer_with_rag, build_retrieval_query

logger = logging.getLogger(__name__)

_STRUCTURED_SQL_INTENTS: set[str] = {
    "metadata_query",
    "total_aggregation",
    "category_aggregation",
    "line_item_lookup",
    "compare_years",
}

_CLARIFICATION_CONTEXT_LOCK = threading.Lock()
_CLARIFICATION_CONTEXT_STORE: dict[str, dict[str, Any]] = {}
_CLARIFICATION_CONTEXT_TTL_SECONDS = 10 * 60
_CLARIFICATION_CONTEXT_MAX_TURNS = 3

_YEAR_RE = re.compile(r"\b(20\d{2})\b")
_RECENCY_RE = re.compile(r"\b(latest|current|recent)\b", re.IGNORECASE)
_TOPIC_CHANGE_RE = re.compile(
    r"\b(new question|different topic|forget that|ignore that|never mind|nevermind|start over|reset)\b",
    re.IGNORECASE,
)
_QUESTION_LIKE_RE = re.compile(
    r"^(what|which|show|list|recommend|suggest|compare|how many|how much|can you)\b",
    re.IGNORECASE,
)
_EXACT_COMPLETENESS_RE = re.compile(
    r"\b(total|how many|count|highest|lowest|rank|ranking|compare|comparison|top\s+\d+)\b",
    re.IGNORECASE,
)
_SCOPE_DETAIL_RE = re.compile(
    r"\b(city level|barangay level|all barangays|all scopes|city-wide|citywide|across all scopes)\b",
    re.IGNORECASE,
)
_DOMAIN_DETAIL_RE = re.compile(
    r"\b(health|education|infrastructure|livelihood|governance|social services|program|project|budget|sector|fund)\b",
    re.IGNORECASE,
)


def _normalize_text(text: str) -> str:
    return " ".join((text or "").split()).strip()


def _has_year(text: str) -> bool:
    return _YEAR_RE.search(text or "") is not None


def _has_scope_in_filters(filters_payload: dict[str, Any], scope_payload: dict[str, Any]) -> bool:
    scope_type = str(filters_payload.get("scope_type") or "").strip().lower()
    scope_name = _normalize_text(str(filters_payload.get("scope_name") or ""))
    if scope_type in {"barangay", "city", "municipality"} and scope_name:
        return True
    targets = list(scope_payload.get("targets") or [])
    return bool(targets)


def _has_all_years_directive(question: str) -> bool:
    lowered = _normalize_text(question).lower()
    if not lowered:
        return False
    cues = (
        "all years",
        "all fiscal years",
        "across years",
        "across all years",
        "across all fiscal years",
        "all available years",
    )
    return any(cue in lowered for cue in cues)


def _has_all_scopes_directive(question: str) -> bool:
    lowered = _normalize_text(question).lower()
    if not lowered:
        return False
    cues = (
        "all scopes",
        "all barangays",
        "all cities",
        "across all published aip records",
        "across all published records",
        "all published records",
        "global scope",
        "city-wide",
        "citywide",
    )
    return any(cue in lowered for cue in cues)


def _query_shape(*, question: str, classification: IntentResult) -> str:
    if classification.intent in {"total_aggregation", "category_aggregation", "compare_years"}:
        return "exact_completeness"
    normalized = _normalize_text(question)
    lowered = normalized.lower()
    if not lowered:
        return "exploratory"
    if _EXACT_COMPLETENESS_RE.search(lowered):
        return "exact_completeness"
    exhaustive = detect_exhaustive_intent(normalized)
    if exhaustive.get("is_list_query") and exhaustive.get("exhaustive_intent"):
        return "exact_completeness"
    return "exploratory"


def _evaluate_missing_dimensions(
    *,
    question: str,
    filters_payload: dict[str, Any],
    scope_payload: dict[str, Any],
    classification: IntentResult,
) -> dict[str, Any]:
    year_specified = isinstance(filters_payload.get("fiscal_year"), int) or _has_year(question)
    scope_specified = _has_scope_in_filters(filters_payload, scope_payload)
    all_years_directive = _has_all_years_directive(question)
    all_scopes_directive = _has_all_scopes_directive(question)
    missing_year = not year_specified and not all_years_directive
    missing_scope = not scope_specified and not all_scopes_directive
    query_shape = _query_shape(question=question, classification=classification)
    missing_fields: list[str] = []
    if missing_year:
        missing_fields.append("fiscal_year")
    if missing_scope:
        missing_fields.append("scope")
    return {
        "query_shape": query_shape,
        "missing_year": missing_year,
        "missing_scope": missing_scope,
        "missing_fields": missing_fields,
        "all_years_directive": all_years_directive,
        "all_scopes_directive": all_scopes_directive,
        "has_recency_cue": _RECENCY_RE.search(question or "") is not None,
    }


def _build_missing_dimension_clarification(*, evaluation: dict[str, Any]) -> str:
    missing_year = bool(evaluation.get("missing_year"))
    missing_scope = bool(evaluation.get("missing_scope"))
    if missing_year and missing_scope:
        return (
            "Do you want this across all published AIP records, or for a specific fiscal year and scope "
            "(barangay or city)?"
        )
    if missing_year:
        return "Do you want this across all published years, or for a specific fiscal year?"
    if missing_scope:
        return "Do you want this across all published scopes, or for a specific barangay or city?"
    return DEFAULT_CLARIFICATION_RESPONSE


def _build_transparency_statements(
    *,
    year_missing: bool,
    scope_missing: bool,
) -> list[str]:
    statements: list[str] = []
    if year_missing and scope_missing:
        statements.append(
            "Since no fiscal year or scope was specified, this is a broad result based only on the retrieved published AIP records."
        )
        return statements
    if year_missing:
        statements.append(
            "Since no fiscal year was specified, this answer is based on retrieved published AIP records across available years."
        )
    if scope_missing:
        statements.append(
            "Since no barangay or city was specified, this answer is based on retrieved published AIP records across available scopes."
        )
    return statements


def _prepend_transparency(answer: str, statements: list[str]) -> str:
    cleaned_answer = str(answer or "").strip()
    if not statements:
        return cleaned_answer
    prefix = " ".join(statements).strip()
    if not cleaned_answer:
        return prefix
    if cleaned_answer.startswith(prefix):
        return cleaned_answer
    return f"{prefix} {cleaned_answer}"


def _clarification_context_key(conversation_id: str | None) -> str | None:
    normalized = _normalize_text(conversation_id or "")
    return normalized if normalized else None


def _expire_clarification_context_locked(now: float) -> None:
    expired_keys: list[str] = []
    for conversation_id, payload in _CLARIFICATION_CONTEXT_STORE.items():
        created_at = float(payload.get("created_at") or 0.0)
        turns = int(payload.get("turns") or 0)
        if created_at <= 0 or (now - created_at) > _CLARIFICATION_CONTEXT_TTL_SECONDS or turns >= _CLARIFICATION_CONTEXT_MAX_TURNS:
            expired_keys.append(conversation_id)
    for conversation_id in expired_keys:
        _CLARIFICATION_CONTEXT_STORE.pop(conversation_id, None)


def _load_clarification_context_for_turn(conversation_id: str | None) -> tuple[dict[str, Any] | None, bool]:
    key = _clarification_context_key(conversation_id)
    if key is None:
        return None, False
    now = time.time()
    with _CLARIFICATION_CONTEXT_LOCK:
        had_entry_before_prune = key in _CLARIFICATION_CONTEXT_STORE
        _expire_clarification_context_locked(now)
        payload = _CLARIFICATION_CONTEXT_STORE.get(key)
        if payload is None:
            return None, had_entry_before_prune
        payload["turns"] = int(payload.get("turns") or 0) + 1
        payload["updated_at"] = now
        return dict(payload), False


def _clear_clarification_context(conversation_id: str | None) -> None:
    key = _clarification_context_key(conversation_id)
    if key is None:
        return
    with _CLARIFICATION_CONTEXT_LOCK:
        _CLARIFICATION_CONTEXT_STORE.pop(key, None)


def _store_clarification_context(
    *,
    conversation_id: str | None,
    original_question: str,
    clarification_question: str,
    unresolved_fields: list[str],
    resolved_entities: dict[str, Any],
    completeness_mode: str,
) -> bool:
    key = _clarification_context_key(conversation_id)
    if key is None:
        return False
    now = time.time()
    payload = {
        "original_question": original_question,
        "clarification_question": clarification_question,
        "unresolved_fields": list(unresolved_fields),
        "resolved_entities": dict(resolved_entities),
        "completeness_mode": completeness_mode,
        "created_at": now,
        "updated_at": now,
        "turns": 0,
    }
    with _CLARIFICATION_CONTEXT_LOCK:
        _CLARIFICATION_CONTEXT_STORE[key] = payload
    return True


def _follow_up_has_clarification_detail(message: str) -> bool:
    normalized = _normalize_text(message)
    lowered = normalized.lower()
    if not lowered:
        return False
    if _has_year(normalized):
        return True
    if extract_known_barangay_from_text(normalized) or extract_known_city_from_text(normalized):
        return True
    if _SCOPE_DETAIL_RE.search(lowered):
        return True
    if _DOMAIN_DETAIL_RE.search(lowered):
        return True
    if "all years" in lowered or "all scopes" in lowered or "all published" in lowered:
        return True
    return False


def _is_topic_change_message(message: str) -> bool:
    normalized = _normalize_text(message)
    lowered = normalized.lower()
    if not lowered:
        return False
    if _TOPIC_CHANGE_RE.search(lowered):
        return True
    if looks_like_broad_aip_query(normalized) and _QUESTION_LIKE_RE.search(lowered):
        return True
    if _QUESTION_LIKE_RE.search(lowered) and len(lowered.split()) >= 4:
        return True
    return False


def _merge_clarification_query(*, original_question: str, follow_up: str) -> str:
    return f"{_normalize_text(original_question)}\n\nUser clarification: {_normalize_text(follow_up)}"


def _resolve_latest_fiscal_year_from_preflight(
    *,
    settings: Settings,
    question: str,
    scope_payload: dict[str, Any],
    filters_payload: dict[str, Any],
) -> tuple[int | None, dict[str, Any]]:
    preflight = check_year_availability_preflight(
        supabase_url=settings.supabase_url,
        supabase_service_key=settings.supabase_service_key,
        question=question,
        retrieval_scope=scope_payload,
        retrieval_filters={**filters_payload, "fiscal_year": 2999},
    )
    available_years = [
        int(year)
        for year in list(preflight.get("available_fiscal_years") or [])
        if isinstance(year, int) or (isinstance(year, float) and float(year).is_integer())
    ]
    if not available_years:
        return None, preflight
    return max(available_years), preflight


def _attach_runtime_meta(
    *,
    retrieval_meta: dict[str, Any],
    clarification_context_status: str,
    missing_fields: list[str],
    enriched_query_used: bool,
) -> dict[str, Any]:
    retrieval_meta["clarification_context_status"] = clarification_context_status
    retrieval_meta["clarification_missing_fields"] = list(missing_fields)
    retrieval_meta["enriched_query_used"] = bool(enriched_query_used)
    return retrieval_meta


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
    conversation_id: str | None = Field(default=None, min_length=1, max_length=200)
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


def _normalize_scope_place(*, scope_type: str | None, scope_name: str | None) -> str | None:
    normalized_name = " ".join((scope_name or "").split())
    if not normalized_name:
        return None
    normalized_type = (scope_type or "").strip().lower()
    if normalized_type == "barangay":
        if normalized_name.lower().startswith("barangay "):
            return normalized_name
        return f"Barangay {normalized_name}"
    if normalized_type == "city":
        lowered = normalized_name.lower()
        if lowered.startswith("city of ") or lowered.endswith(" city"):
            return normalized_name
        return f"{normalized_name} City"
    return normalized_name


def _build_guided_no_result_message(
    *,
    classification: IntentResult,
    retrieval_filters: dict[str, Any],
) -> str:
    entities = classification.entities
    place: str | None = None
    if isinstance(entities.get("barangay"), str) and entities.get("barangay"):
        place = _normalize_scope_place(scope_type="barangay", scope_name=str(entities.get("barangay")))
    elif isinstance(entities.get("city"), str) and entities.get("city"):
        place = _normalize_scope_place(scope_type="city", scope_name=str(entities.get("city")))
    else:
        scope_type = retrieval_filters.get("scope_type")
        scope_name = retrieval_filters.get("scope_name")
        place = _normalize_scope_place(
            scope_type=str(scope_type) if isinstance(scope_type, str) else None,
            scope_name=str(scope_name) if isinstance(scope_name, str) else None,
        )

    place_text = f" for {place}" if place else ""
    return (
        f"No exact published AIP match was found{place_text}. "
        "Try narrowing by fiscal year, sector, or project type/category "
        "(for example: infrastructure, health, education, livelihood, or governance)."
    )


def _build_policy_clarification_response(
    *,
    question: str,
    classification: IntentResult,
    evaluation: dict[str, Any],
) -> ChatAnswerResponse:
    answer = _build_missing_dimension_clarification(evaluation=evaluation)
    retrieval_meta = _classifier_meta(classification)
    retrieval_meta.update(
        {
            "reason": "clarification_needed",
            "status": "clarification",
            "route_family": "policy_guard",
            "context_count": 0,
            "clarification_type": "missing_dimensions_for_exact_query",
            "query_shape": evaluation.get("query_shape"),
            "missing_fields": list(evaluation.get("missing_fields") or []),
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
    conversation_key = _clarification_context_key(req.conversation_id)
    clarification_context_status = "stateless" if conversation_key is None else "none"
    clarification_missing_fields: list[str] = []
    enriched_query_used = False
    effective_question = req.question
    clarification_original_question = req.question

    existing_context, context_expired = _load_clarification_context_for_turn(req.conversation_id)
    if conversation_key is not None and context_expired:
        clarification_context_status = "expired"
    if existing_context is not None:
        stored_original = str(existing_context.get("original_question") or "").strip()
        if stored_original:
            clarification_original_question = stored_original
        if _is_topic_change_message(req.question):
            _clear_clarification_context(req.conversation_id)
            clarification_context_status = "discarded_topic_change"
        elif _follow_up_has_clarification_detail(req.question):
            effective_question = _merge_clarification_query(
                original_question=clarification_original_question,
                follow_up=req.question,
            )
            clarification_missing_fields = list(existing_context.get("unresolved_fields") or [])
            enriched_query_used = True
            clarification_context_status = "merged"

    _trace_log(
        "request_received",
        question_preview=_preview(req.question),
        effective_question_preview=_preview(effective_question),
        conversation_id=conversation_key,
        clarification_context_status=clarification_context_status,
        enriched_query_used=enriched_query_used,
        retrieval_mode=req.retrieval_mode,
        top_k=req.top_k,
        min_similarity=req.min_similarity,
    )
    settings = Settings.load(require_supabase=True, require_openai=False)
    intent_model_override = (req.model_name or "").strip()
    model_name = (req.model_name or settings.pipeline_model).strip() or settings.pipeline_model

    try:
        classification = classify_message(
            message=effective_question,
            openai_api_key=settings.openai_api_key,
            default_model=intent_model_override,
        )
    except IntentClassificationError as error:
        _trace_log("classification_failed", error=str(error))
        logger.exception("Intent classification failed: %s", error)
        response = _build_classifier_failure_response(question=req.question, reason=str(error))
        response.retrieval_meta = _attach_runtime_meta(
            retrieval_meta=response.retrieval_meta,
            clarification_context_status=clarification_context_status,
            missing_fields=clarification_missing_fields,
            enriched_query_used=enriched_query_used,
        )
        return response

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
        if (
            classification.intent == "clarification"
            and existing_context is not None
            and not enriched_query_used
            and not _is_topic_change_message(req.question)
        ):
            clarification_missing_fields = list(existing_context.get("unresolved_fields") or [])
            response = ChatAnswerResponse(
                question=req.question,
                answer=str(existing_context.get("clarification_question") or DEFAULT_CLARIFICATION_RESPONSE),
                refused=False,
                citations=[],
                retrieval_meta={
                    **_classifier_meta(classification),
                    "reason": "clarification_needed",
                    "status": "clarification",
                    "route_family": "clarification_context",
                    "context_count": 0,
                },
                context_count=0,
            )
            response.retrieval_meta = _attach_runtime_meta(
                retrieval_meta=response.retrieval_meta,
                clarification_context_status=clarification_context_status,
                missing_fields=clarification_missing_fields,
                enriched_query_used=enriched_query_used,
            )
            return response

        response = _build_short_circuit_response(question=req.question, classification=classification)
        if classification.intent in {"greeting", "farewell", "thanks", "help", "small_talk", "out_of_scope"}:
            if existing_context is not None and conversation_key is not None:
                _clear_clarification_context(req.conversation_id)
                clarification_context_status = "discarded_topic_change"
                clarification_missing_fields = []
        if classification.intent == "clarification" and conversation_key is not None:
            unresolved = list(clarification_missing_fields)
            if not unresolved and existing_context is not None:
                unresolved = list(existing_context.get("unresolved_fields") or [])
            stored = _store_clarification_context(
                conversation_id=req.conversation_id,
                original_question=clarification_original_question,
                clarification_question=response.answer,
                unresolved_fields=unresolved,
                resolved_entities=classification.entities,
                completeness_mode="exploratory",
            )
            if stored:
                clarification_context_status = "stored"
                clarification_missing_fields = unresolved
            elif clarification_context_status == "merged":
                clarification_context_status = "none"
        response.retrieval_meta = _attach_runtime_meta(
            retrieval_meta=response.retrieval_meta,
            clarification_context_status=clarification_context_status,
            missing_fields=clarification_missing_fields,
            enriched_query_used=enriched_query_used,
        )
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
    evaluation = _evaluate_missing_dimensions(
        question=effective_question,
        filters_payload=filters_payload,
        scope_payload=scope_payload,
        classification=classification,
    )
    clarification_missing_fields = list(evaluation.get("missing_fields") or [])
    if evaluation.get("query_shape") == "exact_completeness" and clarification_missing_fields:
        response = _build_policy_clarification_response(
            question=req.question,
            classification=classification,
            evaluation=evaluation,
        )
        if conversation_key is not None:
            stored = _store_clarification_context(
                conversation_id=req.conversation_id,
                original_question=clarification_original_question,
                clarification_question=response.answer,
                unresolved_fields=clarification_missing_fields,
                resolved_entities=classification.entities,
                completeness_mode="exact_completeness",
            )
            if stored:
                clarification_context_status = "stored"
        response.retrieval_meta = _attach_runtime_meta(
            retrieval_meta=response.retrieval_meta,
            clarification_context_status=clarification_context_status,
            missing_fields=clarification_missing_fields,
            enriched_query_used=enriched_query_used,
        )
        return response

    recency_statement: str | None = None
    recency_preflight: dict[str, Any] | None = None
    if bool(evaluation.get("has_recency_cue")) and bool(evaluation.get("missing_year")):
        latest_year, recency_preflight = _resolve_latest_fiscal_year_from_preflight(
            settings=settings,
            question=effective_question,
            scope_payload=scope_payload,
            filters_payload=filters_payload,
        )
        if isinstance(latest_year, int):
            filters_payload["fiscal_year"] = latest_year
            evaluation["missing_year"] = False
            evaluation["missing_fields"] = [field for field in list(evaluation.get("missing_fields") or []) if field != "fiscal_year"]
            clarification_missing_fields = list(evaluation.get("missing_fields") or [])
            recency_statement = (
                f"You did not specify a fiscal year, so I used the most recent available published fiscal year (FY {latest_year})."
            )
        else:
            recency_statement = (
                "You did not specify a fiscal year, so I searched broad retrieved published records for recent or available matches."
            )

    effective_entities = dict(classification.entities)
    fiscal_year_filter = filters_payload.get("fiscal_year")
    if isinstance(fiscal_year_filter, int):
        effective_entities["fiscal_year"] = fiscal_year_filter
    scope_type_filter = filters_payload.get("scope_type")
    scope_name_filter = filters_payload.get("scope_name")
    if isinstance(scope_type_filter, str) and scope_type_filter.strip():
        effective_entities["scope_type"] = scope_type_filter
    if isinstance(scope_name_filter, str) and scope_name_filter.strip():
        effective_entities["scope_name"] = scope_name_filter

    _trace_log(
        "retrieval_started",
        query_shape=evaluation.get("query_shape"),
        missing_fields=evaluation.get("missing_fields"),
        recency_preflight=recency_preflight,
        scope_mode=scope_payload.get("mode"),
        scope_targets_count=len(scope_payload.get("targets") or []),
        retrieval_filters=filters_payload,
        scope_fallback_applied=scope_fallback_meta.get("scope_fallback_applied"),
        scope_fallback_mode=scope_fallback_meta.get("scope_fallback_mode"),
    )
    year_preflight = check_year_availability_preflight(
        supabase_url=settings.supabase_url,
        supabase_service_key=settings.supabase_service_key,
        question=effective_question,
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
        if conversation_key is not None:
            stored = _store_clarification_context(
                conversation_id=req.conversation_id,
                original_question=clarification_original_question,
                clarification_question=response.answer,
                unresolved_fields=["fiscal_year"],
                resolved_entities=effective_entities,
                completeness_mode=str(evaluation.get("query_shape") or "exploratory"),
            )
            if stored:
                clarification_context_status = "stored"
                clarification_missing_fields = ["fiscal_year"]
        response.retrieval_meta = _attach_runtime_meta(
            retrieval_meta=response.retrieval_meta,
            clarification_context_status=clarification_context_status,
            missing_fields=clarification_missing_fields,
            enriched_query_used=enriched_query_used,
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
        question=effective_question,
        retrieval_scope=scope_payload,
        retrieval_filters=filters_payload,
    )
    if sql_result is not None:
        normalized = _normalize_result_payload(sql_result, default_question=req.question)
        normalized["retrieval_meta"]["sql_attempted"] = True
        normalized["retrieval_meta"]["sql_scoped"] = True
        normalized["retrieval_meta"]["fallback_source"] = "sql"
        normalized["retrieval_meta"] = _merge_classifier_meta(normalized["retrieval_meta"], classification)
        transparency = _build_transparency_statements(
            year_missing=bool(evaluation.get("missing_year")),
            scope_missing=bool(evaluation.get("missing_scope")),
        )
        if recency_statement:
            transparency = [recency_statement, *transparency]
        if str(normalized["retrieval_meta"].get("status") or "") == "answer":
            normalized["answer"] = _prepend_transparency(normalized["answer"], transparency)
        if enriched_query_used and conversation_key is not None:
            _clear_clarification_context(req.conversation_id)
            clarification_context_status = "cleared"
            clarification_missing_fields = []
        normalized["retrieval_meta"] = _attach_runtime_meta(
            retrieval_meta=normalized["retrieval_meta"],
            clarification_context_status=clarification_context_status,
            missing_fields=clarification_missing_fields,
            enriched_query_used=enriched_query_used,
        )
        _trace_log(
            "sql_answered",
            status=normalized["retrieval_meta"].get("status"),
            reason=normalized["retrieval_meta"].get("reason"),
            refused=normalized["refused"],
            context_count=normalized["context_count"],
        )
        return ChatAnswerResponse(
            question=req.question,
            answer=normalized["answer"],
            refused=normalized["refused"],
            citations=normalized["citations"],
            retrieval_meta=normalized["retrieval_meta"],
            context_count=normalized["context_count"],
        )
    _trace_log("sql_no_answer")

    retrieval_query = build_retrieval_query(
        question=effective_question,
        entities=effective_entities,
    )

    if not settings.openai_api_key:
        settings = Settings.load(require_supabase=True, require_openai=True)

    rag_result = answer_with_rag(
        supabase_url=settings.supabase_url,
        supabase_service_key=settings.supabase_service_key,
        openai_api_key=settings.openai_api_key,
        embeddings_model=settings.embedding_model,
        chat_model=model_name,
        question=effective_question,
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
    if normalized["refused"] and str(normalized["retrieval_meta"].get("reason") or "") == "insufficient_evidence":
        normalized["answer"] = _build_guided_no_result_message(
            classification=classification,
            retrieval_filters=filters_payload,
        )
        normalized["retrieval_meta"]["guided_no_result"] = True
    transparency = _build_transparency_statements(
        year_missing=bool(evaluation.get("missing_year")),
        scope_missing=bool(evaluation.get("missing_scope")),
    )
    if recency_statement:
        transparency = [recency_statement, *transparency]
    if str(normalized["retrieval_meta"].get("status") or "") == "answer":
        normalized["answer"] = _prepend_transparency(normalized["answer"], transparency)
    if str(normalized["retrieval_meta"].get("status") or "") == "clarification" and conversation_key is not None:
        unresolved = list(evaluation.get("missing_fields") or [])
        stored = _store_clarification_context(
            conversation_id=req.conversation_id,
            original_question=clarification_original_question,
            clarification_question=normalized["answer"],
            unresolved_fields=unresolved,
            resolved_entities=effective_entities,
            completeness_mode=str(evaluation.get("query_shape") or "exploratory"),
        )
        if stored:
            clarification_context_status = "stored"
            clarification_missing_fields = unresolved
    elif enriched_query_used and conversation_key is not None:
        _clear_clarification_context(req.conversation_id)
        clarification_context_status = "cleared"
        clarification_missing_fields = []
    normalized["retrieval_meta"] = _attach_runtime_meta(
        retrieval_meta=normalized["retrieval_meta"],
        clarification_context_status=clarification_context_status,
        missing_fields=clarification_missing_fields,
        enriched_query_used=enriched_query_used,
    )
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
        question=req.question,
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
