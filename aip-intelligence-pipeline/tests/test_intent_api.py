from __future__ import annotations

from fastapi.testclient import TestClient

from openaip_pipeline.api.app import create_app
from openaip_pipeline.api.routes import intent as intent_route_module
from openaip_pipeline.services.intent.types import IntentResult, IntentType


class FakeRouter:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def route(self, text: str) -> IntentResult:
        self.calls.append(text)
        if not text.strip():
            return IntentResult(
                intent=IntentType.UNKNOWN,
                confidence=0.0,
                top2_intent=None,
                top2_confidence=None,
                margin=0.0,
                method="none",
            )

        return IntentResult(
            intent=IntentType.GREETING,
            confidence=0.99,
            top2_intent=None,
            top2_confidence=None,
            margin=0.99,
            method="semantic",
        )


def _authorized_headers() -> dict[str, str]:
    return {"x-pipeline-token": "test-pipeline-token"}


def test_intent_classify_happy_path(monkeypatch) -> None:
    fake_router = FakeRouter()
    monkeypatch.setattr(intent_route_module, "_INTENT_ROUTER", fake_router)
    monkeypatch.setenv("PIPELINE_INTERNAL_TOKEN", "test-pipeline-token")
    client = TestClient(create_app())

    response = client.post("/intent/classify", json={"text": "hello"}, headers=_authorized_headers())

    assert response.status_code == 200
    payload = response.json()
    assert payload == {
        "intent": "GREETING",
        "confidence": 0.99,
        "top2_intent": None,
        "top2_confidence": None,
        "margin": 0.99,
        "method": "semantic",
    }
    assert fake_router.calls == ["hello"]


def test_intent_classify_empty_text_returns_unknown(monkeypatch) -> None:
    fake_router = FakeRouter()
    monkeypatch.setattr(intent_route_module, "_INTENT_ROUTER", fake_router)
    monkeypatch.setenv("PIPELINE_INTERNAL_TOKEN", "test-pipeline-token")
    client = TestClient(create_app())

    response = client.post("/intent/classify", json={"text": ""}, headers=_authorized_headers())

    assert response.status_code == 200
    assert response.json() == {
        "intent": "UNKNOWN",
        "confidence": 0.0,
        "top2_intent": None,
        "top2_confidence": None,
        "margin": 0.0,
        "method": "none",
    }
    assert fake_router.calls == [""]


def test_intent_classify_truncates_very_long_input(monkeypatch) -> None:
    fake_router = FakeRouter()
    monkeypatch.setattr(intent_route_module, "_INTENT_ROUTER", fake_router)
    monkeypatch.setenv("PIPELINE_INTERNAL_TOKEN", "test-pipeline-token")
    client = TestClient(create_app())
    long_text = "a" * 2500

    response = client.post("/intent/classify", json={"text": long_text}, headers=_authorized_headers())

    assert response.status_code == 200
    assert len(fake_router.calls) == 1
    assert len(fake_router.calls[0]) == 2000


def test_intent_classify_missing_text_returns_422(monkeypatch) -> None:
    fake_router = FakeRouter()
    monkeypatch.setattr(intent_route_module, "_INTENT_ROUTER", fake_router)
    monkeypatch.setenv("PIPELINE_INTERNAL_TOKEN", "test-pipeline-token")
    client = TestClient(create_app())

    response = client.post("/intent/classify", json={}, headers=_authorized_headers())

    assert response.status_code == 422
    assert fake_router.calls == []


def test_intent_classify_missing_token_returns_401(monkeypatch) -> None:
    fake_router = FakeRouter()
    monkeypatch.setattr(intent_route_module, "_INTENT_ROUTER", fake_router)
    monkeypatch.setenv("PIPELINE_INTERNAL_TOKEN", "test-pipeline-token")
    client = TestClient(create_app())

    response = client.post("/intent/classify", json={"text": "hello"})

    assert response.status_code == 401
    assert fake_router.calls == []


def test_intent_classify_invalid_token_returns_401(monkeypatch) -> None:
    fake_router = FakeRouter()
    monkeypatch.setattr(intent_route_module, "_INTENT_ROUTER", fake_router)
    monkeypatch.setenv("PIPELINE_INTERNAL_TOKEN", "test-pipeline-token")
    client = TestClient(create_app())

    response = client.post(
        "/intent/classify",
        json={"text": "hello"},
        headers={"x-pipeline-token": "invalid-token"},
    )

    assert response.status_code == 401
    assert fake_router.calls == []
