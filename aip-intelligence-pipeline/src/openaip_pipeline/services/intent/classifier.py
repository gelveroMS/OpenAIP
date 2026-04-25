from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from openaip_pipeline.services.intent.rules import (
    extract_known_barangay_from_text,
    extract_known_city_from_text,
    has_retrievable_aip_signal,
    is_incomplete_follow_up,
)
from openaip_pipeline.services.intent.types import (
    AIP_ONLY_RESPONSE,
    DEFAULT_CLARIFICATION_RESPONSE,
    DEFAULT_FRIENDLY_RESPONSES,
    INTENT_ENTITY_KEYS,
    INTENT_ROUTE_HINTS,
    NON_RETRIEVAL_INTENTS,
    VALID_INTENTS,
    IntentResult,
    empty_entities,
)
from openaip_pipeline.services.openai_utils import build_openai_client

logger = logging.getLogger(__name__)

_SCOPE_TYPE_VALUES = {"barangay", "city"}
_DEFAULT_INTENT = "clarification"
_DEFAULT_CONFIDENCE = 0.0
_CLARIFICATION_PROMOTION_CONFIDENCE = 0.65

_CLASSIFIER_SYSTEM_PROMPT = (
    "You are an intent classifier and entity extractor for OpenAIP.\n"
    "OpenAIP only answers Annual Investment Program (AIP) data questions such as projects, programs, budgets, sectors, barangays, cities, and fiscal years.\n"
    "Return only valid JSON.\n\n"
    "Choose exactly one intent:\n"
    "- greeting\n"
    "- farewell\n"
    "- thanks\n"
    "- help\n"
    "- small_talk\n"
    "- out_of_scope\n"
    "- clarification\n"
    "- total_aggregation\n"
    "- category_aggregation\n"
    "- line_item_lookup\n"
    "- metadata_query\n"
    "- compare_years\n"
    "- rag_query\n\n"
    "Return this JSON schema:\n"
    "{\n"
    '  "intent": "string",\n'
    '  "confidence": 0.0,\n'
    '  "needs_retrieval": true,\n'
    '  "friendly_response": "string or null",\n'
    '  "route_hint": "string or null",\n'
    '  "entities": {\n'
    '    "barangay": null,\n'
    '    "city": null,\n'
    '    "fiscal_year": null,\n'
    '    "topic": null,\n'
    '    "project_type": null,\n'
    '    "sector": null,\n'
    '    "budget_term": null,\n'
    '    "scope_name": null,\n'
    '    "scope_type": null\n'
    "  }\n"
    "}\n\n"
    "Rules:\n"
    "1. Output JSON only.\n"
    "2. Use null for unknown entities.\n"
    "3. Set out_of_scope for requests unrelated to AIP/OpenAIP data.\n"
    "4. If the message is broadly AIP-related, prefer rag_query over clarification.\n"
    "5. Use clarification only when the request is too incomplete to retrieve even broad related AIP records.\n"
    "6. Set needs_retrieval=false for greeting, farewell, thanks, help, small_talk, out_of_scope, clarification.\n"
    "7. Set needs_retrieval=true for total_aggregation, category_aggregation, line_item_lookup, metadata_query, compare_years, rag_query.\n"
    "8. Set friendly_response for conversational intents, clarification, and out_of_scope.\n"
    "9. Use route_hint when clear: sql_totals, aggregate_sql, row_sql, metadata_sql, rag_query; otherwise null.\n"
    "10. Do not invent entities unless clearly present.\n"
    "11. scope_type can only be barangay or city.\n"
    "12. Treat these as rag_query examples:\n"
    '- "What projects are in Mamatid?"\n'
    '- "Show projects in Pulo."\n'
    '- "List available projects in San Isidro."\n'
    '- "Recommend projects in Mamatid."\n'
    '- "What budgets are available for Cabuyao?"\n'
    '- "What programs are in Banaybanay?"\n'
    '- "What are the health-related projects?"\n'
    '- "Show all infrastructure projects."\n'
)


