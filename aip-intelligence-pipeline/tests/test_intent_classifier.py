from __future__ import annotations

from types import SimpleNamespace

import pytest

from openaip_pipeline.services.intent.classifier import classify_with_llm
from openaip_pipeline.services.intent.service import IntentClassificationError, classify_message
from openaip_pipeline.services.intent.types import IntentResult, empty_entities


def test_classify_message_rules_detects_greeting_without_llm() -> None:
    result = classify_message(
        message="Hello there",
        openai_api_key=None,
        default_model="gpt-5.2",
    )

    assert result.intent == "greeting"
    assert result.needs_retrieval is False
    assert result.classifier_method == "rule"


def test_classify_message_rules_detects_total_aggregation() -> None:
    result = classify_message(
        message="What is the total investment program for FY 2025?",
        openai_api_key=None,
        default_model="gpt-5.2",
    )

    assert result.intent == "total_aggregation"
    assert result.needs_retrieval is True
    assert result.route_hint == "sql_totals"


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
            message="Tell me something unexpected",
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
