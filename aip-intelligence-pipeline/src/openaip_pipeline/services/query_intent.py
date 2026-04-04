from __future__ import annotations

import re
from typing import TypedDict

_TOP_RE = re.compile(r"\btop\s+\d{1,2}\b", re.IGNORECASE)

_LIST_VERB_CUES = (
    "list",
    "show",
    "display",
    "enumerate",
    "which",
    "what are",
    "give",
    "provide",
    "return",
)

_LIST_TARGET_CUES = (
    "project",
    "projects",
    "program",
    "programs",
    "line item",
    "line items",
    "records",
    "entries",
)

_EXCLUDED_NON_LIST_CUES = (
    "compare",
    "comparison",
    "difference",
    " vs ",
    " versus ",
    "largest",
    "highest",
    "most funded",
    "total investment program",
    "total investment",
    "grand total",
    "total budget",
    "overall budget",
    "totals by fund source",
    "fund source totals",
    "fund source breakdown",
    "totals by sector",
    "sector totals",
    "sector breakdown",
    "by fund source",
    "by sector",
)

_EXHAUSTIVE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("all", re.compile(r"\ball\b", re.IGNORECASE)),
    ("every", re.compile(r"\bevery\b", re.IGNORECASE)),
    ("entire", re.compile(r"\b(?:entire|entier)\b", re.IGNORECASE)),
    ("full", re.compile(r"\bfull\b", re.IGNORECASE)),
    ("complete", re.compile(r"\b(?:complete|compleet)\b", re.IGNORECASE)),
    ("whole", re.compile(r"\bwhole\b", re.IGNORECASE)),
    ("everything", re.compile(r"\beverything\b", re.IGNORECASE)),
    ("al", re.compile(r"\bal\s+(?:projects?|programs?|items?|entries?|records?)\b", re.IGNORECASE)),
    ("evry", re.compile(r"\bevry\b", re.IGNORECASE)),
]


class ExhaustiveIntentDetection(TypedDict):
    is_list_query: bool
    exhaustive_intent: bool
    exhaustive_signal: str | None


def _norm(text: str) -> str:
    return " ".join((text or "").lower().split())


def _is_list_query(normalized: str) -> bool:
    has_list_verb = any(token in normalized for token in _LIST_VERB_CUES)
    has_list_target = any(token in normalized for token in _LIST_TARGET_CUES)
    return has_list_target and (
        has_list_verb or "what " in normalized or "which " in normalized or " where " in f" {normalized} "
    )


def _is_excluded_non_list_query(normalized: str) -> bool:
    if _TOP_RE.search(normalized):
        return True
    return any(token in normalized for token in _EXCLUDED_NON_LIST_CUES)


def _find_exhaustive_signal(question: str) -> str | None:
    for signal, pattern in _EXHAUSTIVE_PATTERNS:
        if pattern.search(question):
            return signal
    return None


def detect_exhaustive_intent(question: str) -> ExhaustiveIntentDetection:
    normalized = _norm(question)
    is_list_query = _is_list_query(normalized)
    if not is_list_query:
        return {
            "is_list_query": False,
            "exhaustive_intent": False,
            "exhaustive_signal": None,
        }

    if _is_excluded_non_list_query(normalized):
        return {
            "is_list_query": True,
            "exhaustive_intent": False,
            "exhaustive_signal": None,
        }

    signal = _find_exhaustive_signal(question)
    return {
        "is_list_query": True,
        "exhaustive_intent": signal is not None,
        "exhaustive_signal": signal,
    }
