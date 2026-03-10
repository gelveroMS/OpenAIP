from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest

from openaip_pipeline.core.artifact_contract import make_stage_root
from openaip_pipeline.services.validation.barangay import validate_projects_json_str as validate_barangay
from openaip_pipeline.services.validation.city import validate_projects_json_str


def _document() -> dict[str, Any]:
    return {
        "lgu": {"name": "City Test", "type": "city", "confidence": "high"},
        "fiscal_year": 2026,
        "source": {"document_type": "AIP", "page_count": 12},
    }


def _project(index: int, *, description_length: int = 120) -> dict[str, Any]:
    ref_code = f"2000-{index:03d}"
    description = (f"Project {index} " + ("Drainage rehabilitation " * 400))[:description_length]
    return {
        "project_key": ref_code,
        "aip_ref_code": ref_code,
        "program_project_description": description,
        "implementing_agency": "City Engineering Office",
        "start_date": "Jan 2026",
        "completion_date": "Dec 2026",
        "expected_output": "Completed flood mitigation works",
        "source_of_funds": "General Fund",
        "amounts": {
            "personal_services": 1.0,
            "maintenance_and_other_operating_expenses": 2.0,
            "capital_outlay": 3.0,
            "total": 6.0,
        },
        "errors": None,
        "source_refs": [{"page": 1, "kind": "table_row", "evidence_text": description[:120]}],
    }


def _extract_payload(project_count: int, *, description_length: int = 120) -> dict[str, Any]:
    return make_stage_root(
        stage="extract",
        aip_id="aip-validate-dynamic",
        uploaded_file_id=None,
        document=_document(),
        projects=[_project(idx + 1, description_length=description_length) for idx in range(project_count)],
        warnings=[],
    )


class _ValidationResponses:
    def __init__(self, *, max_projects_per_call: int | None = None) -> None:
        self.max_projects_per_call = max_projects_per_call
        self.attempt_sizes: list[int] = []
        self.success_sizes: list[int] = []
        self.max_output_tokens: list[int | None] = []

    def create(self, **kwargs: Any) -> Any:
        self.max_output_tokens.append(kwargs.get("max_output_tokens"))
        payload = json.loads(kwargs["input"][1]["content"])
        projects = payload.get("projects", [])
        size = len(projects)
        self.attempt_sizes.append(size)
        if self.max_projects_per_call is not None and size > self.max_projects_per_call:
            raise RuntimeError("maximum context length exceeded")
        self.success_sizes.append(size)
        output = {
            "projects": [
                {"errors": [f"MODEL_ERR:{str(project.get('aip_ref_code') or 'unknown')}"]}
                for project in projects
            ]
        }
        return SimpleNamespace(
            output_text=json.dumps(output),
            usage=SimpleNamespace(input_tokens=10, output_tokens=5, total_tokens=15),
        )


class _ValidationClient:
    def __init__(self, *, max_projects_per_call: int | None = None) -> None:
        self.responses = _ValidationResponses(max_projects_per_call=max_projects_per_call)


class _PartialOutputResponses:
    def __init__(self) -> None:
        self.attempt_sizes: list[int] = []
        self.success_sizes: list[int] = []
        self.max_output_tokens: list[int | None] = []

    def create(self, **kwargs: Any) -> Any:
        self.max_output_tokens.append(kwargs.get("max_output_tokens"))
        payload = json.loads(kwargs["input"][1]["content"])
        projects = payload.get("projects", [])
        size = len(projects)
        self.attempt_sizes.append(size)

        # Simulate model truncation/partial output for larger chunks.
        output_projects = projects if size <= 1 else projects[:-1]
        if len(output_projects) == size:
            self.success_sizes.append(size)

        output = {
            "projects": [
                {"errors": [f"MODEL_ERR:{str(project.get('aip_ref_code') or 'unknown')}"]}
                for project in output_projects
            ]
        }
        return SimpleNamespace(
            output_text=json.dumps(output),
            status="completed",
            usage=SimpleNamespace(input_tokens=10, output_tokens=5, total_tokens=15),
        )


class _PartialOutputClient:
    def __init__(self) -> None:
        self.responses = _PartialOutputResponses()


class _SingleInvalidOutputResponses:
    def __init__(self) -> None:
        self.attempt_sizes: list[int] = []
        self.max_output_tokens: list[int | None] = []

    def create(self, **kwargs: Any) -> Any:
        self.max_output_tokens.append(kwargs.get("max_output_tokens"))
        payload = json.loads(kwargs["input"][1]["content"])
        projects = payload.get("projects", [])
        self.attempt_sizes.append(len(projects))
        return SimpleNamespace(
            output_text="{",
            status="incomplete",
            incomplete_details={"reason": "max_output_tokens"},
            usage=SimpleNamespace(input_tokens=10, output_tokens=5, total_tokens=15),
        )


class _SingleInvalidOutputClient:
    def __init__(self) -> None:
        self.responses = _SingleInvalidOutputResponses()


