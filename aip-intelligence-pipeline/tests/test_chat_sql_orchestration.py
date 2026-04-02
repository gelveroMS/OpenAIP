from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

from openaip_pipeline.api.app import create_app
import openaip_pipeline.api.routes.chat as chat_route_module
from openaip_pipeline.services.intent.service import IntentClassificationError
from openaip_pipeline.services.intent.types import IntentResult, empty_entities


def _classification(
    intent: str = "rag_query",
    *,
    needs_retrieval: bool = True,
    entities: dict | None = None,
    route_hint: str | None = None,
) -> IntentResult:
    resolved_route_hint = route_hint if route_hint is not None else ("rag_query" if needs_retrieval else None)
    return IntentResult(
        intent=intent,
        confidence=0.9,
        needs_retrieval=needs_retrieval,
        friendly_response=None,
        entities=entities or empty_entities(),
        route_hint=resolved_route_hint,
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
    monkeypatch.setattr(
        chat_route_module,
        "check_year_availability_preflight",
        lambda **_kwargs: {
            "decision": "not_applicable",
            "reason": "requested_year_missing",
            "requested_fiscal_year": None,
            "available_fiscal_years": [],
            "year_availability_scope": None,
        },
    )


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
    monkeypatch.setattr(
        chat_route_module,
        "classify_message",
        lambda **_kwargs: _classification(
            intent="total_aggregation",
            needs_retrieval=True,
            route_hint="sql_totals",
        ),
    )

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


def test_fallback_to_rag_when_sql_returns_none_for_structured_intent(monkeypatch) -> None:
    _patch_base(monkeypatch)
    monkeypatch.setattr(
        chat_route_module,
        "classify_message",
        lambda **_kwargs: _classification(
            intent="total_aggregation",
            needs_retrieval=True,
            route_hint="sql_totals",
        ),
    )

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


def test_rag_query_skips_sql_and_calls_rag_directly(monkeypatch) -> None:
    _patch_base(monkeypatch)
    monkeypatch.setattr(
        chat_route_module,
        "classify_message",
        lambda **_kwargs: _classification(intent="rag_query", needs_retrieval=True, route_hint="rag_query"),
    )
    monkeypatch.setattr(
        chat_route_module,
        "maybe_answer_with_sql",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("SQL should not be called for rag_query.")),
    )
    monkeypatch.setattr(
        chat_route_module,
        "answer_with_rag",
        lambda **kwargs: {
            "question": kwargs.get("question"),
            "answer": "RAG direct answer.",
            "refused": False,
            "citations": [],
            "retrieval_meta": {"reason": "ok"},
            "context_count": 0,
        },
    )

    client = TestClient(create_app())
    response = _post_chat(client, "What does the AIP say about drainage projects?")

    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"] == "RAG direct answer."
    assert payload["retrieval_meta"]["status"] == "answer"


def test_entity_filters_and_retrieval_query_are_forwarded_to_rag(monkeypatch) -> None:
    _patch_base(monkeypatch)
    entities = empty_entities()
    entities.update(
        {
            "fiscal_year": 2025,
            "barangay": "Mamatid",
            "sector": "Health",
            "topic": "drainage",
            "project_type": "rehabilitation",
            "budget_term": "capital outlay",
        }
    )
    monkeypatch.setattr(
        chat_route_module,
        "classify_message",
        lambda **_kwargs: _classification(
            intent="rag_query",
            needs_retrieval=True,
            entities=entities,
            route_hint="rag_query",
        ),
    )
    monkeypatch.setattr(
        chat_route_module,
        "maybe_answer_with_sql",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("SQL should not be called for rag_query.")),
    )

    captured_kwargs: dict = {}

    def fake_rag(**kwargs):
        captured_kwargs.update(kwargs)
        return {
            "question": kwargs.get("question"),
            "answer": "RAG answer.",
            "refused": False,
            "citations": [],
            "retrieval_meta": {"reason": "ok"},
            "context_count": 0,
        }

    monkeypatch.setattr(chat_route_module, "answer_with_rag", fake_rag)

    client = TestClient(create_app())
    response = _post_chat(client, "What does the AIP say about drainage in Mamatid for FY 2025?")
    assert response.status_code == 200

    filters_payload = captured_kwargs["retrieval_filters"]
    assert filters_payload["fiscal_year"] == 2025
    assert filters_payload["scope_type"] == "barangay"
    assert filters_payload["scope_name"] == "Mamatid"
    assert "publication_status" not in filters_payload
    assert "health" in filters_payload.get("sector_tags", [])
    assert "drainage" in filters_payload.get("theme_tags", [])
    assert "rehabilitation" in filters_payload.get("theme_tags", [])
    assert "capital outlay" in filters_payload.get("theme_tags", [])
    assert "Structured hints:" in captured_kwargs["retrieval_query"]


