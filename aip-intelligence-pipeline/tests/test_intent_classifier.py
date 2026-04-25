from __future__ import annotations

from types import SimpleNamespace

import pytest

from openaip_pipeline.services.intent.classifier import classify_with_llm
from openaip_pipeline.services.intent.service import IntentClassificationError, classify_message, resolve_intent_model
from openaip_pipeline.services.intent.types import (
    DEFAULT_CLARIFICATION_RESPONSE,
    IntentResult,
    empty_entities,
)


def test_classify_message_rules_detects_greeting_without_llm() -> None:
    result = classify_message(
        message="Hello there",
        openai_api_key=None,
        default_model="gpt-5.2",
    )

    assert result.intent == "greeting"
    assert result.needs_retrieval is False
    assert result.classifier_method == "rule"


def test_resolve_intent_model_prefers_request_override(monkeypatch) -> None:
    monkeypatch.setenv("PIPELINE_INTENT_MODEL", "gpt-5.2")

    resolved = resolve_intent_model("gpt-5.2-mini")

    assert resolved == "gpt-5.2-mini"


def test_resolve_intent_model_uses_env_when_request_override_missing(monkeypatch) -> None:
    monkeypatch.setenv("PIPELINE_INTENT_MODEL", "gpt-5.2")

    resolved = resolve_intent_model("")

    assert resolved == "gpt-5.2"


def test_resolve_intent_model_defaults_to_gpt_5_2_mini(monkeypatch) -> None:
    monkeypatch.delenv("PIPELINE_INTENT_MODEL", raising=False)

    resolved = resolve_intent_model("")

    assert resolved == "gpt-5.2-mini"


def test_classify_message_rules_detects_total_aggregation() -> None:
    result = classify_message(
        message="What is the total investment program for FY 2025?",
        openai_api_key=None,
        default_model="gpt-5.2",
    )

    assert result.intent == "total_aggregation"
    assert result.needs_retrieval is True
    assert result.route_hint == "sql_totals"


def test_classify_message_rules_detects_filtered_project_list_aggregation() -> None:
    result = classify_message(
        message="Show all projects where fund source is GAD fund.",
        openai_api_key=None,
        default_model="gpt-5.2",
    )

    assert result.intent == "category_aggregation"
    assert result.needs_retrieval is True
    assert result.route_hint == "aggregate_sql"


def test_classify_message_rules_detects_out_of_scope() -> None:
    result = classify_message(
        message="What's the weather tomorrow?",
        openai_api_key=None,
        default_model="gpt-5.2",
    )

    assert result.intent == "out_of_scope"
    assert result.needs_retrieval is False


def test_classify_message_requires_api_key_for_llm_fallback() -> None:
    with pytest.raises(IntentClassificationError):
        classify_message(
            message="What projects are available in Barangay Mamatid?",
            openai_api_key=None,
            default_model="gpt-5.2",
        )


