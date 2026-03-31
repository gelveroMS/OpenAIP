from __future__ import annotations

import json
import logging
import os

from openaip_pipeline.services.intent.classifier import classify_with_llm
from openaip_pipeline.services.intent.rules import classify_with_rules
from openaip_pipeline.services.intent.types import DEFAULT_CLARIFICATION_RESPONSE, IntentResult

logger = logging.getLogger(__name__)

_RAG_CONFIDENCE_FLOOR = 0.55
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


def _apply_low_confidence_guard(result: IntentResult) -> IntentResult:
    if result.intent != "rag_query":
        return result
    if result.confidence >= _RAG_CONFIDENCE_FLOOR:
        return result
    entities = dict(result.entities)
    if _has_useful_entities(entities):
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
    override = os.getenv("PIPELINE_INTENT_MODEL", "").strip()
    if override:
        return override
    fallback = (default_model or "").strip()
    return fallback if fallback else "gpt-5.2"


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


def classify_message(*, message: str, openai_api_key: str | None, default_model: str) -> IntentResult:
    rules_result = classify_with_rules(message)
    if rules_result is not None:
        normalized_rules_result = _apply_low_confidence_guard(rules_result)
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
        raise IntentClassificationError(
            "OPENAI_API_KEY is required for LLM fallback classification and was not configured."
        )

    try:
        result = classify_with_llm(
            message=message,
            openai_api_key=key,
            model_name=model_name,
        )
        normalized_result = _apply_low_confidence_guard(result)
        _trace_log(
            "llm_fallback_success",
            intent=normalized_result.intent,
            confidence=normalized_result.confidence,
            route_hint=normalized_result.route_hint,
            needs_retrieval=normalized_result.needs_retrieval,
        )
        return normalized_result
    except Exception as error:
        _trace_log("llm_fallback_failed", error=str(error))
        raise IntentClassificationError("LLM fallback classification failed.") from error
