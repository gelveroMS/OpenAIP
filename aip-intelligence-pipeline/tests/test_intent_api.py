from __future__ import annotations

import time
from types import SimpleNamespace

from fastapi.testclient import TestClient

from openaip_pipeline.api.app import create_app
import openaip_pipeline.api.routes.chat_auth as chat_auth_module
import openaip_pipeline.api.routes.intent as intent_route_module
from openaip_pipeline.services.intent.service import IntentClassificationError
from openaip_pipeline.services.intent.types import IntentResult, empty_entities


def test_intent_classify_requires_auth_headers(monkeypatch) -> None:
    monkeypatch.setenv("PIPELINE_HMAC_SECRET", "test-secret")
    client = TestClient(create_app())

    response = client.post("/v1/intent/classify", json={"message": "hello"})
    assert response.status_code == 401


def test_intent_classify_rejects_invalid_signature(monkeypatch) -> None:
    monkeypatch.setenv("PIPELINE_HMAC_SECRET", "test-secret")
    client = TestClient(create_app())

    response = client.post(
        "/v1/intent/classify",
        json={"message": "hello"},
        headers={
            "x-pipeline-aud": "website-backend",
            "x-pipeline-ts": str(int(time.time())),
            "x-pipeline-nonce": "nonce-1",
            "x-pipeline-sig": "invalid",
        },
    )
    assert response.status_code == 401


def test_intent_classify_returns_schema(monkeypatch) -> None:
    monkeypatch.setattr(chat_auth_module, "require_internal_token", lambda _request: None)
    monkeypatch.setattr(
        intent_route_module.Settings,
        "load",
        lambda **_kwargs: SimpleNamespace(
            pipeline_model="gpt-5.2",
            openai_api_key="openai-key",
        ),
    )
    monkeypatch.setattr(
        intent_route_module,
        "classify_message",
        lambda **_kwargs: IntentResult(
            intent="greeting",
            confidence=1.0,
            needs_retrieval=False,
            friendly_response="Hello.",
            entities=empty_entities(),
            route_hint=None,
            classifier_method="rule",
        ),
    )

    client = TestClient(create_app())
    response = client.post("/v1/intent/classify", json={"message": "hello"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "greeting"
    assert payload["needs_retrieval"] is False
    assert payload["classifier_method"] == "rule"


def test_intent_classify_returns_503_on_classifier_failure(monkeypatch) -> None:
    monkeypatch.setattr(chat_auth_module, "require_internal_token", lambda _request: None)
    monkeypatch.setattr(
        intent_route_module.Settings,
        "load",
        lambda **_kwargs: SimpleNamespace(
            pipeline_model="gpt-5.2",
            openai_api_key="openai-key",
        ),
    )

    def _raise(**_kwargs):
        raise IntentClassificationError("classifier unavailable")

    monkeypatch.setattr(intent_route_module, "classify_message", _raise)

    client = TestClient(create_app())
    response = client.post("/v1/intent/classify", json={"message": "hello"})
    assert response.status_code == 503
    assert "classifier unavailable" in response.json()["detail"]

