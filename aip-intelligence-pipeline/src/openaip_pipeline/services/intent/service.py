from __future__ import annotations

import os

from openaip_pipeline.services.intent.classifier import classify_with_llm
from openaip_pipeline.services.intent.rules import classify_with_rules
from openaip_pipeline.services.intent.types import IntentResult


class IntentClassificationError(RuntimeError):
    """Raised when intent classification cannot produce a valid result."""


def resolve_intent_model(default_model: str) -> str:
    override = os.getenv("PIPELINE_INTENT_MODEL", "").strip()
    if override:
        return override
    fallback = (default_model or "").strip()
    return fallback if fallback else "gpt-5.2"


def classify_message(*, message: str, openai_api_key: str | None, default_model: str) -> IntentResult:
    rules_result = classify_with_rules(message)
    if rules_result is not None:
        return rules_result

    key = (openai_api_key or "").strip()
    if not key:
        raise IntentClassificationError(
            "OPENAI_API_KEY is required for LLM fallback classification and was not configured."
        )

    try:
        return classify_with_llm(
            message=message,
            openai_api_key=key,
            model_name=resolve_intent_model(default_model),
        )
    except Exception as error:
        raise IntentClassificationError("LLM fallback classification failed.") from error

