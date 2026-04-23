from __future__ import annotations

import re
from typing import Any

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
_FISCAL_YEAR_RE = re.compile(r"\b(?:fy|fiscal year)\s*(20\d{2})\b|\b(20\d{2})\b", re.IGNORECASE)
_BARANGAY_RE = re.compile(
    r"\b(?:barangay|brgy\.?)\s+([a-z0-9][a-z0-9\s\-.']{1,80}?)"
    r"(?=\s+(?:for|in|with|and|or|from|to|fy|fiscal|budget|budgets|project|projects|program|programs|"
    r"sector|type|category|under|on|about)\b|[,.!?;]|$)",
    re.IGNORECASE,
)
_CITY_RE = re.compile(
    r"\b(?:city of|city)\s+([a-z0-9][a-z0-9\s\-.']{1,80}?)"
    r"(?=\s+(?:for|in|with|and|or|from|to|fy|fiscal|budget|budgets|project|projects|program|programs|"
    r"sector|type|category|under|on|about)\b|[,.!?;]|$)",
    re.IGNORECASE,
)

_BROAD_DOMAIN_TERMS: tuple[str, ...] = (
    "aip",
    "annual investment program",
    "investment program",
    "project",
    "projects",
    "program",
    "programs",
    "budget",
    "budgets",
    "barangay",
    "city",
    "fiscal year",
    "fy ",
    "sector",
    "category",
)

_BROAD_EXPLORATION_TERMS: tuple[str, ...] = (
    "show",
    "list",
    "recommend",
    "suggest",
    "available",
    "possible",
    "options",
    "what projects",
    "what programs",
    "which projects",
    "which programs",
    "give me",
    "can you show",
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


def _as_title_case(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = " ".join(value.strip(" .,:;!?\"'`").split())
    if not cleaned:
        return None
    return " ".join(part.capitalize() for part in cleaned.split())


def _extract_named_entity(text: str, pattern: re.Pattern[str]) -> str | None:
    match = pattern.search(text)
    if not match:
        return None
    return _as_title_case(match.group(1))


def _extract_fiscal_year(text: str) -> int | None:
    for primary, alternate in _FISCAL_YEAR_RE.findall(text):
        candidate = primary or alternate
        if not candidate:
            continue
        year = int(candidate)
        if 2000 <= year <= 2100:
            return year
    return None


def extract_broad_query_entities(message: str) -> dict[str, Any]:
    entities = empty_entities()
    normalized = normalize_text(message)
    barangay = _extract_named_entity(normalized, _BARANGAY_RE)
    city = _extract_named_entity(normalized, _CITY_RE)
    fiscal_year = _extract_fiscal_year(normalized)

    entities["barangay"] = barangay
    entities["city"] = city
    entities["fiscal_year"] = fiscal_year
    if barangay:
        entities["scope_type"] = "barangay"
        entities["scope_name"] = barangay
    elif city:
        entities["scope_type"] = "city"
        entities["scope_name"] = city
    return entities


def _has_core_aip_domain_signal(normalized: str) -> bool:
    core_terms = (
        "aip",
        "annual investment program",
        "investment program",
        "project",
        "projects",
        "program",
        "programs",
        "budget",
        "budgets",
        "barangay",
        "city",
        "sector",
    )
    return any(term in normalized for term in core_terms)


def looks_like_broad_aip_query(message: str) -> bool:
    normalized = normalize_text(message).lower()
    if not normalized:
        return False
    if _is_out_of_scope(normalized):
        return False

    has_domain = any(term in normalized for term in _BROAD_DOMAIN_TERMS)
    if not has_domain:
        return False

    has_exploration = any(term in normalized for term in _BROAD_EXPLORATION_TERMS)
    starts_with_question = normalized.startswith(("what", "which", "show", "list", "recommend", "suggest", "give"))
    locative_phrase = " in " in f" {normalized} " or " for " in f" {normalized} "
    return has_exploration or starts_with_question or locative_phrase


def _result(
    *,
    intent: str,
    confidence: float,
    needs_retrieval: bool,
    friendly_response: str | None = None,
    route_hint: str | None = None,
    entities: dict[str, Any] | None = None,
    classifier_method: str = "rule",
) -> IntentResult:
    return IntentResult(
        intent=intent,
        confidence=max(0.0, min(1.0, float(confidence))),
        needs_retrieval=needs_retrieval,
        friendly_response=friendly_response,
        entities=dict(entities) if isinstance(entities, dict) else empty_entities(),
        route_hint=route_hint if route_hint is not None else INTENT_ROUTE_HINTS.get(intent),
        classifier_method=classifier_method,
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

    if looks_like_broad_aip_query(normalized):
        return _result(
            intent="rag_query",
            confidence=0.78,
            needs_retrieval=True,
            route_hint="rag_query",
            entities=extract_broad_query_entities(normalized),
        )

    if _is_out_of_scope(lowered):
        return _result(
            intent="out_of_scope",
            confidence=0.95,
            needs_retrieval=False,
            friendly_response=AIP_ONLY_RESPONSE,
        )

    return None


def classify_with_heuristics(message: str) -> IntentResult:
    normalized = normalize_text(message)
    entities = extract_broad_query_entities(normalized)
    broad = looks_like_broad_aip_query(normalized)
    has_location = bool(entities.get("barangay") or entities.get("city") or entities.get("scope_name"))
    has_fiscal_year = isinstance(entities.get("fiscal_year"), int)
    if broad or has_location or (has_fiscal_year and _has_core_aip_domain_signal(normalized.lower())):
        return _result(
            intent="rag_query",
            confidence=0.55,
            needs_retrieval=True,
            route_hint="rag_query",
            entities=entities,
            classifier_method="heuristic",
        )

    return _result(
        intent="out_of_scope",
        confidence=0.55,
        needs_retrieval=False,
        friendly_response=AIP_ONLY_RESPONSE,
        classifier_method="heuristic",
    )
