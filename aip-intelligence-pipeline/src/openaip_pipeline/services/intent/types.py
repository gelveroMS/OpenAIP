from __future__ import annotations

from dataclasses import dataclass
from typing import Any

VALID_INTENTS: set[str] = {
    "greeting",
    "farewell",
    "thanks",
    "help",
    "small_talk",
    "out_of_scope",
    "clarification",
    "total_aggregation",
    "category_aggregation",
    "line_item_lookup",
    "metadata_query",
    "compare_years",
    "rag_query",
}

CONVERSATIONAL_INTENTS: set[str] = {"greeting", "farewell", "thanks", "help", "small_talk"}
NON_RETRIEVAL_INTENTS: set[str] = CONVERSATIONAL_INTENTS | {"out_of_scope", "clarification"}

AIP_ONLY_RESPONSE = (
    "I can only assist with AIP-related questions. Please ask about OpenAIP data such as "
    "projects, programs, budgets, barangays, cities, or fiscal years."
)

DEFAULT_CLARIFICATION_RESPONSE = (
    "Please share fiscal year, sector, project category/type, barangay, or city for narrower results. "
    "I can also show broad project options or related projects from published AIP records."
)

DEFAULT_FRIENDLY_RESPONSES: dict[str, str] = {
    "greeting": (
        "Hello. I'm OpenAIP's assistant. I can help with AIP projects, budgets, programs, "
        "barangays, cities, and fiscal years."
    ),
    "farewell": "Goodbye. Feel free to ask again anytime you need help with OpenAIP data.",
    "thanks": "You're welcome. Ask another OpenAIP question anytime.",
    "help": "Ask me about AIP projects, budgets, sectors, line items, barangays, cities, or fiscal years.",
    "small_talk": "I'm ready to help with OpenAIP-related questions.",
}

INTENT_ROUTE_HINTS: dict[str, str | None] = {
    "metadata_query": "metadata_sql",
    "compare_years": "aggregate_sql",
    "total_aggregation": "sql_totals",
    "category_aggregation": "aggregate_sql",
    "line_item_lookup": "row_sql",
    "rag_query": "rag_query",
    "greeting": None,
    "farewell": None,
    "thanks": None,
    "help": None,
    "small_talk": None,
    "out_of_scope": None,
    "clarification": None,
}

INTENT_ENTITY_KEYS: tuple[str, ...] = (
    "barangay",
    "city",
    "fiscal_year",
    "topic",
    "project_type",
    "sector",
    "budget_term",
    "scope_name",
    "scope_type",
)


def empty_entities() -> dict[str, Any]:
    return {key: None for key in INTENT_ENTITY_KEYS}


@dataclass(slots=True)
class IntentResult:
    intent: str
    confidence: float
    needs_retrieval: bool
    friendly_response: str | None
    entities: dict[str, Any]
    route_hint: str | None
    classifier_method: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent": self.intent,
            "confidence": self.confidence,
            "needs_retrieval": self.needs_retrieval,
            "friendly_response": self.friendly_response,
            "entities": dict(self.entities),
            "route_hint": self.route_hint,
            "classifier_method": self.classifier_method,
        }