def _trace_enabled() -> bool:
    explicit = os.getenv("PIPELINE_INTENT_TRACE_ENABLED")
    if explicit is not None:
        return explicit.strip().lower() in {"1", "true", "yes", "on"}
    inherited = os.getenv("PIPELINE_TRACE_ENABLED", "false")
    return inherited.strip().lower() in {"1", "true", "yes", "on"}


def _trace_log(event: str, **fields: object) -> None:
    if not _trace_enabled():
        return
    payload = {"trace": "intent_classifier", "event": event}
    payload.update(fields)
    logger.info(json.dumps(payload, separators=(",", ":"), sort_keys=True))


def _preview(text: str, *, limit: int = 240) -> str:
    normalized = " ".join((text or "").split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3].rstrip() + "..."


def _extract_json(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw, flags=re.IGNORECASE)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        first = raw.find("{")
        last = raw.rfind("}")
        if first == -1 or last == -1 or last <= first:
            raise
        parsed = json.loads(raw[first : last + 1])
    if not isinstance(parsed, dict):
        raise ValueError("Classifier output is not a JSON object.")
    return parsed


def _as_string_or_none(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped if stripped else None
    return None


def _as_confidence(value: Any) -> float:
    if isinstance(value, (int, float)):
        parsed = float(value)
    elif isinstance(value, str):
        try:
            parsed = float(value.strip())
        except ValueError:
            parsed = _DEFAULT_CONFIDENCE
    else:
        parsed = _DEFAULT_CONFIDENCE
    return max(0.0, min(1.0, parsed))


def _normalize_intent(value: Any) -> str:
    intent = _as_string_or_none(value)
    if not intent:
        return _DEFAULT_INTENT
    lowered = intent.lower()
    return lowered if lowered in VALID_INTENTS else _DEFAULT_INTENT


def _normalize_fiscal_year(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, int):
        year = value
    elif isinstance(value, float) and value.is_integer():
        year = int(value)
    elif isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            year = int(stripped)
        except ValueError:
            return None
    else:
        return None
    return year if 2000 <= year <= 2100 else None


def _normalize_scope_type(value: Any) -> str | None:
    normalized = _as_string_or_none(value)
    if not normalized:
        return None
    lowered = normalized.lower()
    return lowered if lowered in _SCOPE_TYPE_VALUES else None


def _normalize_entities(value: Any) -> dict[str, Any]:
    normalized = empty_entities()
    if not isinstance(value, dict):
        return normalized

    for key in INTENT_ENTITY_KEYS:
        if key not in value:
            continue
        if key == "fiscal_year":
            normalized[key] = _normalize_fiscal_year(value.get(key))
            continue
        if key == "scope_type":
            normalized[key] = _normalize_scope_type(value.get(key))
            continue
        normalized[key] = _as_string_or_none(value.get(key))

    barangay = _as_string_or_none(normalized.get("barangay"))
    city = _as_string_or_none(normalized.get("city"))
    scope_type = normalized.get("scope_type")
    scope_name = _as_string_or_none(normalized.get("scope_name"))

    # Keep scope output constrained and aligned with explicit location entities.
    if barangay:
        normalized["scope_type"] = "barangay"
        normalized["scope_name"] = barangay
        return normalized
    if city:
        normalized["scope_type"] = "city"
        normalized["scope_name"] = city
        return normalized
    if isinstance(scope_type, str) and scope_type in _SCOPE_TYPE_VALUES and scope_name:
        normalized["scope_type"] = scope_type
        normalized["scope_name"] = scope_name
        return normalized

    normalized["scope_type"] = None
    normalized["scope_name"] = None
    return normalized


def _normalize_needs_retrieval(intent: str, value: Any) -> bool:
    if intent in NON_RETRIEVAL_INTENTS:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes"}:
            return True
        if lowered in {"false", "0", "no"}:
            return False
    return True


def _augment_entities_from_message(*, message: str, entities: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(entities)
    barangay = normalized.get("barangay")
    city = normalized.get("city")

    if not isinstance(barangay, str) or not barangay.strip():
        extracted_barangay = extract_known_barangay_from_text(message)
        if extracted_barangay:
            normalized["barangay"] = extracted_barangay
            normalized["scope_type"] = "barangay"
            normalized["scope_name"] = extracted_barangay
            return normalized
    if not isinstance(city, str) or not city.strip():
        extracted_city = extract_known_city_from_text(message)
        if extracted_city:
            normalized["city"] = extracted_city
            normalized["scope_type"] = "city"
            normalized["scope_name"] = extracted_city
    return normalized


def _should_promote_clarification_to_rag(*, message: str, entities: dict[str, Any]) -> bool:
    if is_incomplete_follow_up(message) and not has_retrievable_aip_signal(message, entities=entities):
        return False
    return has_retrievable_aip_signal(message, entities=entities)


def _default_friendly_response(intent: str) -> str | None:
    if intent == "out_of_scope":
        return AIP_ONLY_RESPONSE
    if intent == "clarification":
        return DEFAULT_CLARIFICATION_RESPONSE
    return DEFAULT_FRIENDLY_RESPONSES.get(intent)


def _extract_response_text(response: Any) -> str:
    choices = getattr(response, "choices", None)
    if isinstance(choices, list) and choices:
        message = getattr(choices[0], "message", None)
        if message is not None:
            content = getattr(message, "content", None)
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts: list[str] = []
                for item in content:
                    if isinstance(item, dict):
                        text = item.get("text")
                        if isinstance(text, str):
                            parts.append(text)
                if parts:
                    return "\n".join(parts)
    return ""


def classify_with_llm(*, message: str, openai_api_key: str, model_name: str) -> IntentResult:
    _trace_log(
        "llm_request_started",
        model_name=model_name,
        message_preview=_preview(message),
    )
    client = build_openai_client(openai_api_key)
    response = client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": _CLASSIFIER_SYSTEM_PROMPT},
            {"role": "user", "content": f"USER MESSAGE:\n{message.strip()}"},
        ],
    )
    raw_text = _extract_response_text(response)
    _trace_log("llm_response_received", response_preview=_preview(raw_text))
    try:
        parsed = _extract_json(raw_text)
    except Exception as error:
        _trace_log("llm_response_parse_failed", error=str(error), response_preview=_preview(raw_text))
        raise

    intent = _normalize_intent(parsed.get("intent"))
    confidence = _as_confidence(parsed.get("confidence"))
    entities = _normalize_entities(parsed.get("entities"))
    entities = _augment_entities_from_message(message=message, entities=entities)
    needs_retrieval = _normalize_needs_retrieval(intent, parsed.get("needs_retrieval"))
    clarification_promoted = False

    if intent == "clarification" and _should_promote_clarification_to_rag(message=message, entities=entities):
        intent = "rag_query"
        needs_retrieval = True
        confidence = max(confidence, _CLARIFICATION_PROMOTION_CONFIDENCE)
        clarification_promoted = True

    friendly_response = _as_string_or_none(parsed.get("friendly_response"))
    if clarification_promoted:
        friendly_response = None
    if friendly_response is None:
        friendly_response = _default_friendly_response(intent)

    route_hint = _as_string_or_none(parsed.get("route_hint"))
    if route_hint is None:
        route_hint = INTENT_ROUTE_HINTS.get(intent)

    _trace_log(
        "llm_response_normalized",
        intent=intent,
        confidence=confidence,
        needs_retrieval=needs_retrieval,
        route_hint=route_hint,
        entities=entities,
    )

    return IntentResult(
        intent=intent,
        confidence=confidence,
        needs_retrieval=needs_retrieval,
        friendly_response=friendly_response,
        entities=entities,
        route_hint=route_hint,
        classifier_method="llm",
    )