def test_classify_message_wraps_llm_failure(monkeypatch) -> None:
    def fake_llm(**_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("openaip_pipeline.services.intent.service.classify_with_llm", fake_llm)
    with pytest.raises(IntentClassificationError):
        classify_message(
            message="Tell me something unexpected",
            openai_api_key="test-key",
            default_model="gpt-5.2",
        )


def test_classify_message_retries_with_gpt_5_2_when_model_not_found(monkeypatch) -> None:
    calls: list[str] = []
    llm_result = IntentResult(
        intent="rag_query",
        confidence=0.77,
        needs_retrieval=True,
        friendly_response=None,
        entities=empty_entities(),
        route_hint="rag_query",
        classifier_method="llm",
    )

    def fake_llm(**kwargs):
        model_name = str(kwargs.get("model_name") or "")
        calls.append(model_name)
        if model_name == "gpt-5.2-mini":
            raise RuntimeError("Error code: 404 - {'error': {'code': 'model_not_found'}}")
        return llm_result

    monkeypatch.setattr("openaip_pipeline.services.intent.service.classify_with_llm", fake_llm)

    result = classify_message(
        message="Tell me something unexpected",
        openai_api_key="test-key",
        default_model="gpt-5.2-mini",
    )

    assert result.intent == "rag_query"
    assert calls == ["gpt-5.2-mini", "gpt-5.2"]


def test_classify_with_llm_normalizes_payload(monkeypatch) -> None:
    class _FakeCompletions:
        @staticmethod
        def create(**_kwargs):
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=(
                                '{"intent":"TOTAL_AGGREGATION","confidence":"0.86","needs_retrieval":true,'
                                '"friendly_response":null,"route_hint":"sql_totals","entities":{"fiscal_year":"2025"}}'
                            )
                        )
                    )
                ]
            )

    class _FakeChat:
        completions = _FakeCompletions()

    class _FakeClient:
        chat = _FakeChat()

    monkeypatch.setattr(
        "openaip_pipeline.services.intent.classifier.build_openai_client",
        lambda _key: _FakeClient(),
    )

    result = classify_with_llm(
        message="Total budget for FY 2025",
        openai_api_key="test-key",
        model_name="gpt-5.2",
    )

    assert result.intent == "total_aggregation"
    assert result.needs_retrieval is True
    assert result.classifier_method == "llm"
    assert result.entities["fiscal_year"] == 2025


def test_classify_with_llm_scope_only_city_or_barangay(monkeypatch) -> None:
    class _FakeCompletions:
        @staticmethod
        def create(**_kwargs):
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=(
                                '{"intent":"RAG_QUERY","confidence":"0.83","needs_retrieval":true,'
                                '"friendly_response":null,"route_hint":"rag_query","entities":{'
                                '"barangay":"Mamatid","city":"Cabuyao","fiscal_year":"2022",'
                                '"scope_name":"City Legal Office","scope_type":"municipality"}}'
                            )
                        )
                    )
                ]
            )

    class _FakeChat:
        completions = _FakeCompletions()

    class _FakeClient:
        chat = _FakeChat()

    monkeypatch.setattr(
        "openaip_pipeline.services.intent.classifier.build_openai_client",
        lambda _key: _FakeClient(),
    )

    result = classify_with_llm(
        message="What projects in Barangay Mamatid FY 2022?",
        openai_api_key="test-key",
        model_name="gpt-5-mini",
    )

    assert result.entities["scope_type"] == "barangay"
    assert result.entities["scope_name"] == "Mamatid"


def test_classify_message_uses_llm_when_rules_do_not_match(monkeypatch) -> None:
    llm_result = IntentResult(
        intent="rag_query",
        confidence=0.66,
        needs_retrieval=True,
        friendly_response=None,
        entities=empty_entities(),
        route_hint="rag_query",
        classifier_method="llm",
    )
    monkeypatch.setattr(
        "openaip_pipeline.services.intent.service.classify_with_llm",
        lambda **_kwargs: llm_result,
    )

    result = classify_message(
        message="Tell me something unexpected",
        openai_api_key="test-key",
        default_model="gpt-5.2",
    )

    assert result.intent == "rag_query"
    assert result.classifier_method == "llm"


def test_classify_message_low_confidence_rag_without_entities_downgrades_to_clarification(monkeypatch) -> None:
    llm_result = IntentResult(
        intent="rag_query",
        confidence=0.41,
        needs_retrieval=True,
        friendly_response=None,
        entities=empty_entities(),
        route_hint="rag_query",
        classifier_method="llm",
    )
    monkeypatch.setattr(
        "openaip_pipeline.services.intent.service.classify_with_llm",
        lambda **_kwargs: llm_result,
    )

    result = classify_message(
        message="Show me something about the AIP",
        openai_api_key="test-key",
        default_model="gpt-5.2",
    )

    assert result.intent == "clarification"
    assert result.needs_retrieval is False
    assert result.friendly_response == DEFAULT_CLARIFICATION_RESPONSE