def test_small_input_uses_single_chunk() -> None:
    payload = _extract_payload(2, description_length=120)
    client = _ValidationClient()
    progress_events: list[tuple[int, int, int, int, str]] = []

    result = validate_projects_json_str(
        json.dumps(payload),
        model="gpt-5.2",
        batch_size=None,
        on_progress=lambda done, total, chunk_no, total_chunks, msg: progress_events.append(
            (done, total, chunk_no, total_chunks, msg)
        ),
        client=client,
    )

    assert client.responses.success_sizes == [2]
    assert result.usage == {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
    assert progress_events
    assert "preflight" in progress_events[0][4].lower()
    assert any("chunk start" in event[4].lower() for event in progress_events)
    assert any(
        event[0] < event[1]
        for event in progress_events[:-1]
    )
    assert progress_events[-1][0] == 2
    assert "chunk" in progress_events[-1][4].lower()
    refs = [row.get("aip_ref_code") for row in result.validated_obj["projects"]]
    model_errors = [row.get("errors") for row in result.validated_obj["projects"]]
    assert model_errors == [[f"MODEL_ERR:{ref}"] for ref in refs]


def test_large_input_chunks_by_token_budget(monkeypatch) -> None:
    monkeypatch.setenv("PIPELINE_VALIDATE_CONTEXT_WINDOW_TOKENS", "2048")
    monkeypatch.setenv("PIPELINE_VALIDATE_RESPONSE_BUFFER_TOKENS", "1000")
    monkeypatch.setenv("PIPELINE_VALIDATE_PROJECT_FIELD_CHAR_LIMIT", "4000")
    payload = _extract_payload(5, description_length=3000)
    client = _ValidationClient()

    progress_events: list[tuple[int, int, int, int, str]] = []

    result = validate_projects_json_str(
        json.dumps(payload),
        model="gpt-5.2",
        batch_size=None,
        on_progress=lambda done, total, chunk_no, total_chunks, msg: progress_events.append(
            (done, total, chunk_no, total_chunks, msg)
        ),
        client=client,
    )

    assert len(client.responses.success_sizes) > 1
    assert all(size >= 1 for size in client.responses.success_sizes)
    assert progress_events
    assert progress_events[-1][0] == 5
    assert "chunk" in progress_events[-1][4].lower()
    assert result.usage["total_tokens"] == len(client.responses.success_sizes) * 15


def test_context_overflow_splits_and_recovers() -> None:
    payload = _extract_payload(6, description_length=220)
    client = _ValidationClient(max_projects_per_call=1)
    progress_events: list[tuple[int, int, int, int, str]] = []

    result = validate_projects_json_str(
        json.dumps(payload),
        model="gpt-5.2",
        batch_size=None,
        on_progress=lambda done, total, chunk_no, total_chunks, msg: progress_events.append(
            (done, total, chunk_no, total_chunks, msg)
        ),
        client=client,
    )

    assert len(client.responses.attempt_sizes) > len(client.responses.success_sizes)
    assert client.responses.success_sizes == [1, 1, 1, 1, 1, 1]
    assert any("chunk split" in event[4].lower() for event in progress_events)
    assert result.usage == {"input_tokens": 60, "output_tokens": 30, "total_tokens": 90}
    assert all(isinstance(project.get("errors"), list) for project in result.validated_obj["projects"])


def test_partial_output_splits_and_recovers_city() -> None:
    payload = _extract_payload(6, description_length=220)
    client = _PartialOutputClient()
    progress_events: list[tuple[int, int, int, int, str]] = []

    result = validate_projects_json_str(
        json.dumps(payload),
        model="gpt-5.2",
        batch_size=None,
        on_progress=lambda done, total, chunk_no, total_chunks, msg: progress_events.append(
            (done, total, chunk_no, total_chunks, msg)
        ),
        client=client,
    )

    assert len(client.responses.attempt_sizes) > len(client.responses.success_sizes)
    assert client.responses.success_sizes == [1, 1, 1, 1, 1, 1]
    assert any("partial output" in event[4].lower() for event in progress_events)
    assert all(
        isinstance(project.get("errors"), list)
        for project in result.validated_obj["projects"]
    )
    assert all(
        isinstance(value, int) and value >= 32
        for value in client.responses.max_output_tokens
    )


def test_partial_output_splits_and_recovers_barangay() -> None:
    payload = _extract_payload(4, description_length=220)
    client = _PartialOutputClient()

    result = validate_barangay(
        json.dumps(payload),
        model="gpt-5.2",
        batch_size=None,
        client=client,
    )

    assert len(client.responses.attempt_sizes) > len(client.responses.success_sizes)
    assert client.responses.success_sizes == [1, 1, 1, 1]
    assert all(
        isinstance(project.get("errors"), list)
        for project in result.validated_obj["projects"]
    )
    assert all(
        isinstance(value, int) and value >= 32
        for value in client.responses.max_output_tokens
    )


def test_single_project_invalid_output_raises_explicit_error() -> None:
    payload = _extract_payload(1, description_length=220)
    client = _SingleInvalidOutputClient()

    with pytest.raises(RuntimeError, match="single project"):
        validate_projects_json_str(
            json.dumps(payload),
            model="gpt-5.2",
            batch_size=None,
            client=client,
        )


def test_single_project_context_overflow_raises_explicit_error() -> None:
    payload = _extract_payload(1, description_length=220)
    client = _ValidationClient(max_projects_per_call=0)

    with pytest.raises(RuntimeError, match="single project"):
        validate_projects_json_str(
            json.dumps(payload),
            model="gpt-5.2",
            batch_size=None,
            client=client,
        )


def test_barangay_validation_uses_dynamic_chunking(monkeypatch) -> None:
    monkeypatch.setenv("PIPELINE_VALIDATE_CONTEXT_WINDOW_TOKENS", "2048")
    monkeypatch.setenv("PIPELINE_VALIDATE_RESPONSE_BUFFER_TOKENS", "1000")
    monkeypatch.setenv("PIPELINE_VALIDATE_PROJECT_FIELD_CHAR_LIMIT", "4000")
    payload = _extract_payload(4, description_length=2800)
    client = _ValidationClient()

    result = validate_barangay(
        json.dumps(payload),
        model="gpt-5.2",
        batch_size=None,
        client=client,
    )

    assert len(client.responses.success_sizes) > 1
    assert result.usage["total_tokens"] == len(client.responses.success_sizes) * 15