def test_entity_filters_restrict_scope_type_to_city_or_barangay(monkeypatch) -> None:
    _patch_base(monkeypatch)
    entities = empty_entities()
    entities.update(
        {
            "scope_type": "municipality",
            "scope_name": "City Legal Office",
            "barangay": "Mamatid",
            "city": "Cabuyao",
        }
    )
    monkeypatch.setattr(
        chat_route_module,
        "classify_message",
        lambda **_kwargs: _classification(
            intent="rag_query",
            needs_retrieval=True,
            entities=entities,
            route_hint="rag_query",
        ),
    )
    monkeypatch.setattr(
        chat_route_module,
        "maybe_answer_with_sql",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("SQL should not be called for rag_query.")),
    )

    captured_kwargs: dict = {}

    def fake_rag(**kwargs):
        captured_kwargs.update(kwargs)
        return {
            "question": kwargs.get("question"),
            "answer": "RAG answer.",
            "refused": False,
            "citations": [],
            "retrieval_meta": {"reason": "ok"},
            "context_count": 0,
        }

    monkeypatch.setattr(chat_route_module, "answer_with_rag", fake_rag)

    client = TestClient(create_app())
    response = client.post(
        "/v1/chat/answer",
        json={
            "question": "What projects are in Barangay Mamatid?",
            "retrieval_scope": {"mode": "global", "targets": []},
            "retrieval_filters": {"scope_type": "municipality", "scope_name": "Foo"},
        },
    )
    assert response.status_code == 200

    filters_payload = captured_kwargs["retrieval_filters"]
    assert filters_payload["scope_type"] == "barangay"
    assert filters_payload["scope_name"] == "Mamatid"


def test_entity_filters_normalize_city_scope_name_to_city_suffix(monkeypatch) -> None:
    _patch_base(monkeypatch)
    entities = empty_entities()
    entities.update(
        {
            "scope_type": "city",
            "scope_name": "Cabuyao",
            "city": "Cabuyao",
        }
    )
    monkeypatch.setattr(
        chat_route_module,
        "classify_message",
        lambda **_kwargs: _classification(
            intent="rag_query",
            needs_retrieval=True,
            entities=entities,
            route_hint="rag_query",
        ),
    )
    monkeypatch.setattr(
        chat_route_module,
        "maybe_answer_with_sql",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("SQL should not be called for rag_query.")),
    )

    captured_kwargs: dict = {}

    def fake_rag(**kwargs):
        captured_kwargs.update(kwargs)
        return {
            "question": kwargs.get("question"),
            "answer": "RAG answer.",
            "refused": False,
            "citations": [],
            "retrieval_meta": {"reason": "ok"},
            "context_count": 0,
        }

    monkeypatch.setattr(chat_route_module, "answer_with_rag", fake_rag)

    client = TestClient(create_app())
    response = client.post(
        "/v1/chat/answer",
        json={
            "question": "What projects are in Cabuyao for FY 2022?",
            "retrieval_scope": {"mode": "global", "targets": []},
        },
    )
    assert response.status_code == 200

    filters_payload = captured_kwargs["retrieval_filters"]
    assert filters_payload["scope_type"] == "city"
    assert filters_payload["scope_name"] == "Cabuyao City"


