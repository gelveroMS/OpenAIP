from __future__ import annotations

import re

from openaip_pipeline.services.chat import sql_router
from openaip_pipeline.services.intent.types import (
    AIP_ONLY_RESPONSE,
    DEFAULT_CLARIFICATION_RESPONSE,
    DEFAULT_FRIENDLY_RESPONSES,
    INTENT_ROUTE_HINTS,
    IntentResult,
    empty_entities,
)

_GREETING_RE = re.compile(r"\b(hi|hello|hey|good morning|good afternoon|good evening|kumusta)\b", re.IGNORECASE)
_FAREWELL_RE = re.compile(r"\b(bye|goodbye|see you|quit|exit|paalam)\b", re.IGNORECASE)
_THANKS_RE = re.compile(r"\b(thanks|thank you|thx|ty|salamat|maraming salamat)\b", re.IGNORECASE)
_HELP_RE = re.compile(
    r"\b(help|assist|what can you do|how can you help|paano ka makakatulong|anong pwede mong gawin)\b",
    re.IGNORECASE,
)
_SMALL_TALK_RE = re.compile(
    r"\b(how are you|who are you|what are you|are you there|what's up|kamusta ka)\b",
    re.IGNORECASE,
)

_OUT_OF_SCOPE_TOKENS = (
    "weather",
    "temperature",
    "coding",
    "code",
    "python",
    "javascript",
    "math",
    "algebra",
    "politics",
    "election",
    "president",
    "mayor",
    "who is",
    "what did you eat",
    "recipe",
    "movie",
    "song",
    "news",
    "stock",
    "crypto",
    "sports",
)


def normalize_text(text: str) -> str:
    return " ".join((text or "").strip().split())


def _result(
    *,
    intent: str,
    confidence: float,
    needs_retrieval: bool,
    friendly_response: str | None = None,
    route_hint: str | None = None,
) -> IntentResult:
    return IntentResult(
        intent=intent,
        confidence=max(0.0, min(1.0, float(confidence))),
        needs_retrieval=needs_retrieval,
        friendly_response=friendly_response,
        entities=empty_entities(),
        route_hint=route_hint if route_hint is not None else INTENT_ROUTE_HINTS.get(intent),
        classifier_method="rule",
    )


def _is_out_of_scope(normalized_lower: str) -> bool:
    return any(token in normalized_lower for token in _OUT_OF_SCOPE_TOKENS)


def _classify_domain_intent(original: str, normalized_lower: str) -> IntentResult | None:
    metadata_intent = sql_router._detect_metadata(normalized_lower)
    if metadata_intent is not None:
        return _result(
            intent="metadata_query",
            confidence=0.96,
            needs_retrieval=True,
            route_hint="metadata_sql",
        )

    if sql_router._is_compare_years(normalized_lower):
        return _result(
            intent="compare_years",
            confidence=0.96,
            needs_retrieval=True,
            route_hint="aggregate_sql",
        )

    if sql_router._is_totals(normalized_lower):
        return _result(
            intent="total_aggregation",
            confidence=0.95,
            needs_retrieval=True,
            route_hint="sql_totals",
        )

    aggregation_intent = sql_router._detect_aggregation(normalized_lower)
    if aggregation_intent is not None:
        return _result(
            intent="category_aggregation",
            confidence=0.95,
            needs_retrieval=True,
            route_hint="aggregate_sql",
        )

    if sql_router._is_line_item_query(original, normalized_lower):
        return _result(
            intent="line_item_lookup",
            confidence=0.95,
            needs_retrieval=True,
            route_hint="row_sql",
        )

    return None


def classify_with_rules(message: str) -> IntentResult | None:
    normalized = normalize_text(message)
    if not normalized:
        return _result(
            intent="clarification",
            confidence=1.0,
            needs_retrieval=False,
            friendly_response=DEFAULT_CLARIFICATION_RESPONSE,
        )

    lowered = normalized.lower()

    if _GREETING_RE.search(normalized):
        return _result(
            intent="greeting",
            confidence=1.0,
            needs_retrieval=False,
            friendly_response=DEFAULT_FRIENDLY_RESPONSES["greeting"],
        )

    if _FAREWELL_RE.search(normalized):
        return _result(
            intent="farewell",
            confidence=1.0,
            needs_retrieval=False,
            friendly_response=DEFAULT_FRIENDLY_RESPONSES["farewell"],
        )

    if _THANKS_RE.search(normalized):
        return _result(
            intent="thanks",
            confidence=1.0,
            needs_retrieval=False,
            friendly_response=DEFAULT_FRIENDLY_RESPONSES["thanks"],
        )

    if _HELP_RE.search(normalized):
        return _result(
            intent="help",
            confidence=0.98,
            needs_retrieval=False,
            friendly_response=DEFAULT_FRIENDLY_RESPONSES["help"],
        )

    if _SMALL_TALK_RE.search(normalized):
        return _result(
            intent="small_talk",
            confidence=0.9,
            needs_retrieval=False,
            friendly_response=DEFAULT_FRIENDLY_RESPONSES["small_talk"],
        )

    domain = _classify_domain_intent(normalized, lowered)
    if domain is not None:
        return domain

    if _is_out_of_scope(lowered):
        return _result(
            intent="out_of_scope",
            confidence=0.95,
            needs_retrieval=False,
            friendly_response=AIP_ONLY_RESPONSE,
        )

    return None
