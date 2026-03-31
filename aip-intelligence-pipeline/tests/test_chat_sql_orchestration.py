from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

from openaip_pipeline.api.app import create_app
import openaip_pipeline.api.routes.chat as chat_route_module
from openaip_pipeline.services.intent.service import IntentClassificationError
from openaip_pipeline.services.intent.types import IntentResult, empty_entities


def _classification(intent: str = "rag_query", *, needs_retrieval: bool = True) -> IntentResult:
    return IntentResult(
        intent=intent,
        confidence=0.9,
        needs_retrieval=needs_retrieval,
        friendly_response=None,
        entities=empty_entities(),
        route_hint="rag_query" if needs_retrieval else None,
        classifier_method="rule",
    )


def _patch_base(monkeypatch) -> None:
    def fake_require_internal_token(_request):
        return None

    monkeypatch.setattr(chat_route_module, "_require_internal_token", fake_require_internal_token)
    monkeypatch.setattr(
        chat_route_module.Settings,
        "load",
        lambda **_kwargs: SimpleNamespace(
            pipeline_model="gpt-5.2",
            embedding_model="text-embedding-3-large",
            supabase_url="https://example.test",
            supabase_service_key="service-key",
            openai_api_key="openai-key",
        ),
    )
    monkeypatch.setattr(chat_route_module, "classify_message", lambda **_kwargs: _classification())


def _post_chat(client: TestClient, question: str):
    return client.post(
        "/v1/chat/answer",
        json={
            "question": question,
            "retrieval_scope": {"mode": "global", "targets": []},
        },
    )


def test_sql_result_short_circuits_rag(monkeypatch) -> None:
    _patch_base(monkeypatch)

    def fake_sql(**_kwargs):
        return {
            "question": "What is the total?",
            "answer": "Total investment program: PHP 1,000.00.",
            "refused": False,
            "citations": [{"source_id": "S0", "snippet": "structured"}],
            "retrieval_meta": {"reason": "ok", "status": "answer", "route_family": "sql_totals"},
            "context_count": 1,
        }

    def fake_rag(**_kwargs):
        raise AssertionError("RAG should not be called when SQL answered.")

    monkeypatch.setattr(chat_route_module, "maybe_answer_with_sql", fake_sql)
    monkeypatch.setattr(chat_route_module, "answer_with_rag", fake_rag)

    client = TestClient(create_app())
    response = _post_chat(client, "What is the total investment program?")

    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"] == "Total investment program: PHP 1,000.00."
    assert payload["retrieval_meta"]["status"] == "answer"
    assert payload["retrieval_meta"]["route_family"] == "sql_totals"


def test_fallback_to_rag_when_sql_returns_none(monkeypatch) -> None:
    _patch_base(monkeypatch)

    def fake_sql(**_kwargs):
        return None

    def fake_rag(**kwargs):
        return {
            "question": kwargs.get("question"),
            "answer": "RAG fallback answer.",
            "refused": False,
            "citations": [],
            "retrieval_meta": {"reason": "ok"},
            "context_count": 0,
        }

    monkeypatch.setattr(chat_route_module, "maybe_answer_with_sql", fake_sql)
    monkeypatch.setattr(chat_route_module, "answer_with_rag", fake_rag)

    client = TestClient(create_app())
    response = _post_chat(client, "Explain this narrative question.")

    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"] == "RAG fallback answer."
    assert payload["retrieval_meta"]["status"] == "answer"


def test_rag_refusal_status_is_normalized(monkeypatch) -> None:
    _patch_base(monkeypatch)

    monkeypatch.setattr(chat_route_module, "maybe_answer_with_sql", lambda **_kwargs: None)
    monkeypatch.setattr(
        chat_route_module,
        "answer_with_rag",
        lambda **kwargs: {
            "question": kwargs.get("question"),
            "answer": "I can't provide a grounded answer.",
            "refused": True,
            "citations": [],
            "retrieval_meta": {"reason": "insufficient_evidence"},
            "context_count": 0,
        },
    )

    client = TestClient(create_app())
    response = _post_chat(client, "Unknown question.")

    assert response.status_code == 200
    payload = response.json()
    assert payload["refused"] is True
    assert payload["retrieval_meta"]["status"] == "refusal"