def test_payload_city_scope_name_is_normalized(monkeypatch) -> None:
    _patch_base(monkeypatch)
    monkeypatch.setattr(
        chat_route_module,
        "classify_message",
        lambda **_kwargs: _classification(intent="rag_query", needs_retrieval=True, route_hint="rag_query"),
    )
    monkeypatch.setattr(
        chat_route_module,
        "maybe_answer_with_sql",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("SQL should not be called for rag_query.")),
    )

    captured_kwargs: dict = {}

    def fake_rag(**kwargs):
        captured_kwargs.update(kwargs)
        return {
            "question": kwargs.get("question"),
            "answer": "RAG answer.",
            "refused": False,
            "citations": [],
            "retrieval_meta": {"reason": "ok"},
            "context_count": 0,
        }

    monkeypatch.setattr(chat_route_module, "answer_with_rag", fake_rag)

    client = TestClient(create_app())
    response = client.post(
        "/v1/chat/answer",
        json={
            "question": "What projects are in Cabuyao for FY 2022?",
            "retrieval_scope": {"mode": "global", "targets": []},
            "retrieval_filters": {"scope_type": "city", "scope_name": "Cabuyao"},
        },
    )
    assert response.status_code == 200

    filters_payload = captured_kwargs["retrieval_filters"]
    assert filters_payload["scope_type"] == "city"
    assert filters_payload["scope_name"] == "Cabuyao City"


def test_chat_defaults_forward_reference_aligned_top_k_and_similarity(monkeypatch) -> None:
    _patch_base(monkeypatch)
    monkeypatch.setattr(
        chat_route_module,
        "classify_message",
        lambda **_kwargs: _classification(intent="rag_query", needs_retrieval=True, route_hint="rag_query"),
    )
    monkeypatch.setattr(
        chat_route_module,
        "maybe_answer_with_sql",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("SQL should not be called for rag_query.")),
    )

    captured_kwargs: dict = {}

    def fake_rag(**kwargs):
        captured_kwargs.update(kwargs)
        return {
            "question": kwargs.get("question"),
            "answer": "RAG answer.",
            "refused": False,
            "citations": [],
            "retrieval_meta": {"reason": "ok"},
            "context_count": 0,
        }

    monkeypatch.setattr(chat_route_module, "answer_with_rag", fake_rag)

    client = TestClient(create_app())
    response = _post_chat(client, "What does the AIP say about projects?")
    assert response.status_code == 200
    assert captured_kwargs["top_k"] == 5
    assert captured_kwargs["min_similarity"] == 0.10


def test_chat_uses_pipeline_model_for_generation_without_intent_override(monkeypatch) -> None:
    _patch_base(monkeypatch)
    captured_classify_kwargs: dict = {}
    captured_rag_kwargs: dict = {}

    def _fake_classify_message(**kwargs):
        captured_classify_kwargs.update(kwargs)
        return _classification(intent="rag_query", needs_retrieval=True, route_hint="rag_query")

    def _fake_rag(**kwargs):
        captured_rag_kwargs.update(kwargs)
        return {
            "question": kwargs.get("question"),
            "answer": "RAG answer.",
            "refused": False,
            "citations": [],
            "retrieval_meta": {"reason": "ok"},
            "context_count": 0,
        }

    monkeypatch.setattr(chat_route_module, "classify_message", _fake_classify_message)
    monkeypatch.setattr(
        chat_route_module,
        "maybe_answer_with_sql",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("SQL should not be called for rag_query.")),
    )
    monkeypatch.setattr(chat_route_module, "answer_with_rag", _fake_rag)

    client = TestClient(create_app())
    response = _post_chat(client, "What does the AIP say about projects?")

    assert response.status_code == 200
    assert captured_classify_kwargs["default_model"] == ""
    assert captured_rag_kwargs["chat_model"] == "gpt-5.2"


def test_chat_model_override_is_passed_to_intent_and_generation(monkeypatch) -> None:
    _patch_base(monkeypatch)
    captured_classify_kwargs: dict = {}
    captured_rag_kwargs: dict = {}

    def _fake_classify_message(**kwargs):
        captured_classify_kwargs.update(kwargs)
        return _classification(intent="rag_query", needs_retrieval=True, route_hint="rag_query")

    def _fake_rag(**kwargs):
        captured_rag_kwargs.update(kwargs)
        return {
            "question": kwargs.get("question"),
            "answer": "RAG answer.",
            "refused": False,
            "citations": [],
            "retrieval_meta": {"reason": "ok"},
            "context_count": 0,
        }

    monkeypatch.setattr(chat_route_module, "classify_message", _fake_classify_message)
    monkeypatch.setattr(
        chat_route_module,
        "maybe_answer_with_sql",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("SQL should not be called for rag_query.")),
    )
    monkeypatch.setattr(chat_route_module, "answer_with_rag", _fake_rag)

    client = TestClient(create_app())
    response = client.post(
        "/v1/chat/answer",
        json={
            "question": "What does the AIP say about projects?",
            "model_name": "gpt-5.2-mini",
            "retrieval_scope": {"mode": "global", "targets": []},
        },
    )

    assert response.status_code == 200
    assert captured_classify_kwargs["default_model"] == "gpt-5.2-mini"
    assert captured_rag_kwargs["chat_model"] == "gpt-5.2-mini"


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


