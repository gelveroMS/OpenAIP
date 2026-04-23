from __future__ import annotations

import json
import logging
import os

from openaip_pipeline.services.intent.classifier import classify_with_llm
from openaip_pipeline.services.intent.rules import (
    classify_with_heuristics,
    classify_with_rules,
    looks_like_broad_aip_query,
)
from openaip_pipeline.services.intent.types import DEFAULT_CLARIFICATION_RESPONSE, IntentResult

logger = logging.getLogger(__name__)

_RAG_CONFIDENCE_FLOOR = 0.55
_INTENT_COMPAT_MODEL_FALLBACK = "gpt-5.2"
_USEFUL_ENTITY_KEYS: tuple[str, ...] = (
    "fiscal_year",
    "scope_name",
    "scope_type",
    "barangay",
    "city",
    "topic",
    "project_type",
    "sector",
    "budget_term",
)


class IntentClassificationError(RuntimeError):
    """Raised when intent classification cannot produce a valid result."""


def _has_useful_entities(entities: dict[str, object]) -> bool:
    for key in _USEFUL_ENTITY_KEYS:
        value = entities.get(key)
        if value is None:
            continue
        if isinstance(value, str):
            if value.strip():
                return True
            continue
        return True
    return False


def _apply_low_confidence_guard(result: IntentResult, *, message: str) -> IntentResult:
    if result.intent != "rag_query":
        return result
    if result.confidence >= _RAG_CONFIDENCE_FLOOR:
        return result
    entities = dict(result.entities)
    if _has_useful_entities(entities):
        return result
    if looks_like_broad_aip_query(message):
        return result
    return IntentResult(
        intent="clarification",
        confidence=result.confidence,
        needs_retrieval=False,
        friendly_response=DEFAULT_CLARIFICATION_RESPONSE,
        entities=entities,
        route_hint=None,
        classifier_method=result.classifier_method,
    )


def resolve_intent_model(default_model: str) -> str:
    request_override = (default_model or "").strip()
    if request_override:
        return request_override
    env_override = os.getenv("PIPELINE_INTENT_MODEL", "").strip()
    if env_override:
        return env_override
    return "gpt-5.2-mini"


def _trace_enabled() -> bool:
    explicit = os.getenv("PIPELINE_INTENT_TRACE_ENABLED")
    if explicit is not None:
        return explicit.strip().lower() in {"1", "true", "yes", "on"}
    inherited = os.getenv("PIPELINE_TRACE_ENABLED", "false")
    return inherited.strip().lower() in {"1", "true", "yes", "on"}


def _trace_log(event: str, **fields: object) -> None:
    if not _trace_enabled():
        return
    payload = {"trace": "intent", "event": event}
    payload.update(fields)
    logger.info(json.dumps(payload, separators=(",", ":"), sort_keys=True))


def _is_model_not_found_error(error: Exception) -> bool:
    text = str(error).lower()
    return "model_not_found" in text or "does not exist or you do not have access to it" in text


def _heuristic_fallback(message: str, *, reason: str) -> IntentResult:
    fallback = classify_with_heuristics(message)
    _trace_log(
        "heuristic_fallback_applied",
        reason=reason,
        intent=fallback.intent,
        confidence=fallback.confidence,
        route_hint=fallback.route_hint,
        needs_retrieval=fallback.needs_retrieval,
        classifier_method=fallback.classifier_method,
    )
    return fallback


def classify_message(*, message: str, openai_api_key: str | None, default_model: str) -> IntentResult:
    rules_result = classify_with_rules(message)
    if rules_result is not None:
        normalized_rules_result = _apply_low_confidence_guard(rules_result, message=message)
        _trace_log(
            "rules_match",
            intent=normalized_rules_result.intent,
            confidence=normalized_rules_result.confidence,
            route_hint=normalized_rules_result.route_hint,
            needs_retrieval=normalized_rules_result.needs_retrieval,
        )
        return normalized_rules_result

    model_name = resolve_intent_model(default_model)
    _trace_log("rules_miss", fallback_model=model_name)

    key = (openai_api_key or "").strip()
    if not key:
        _trace_log("llm_fallback_unavailable", reason="missing_openai_api_key")
        return _heuristic_fallback(message, reason="missing_openai_api_key")

    def _invoke(model: str) -> IntentResult:
        return classify_with_llm(
            message=message,
            openai_api_key=key,
            model_name=model,
        )

    try:
        result = _invoke(model_name)
        normalized_result = _apply_low_confidence_guard(result, message=message)
        _trace_log(
            "llm_fallback_success",
            intent=normalized_result.intent,
            confidence=normalized_result.confidence,
            route_hint=normalized_result.route_hint,
            needs_retrieval=normalized_result.needs_retrieval,
        )
        return normalized_result
    except Exception as error:
        if _is_model_not_found_error(error) and model_name != _INTENT_COMPAT_MODEL_FALLBACK:
            _trace_log(
                "llm_model_not_found_retry",
                from_model=model_name,
                to_model=_INTENT_COMPAT_MODEL_FALLBACK,
                error=str(error),
            )
            try:
                retry_result = _invoke(_INTENT_COMPAT_MODEL_FALLBACK)
                normalized_retry_result = _apply_low_confidence_guard(retry_result, message=message)
                _trace_log(
                    "llm_fallback_success",
                    intent=normalized_retry_result.intent,
                    confidence=normalized_retry_result.confidence,
                    route_hint=normalized_retry_result.route_hint,
                    needs_retrieval=normalized_retry_result.needs_retrieval,
                    model_name=_INTENT_COMPAT_MODEL_FALLBACK,
                )
                return normalized_retry_result
            except Exception as retry_error:
                _trace_log("llm_fallback_failed", error=str(retry_error))
                return _heuristic_fallback(message, reason=f"llm_retry_failed:{retry_error}")

        _trace_log("llm_fallback_failed", error=str(error))
        return _heuristic_fallback(message, reason=f"llm_failed:{error}")