def test_rag_clarification_status_is_normalized(monkeypatch) -> None:
    _patch_base(monkeypatch)

    monkeypatch.setattr(chat_route_module, "maybe_answer_with_sql", lambda **_kwargs: None)
    monkeypatch.setattr(
        chat_route_module,
        "answer_with_rag",
        lambda **kwargs: {
            "question": kwargs.get("question"),
            "answer": "Please clarify your scope.",
            "refused": False,
            "citations": [],
            "retrieval_meta": {"reason": "clarification_needed"},
            "context_count": 0,
        },
    )

    client = TestClient(create_app())
    response = _post_chat(client, "Compare budget.")

    assert response.status_code == 200
    payload = response.json()
    assert payload["refused"] is False
    assert payload["retrieval_meta"]["status"] == "clarification"


def test_conversational_intent_short_circuits_without_sql_or_rag(monkeypatch) -> None:
    _patch_base(monkeypatch)
    monkeypatch.setattr(
        chat_route_module,
        "classify_message",
        lambda **_kwargs: IntentResult(
            intent="greeting",
            confidence=1.0,
            needs_retrieval=False,
            friendly_response="Hello from classifier.",
            entities=empty_entities(),
            route_hint=None,
            classifier_method="rule",
        ),
    )
    monkeypatch.setattr(
        chat_route_module,
        "maybe_answer_with_sql",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("SQL should not be called.")),
    )
    monkeypatch.setattr(
        chat_route_module,
        "answer_with_rag",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("RAG should not be called.")),
    )

    client = TestClient(create_app())
    response = _post_chat(client, "hello")

    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"] == "Hello from classifier."
    assert payload["retrieval_meta"]["reason"] == "conversational_shortcut"
    assert payload["retrieval_meta"]["status"] == "answer"
    assert payload["retrieval_meta"]["route_family"] == "conversational"
    assert payload["retrieval_meta"]["intent"] == "greeting"


def test_out_of_scope_short_circuit_returns_strict_refusal(monkeypatch) -> None:
    _patch_base(monkeypatch)
    monkeypatch.setattr(
        chat_route_module,
        "classify_message",
        lambda **_kwargs: IntentResult(
            intent="out_of_scope",
            confidence=0.99,
            needs_retrieval=False,
            friendly_response="AIP-only response.",
            entities=empty_entities(),
            route_hint=None,
            classifier_method="rule",
        ),
    )
    monkeypatch.setattr(
        chat_route_module,
        "maybe_answer_with_sql",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("SQL should not be called.")),
    )
    monkeypatch.setattr(
        chat_route_module,
        "answer_with_rag",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("RAG should not be called.")),
    )

    client = TestClient(create_app())
    response = _post_chat(client, "who is the mayor")

    assert response.status_code == 200
    payload = response.json()
    assert payload["refused"] is True
    assert payload["answer"] == "AIP-only response."
    assert payload["retrieval_meta"]["status"] == "refusal"
    assert payload["retrieval_meta"]["reason"] == "conversational_shortcut"
    assert payload["retrieval_meta"]["refusal_reason"] == "unsupported_request"
    assert payload["retrieval_meta"]["route_family"] == "conversational"


def test_classifier_failure_is_fail_closed(monkeypatch) -> None:
    _patch_base(monkeypatch)

    def _raise_classifier(**_kwargs):
        raise IntentClassificationError("classifier unavailable")

    monkeypatch.setattr(chat_route_module, "classify_message", _raise_classifier)
    monkeypatch.setattr(
        chat_route_module,
        "maybe_answer_with_sql",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("SQL should not be called.")),
    )
    monkeypatch.setattr(
        chat_route_module,
        "answer_with_rag",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("RAG should not be called.")),
    )

    client = TestClient(create_app())
    response = _post_chat(client, "any question")

    assert response.status_code == 200
    payload = response.json()
    assert payload["refused"] is True
    assert payload["retrieval_meta"]["status"] == "refusal"
    assert payload["retrieval_meta"]["reason"] == "pipeline_error"
    assert payload["retrieval_meta"]["intent"] == "classification_error"