def test_year_unavailable_short_circuits_before_sql_and_rag(monkeypatch) -> None:
    _patch_base(monkeypatch)
    monkeypatch.setattr(
        chat_route_module,
        "classify_message",
        lambda **_kwargs: _classification(
            intent="total_aggregation",
            needs_retrieval=True,
            route_hint="sql_totals",
        ),
    )
    monkeypatch.setattr(
        chat_route_module,
        "check_year_availability_preflight",
        lambda **_kwargs: {
            "decision": "year_unavailable",
            "reason": "requested_year_unavailable",
            "requested_fiscal_year": 2026,
            "available_fiscal_years": [2024, 2025],
            "year_availability_scope": {"scope_type": "barangay", "scope_name": "Barangay Pulo"},
        },
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
    response = client.post(
        "/v1/chat/answer",
        json={
            "question": "Which projects in Barangay Pulo FY 2026 focus on health?",
            "retrieval_scope": {"mode": "global", "targets": []},
            "retrieval_filters": {"fiscal_year": 2026, "scope_type": "barangay", "scope_name": "Pulo"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["refused"] is False
    assert payload["retrieval_meta"]["status"] == "clarification"
    assert payload["retrieval_meta"]["reason"] == "clarification_needed"
    assert payload["retrieval_meta"]["route_family"] == "year_availability"
    assert payload["retrieval_meta"]["clarification_type"] == "year_unavailable"
    assert payload["retrieval_meta"]["requested_fiscal_year"] == 2026
    assert payload["retrieval_meta"]["available_fiscal_years"] == [2024, 2025]
    assert payload["retrieval_meta"]["year_availability_scope"] == {
        "scope_type": "barangay",
        "scope_name": "Barangay Pulo",
    }
    assert "No published records were found for FY 2026 in Barangay Pulo." in payload["answer"]
    assert "Available fiscal years: FY 2024, FY 2025." in payload["answer"]


def test_year_available_preflight_keeps_rag_execution(monkeypatch) -> None:
    _patch_base(monkeypatch)
    monkeypatch.setattr(
        chat_route_module,
        "classify_message",
        lambda **_kwargs: _classification(intent="rag_query", needs_retrieval=True, route_hint="rag_query"),
    )
    monkeypatch.setattr(
        chat_route_module,
        "check_year_availability_preflight",
        lambda **_kwargs: {
            "decision": "year_available",
            "reason": "requested_year_available",
            "requested_fiscal_year": 2026,
            "available_fiscal_years": [2025, 2026],
            "year_availability_scope": {"scope_type": "barangay", "scope_name": "Barangay Pulo"},
        },
    )
    monkeypatch.setattr(
        chat_route_module,
        "maybe_answer_with_sql",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("SQL should not be called for rag_query.")),
    )
    monkeypatch.setattr(
        chat_route_module,
        "answer_with_rag",
        lambda **kwargs: {
            "question": kwargs.get("question"),
            "answer": "RAG answer after year-available preflight.",
            "refused": False,
            "citations": [],
            "retrieval_meta": {"reason": "ok"},
            "context_count": 0,
        },
    )

    client = TestClient(create_app())
    response = client.post(
        "/v1/chat/answer",
        json={
            "question": "Which projects in Barangay Pulo FY 2026 focus on health?",
            "retrieval_scope": {"mode": "global", "targets": []},
            "retrieval_filters": {"fiscal_year": 2026, "scope_type": "barangay", "scope_name": "Pulo"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"] == "RAG answer after year-available preflight."
    assert payload["retrieval_meta"]["status"] == "answer"


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
