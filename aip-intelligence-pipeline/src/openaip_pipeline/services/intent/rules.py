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

KNOWN_BARANGAYS: tuple[str, ...] = ("Mamatid", "Pulo", "Banaybanay", "San Isidro")
KNOWN_CITIES: tuple[str, ...] = ("Cabuyao",)

_KNOWN_BARANGAY_MATCHES: tuple[tuple[str, str], ...] = (
    ("Mamatid", "mamatid"),
    ("Pulo", "pulo"),
    ("Banaybanay", "banaybanay"),
    ("Banaybanay", "banay-banay"),
    ("Banaybanay", "banay banay"),
    ("San Isidro", "san isidro"),
)
_KNOWN_CITY_MATCHES: tuple[tuple[str, str], ...] = (
    ("Cabuyao", "cabuyao"),
    ("Cabuyao", "cabuyao city"),
    ("Cabuyao", "city of cabuyao"),
)

_BROAD_AIP_TERMS: tuple[str, ...] = (
    "project",
    "projects",
    "program",
    "programs",
    "budget",
    "budgets",
    "barangay",
    "city",
    "aip",
    "investment",
    "fiscal year",
    "fund",
    "recommend",
    "suggest",
    "available",
    "show",
    "list",
    "all",
)
_AIP_DOMAIN_CUES: tuple[str, ...] = (
    "aip",
    "openaip",
    "annual investment program",
    "investment program",
    "fiscal year",
    "budget",
    "budgets",
    "fund",
    "sector",
    "project",
    "projects",
    "program",
    "programs",
    "barangay",
    "city",
)
_BROAD_ACTION_CUES: tuple[str, ...] = (
    "what",
    "which",
    "show",
    "list",
    "recommend",
    "suggest",
    "available",
    "all",
)
_TOPIC_HINT_CUES: tuple[str, ...] = (
    "health",
    "infrastructure",
    "education",
    "livelihood",
    "governance",
)
_INCOMPLETE_FOLLOW_UP_RE = re.compile(
    r"^(?:how|what)\s+about\s+(?:that|it|this|those|these)\??$|^(?:and|about)\s+(?:that|it|this)\??$|^(?:that|it|this)\??$",
    re.IGNORECASE,
)
_YEAR_RE = re.compile(r"\b(20\d{2})\b")


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


def _contains_term_with_boundaries(text_lower: str, term: str) -> bool:
    return re.search(rf"\b{re.escape(term.lower())}\b", text_lower) is not None


def extract_known_barangay_from_text(text: str) -> str | None:
    lowered = normalize_text(text).lower()
    if not lowered:
        return None
    for canonical, matcher in _KNOWN_BARANGAY_MATCHES:
        if _contains_term_with_boundaries(lowered, matcher):
            return canonical
    return None


def extract_known_city_from_text(text: str) -> str | None:
    lowered = normalize_text(text).lower()
    if not lowered:
        return None
    for canonical, matcher in _KNOWN_CITY_MATCHES:
        if _contains_term_with_boundaries(lowered, matcher):
            return canonical
    return None


def looks_like_broad_aip_query(text: str) -> bool:
    normalized = normalize_text(text)
    lowered = normalized.lower()
    if not lowered:
        return False
    if _is_out_of_scope(lowered):
        return False

    has_broad_term = any(term in lowered for term in _BROAD_AIP_TERMS)
    if not has_broad_term:
        return False

    has_known_scope = (
        extract_known_barangay_from_text(normalized) is not None
        or extract_known_city_from_text(normalized) is not None
    )
    has_domain_anchor = any(term in lowered for term in _AIP_DOMAIN_CUES)
    has_action = any(term in lowered for term in _BROAD_ACTION_CUES)
    has_project_like_target = any(token in lowered for token in ("project", "projects", "program", "programs"))
    has_topic_hint = any(token in lowered for token in _TOPIC_HINT_CUES)

    if has_known_scope:
        return True
    if has_domain_anchor and (has_action or has_project_like_target):
        return True
    if has_project_like_target and has_action and has_topic_hint:
        return True
    return False


def is_incomplete_follow_up(text: str) -> bool:
    normalized = normalize_text(text)
    lowered = normalized.lower()
    if not lowered:
        return True
    if _is_out_of_scope(lowered):
        return False
    if extract_known_barangay_from_text(normalized) or extract_known_city_from_text(normalized):
        return False
    if _YEAR_RE.search(lowered):
        return False
    if looks_like_broad_aip_query(normalized):
        return False
    if any(token in lowered for token in ("aip", "budget", "project", "program", "sector", "fund", "fiscal year")):
        return False
    if _INCOMPLETE_FOLLOW_UP_RE.match(lowered):
        return True
    tokens = lowered.rstrip("?.!").split()
    if len(tokens) <= 4 and any(token in {"that", "it", "this", "those", "these"} for token in tokens):
        return True
    return False


def has_retrievable_aip_signal(message: str, *, entities: dict[str, Any] | None = None) -> bool:
    normalized = normalize_text(message)
    lowered = normalized.lower()
    if not lowered:
        return False
    if _is_out_of_scope(lowered):
        return False
    if extract_known_barangay_from_text(normalized) or extract_known_city_from_text(normalized):
        return True
    if looks_like_broad_aip_query(normalized):
        return True
    if entities:
        for key in ("barangay", "city", "fiscal_year", "topic", "project_type", "sector", "budget_term", "scope_name"):
            value = entities.get(key)
            if value is None:
                continue
            if isinstance(value, str):
                if value.strip():
                    return True
                continue
            return True
    if is_incomplete_follow_up(normalized):
        return False
    return any(term in lowered for term in _AIP_DOMAIN_CUES)


def _entities_from_known_scope(message: str) -> dict[str, Any]:
    entities = empty_entities()
    barangay = extract_known_barangay_from_text(message)
    city = extract_known_city_from_text(message)
    if barangay:
        entities["barangay"] = barangay
        entities["scope_type"] = "barangay"
        entities["scope_name"] = barangay
        return entities
    if city:
        entities["city"] = city
        entities["scope_type"] = "city"
        entities["scope_name"] = city
    return entities


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
        return IntentResult(
            intent="rag_query",
            confidence=0.78,
            needs_retrieval=True,
            friendly_response=None,
            entities=_entities_from_known_scope(normalized),
            route_hint=INTENT_ROUTE_HINTS.get("rag_query"),
            classifier_method="rule",
        )

    if _is_out_of_scope(lowered):
        return _result(
            intent="out_of_scope",
            confidence=0.95,
            needs_retrieval=False,
            friendly_response=AIP_ONLY_RESPONSE,
        )

    return None
