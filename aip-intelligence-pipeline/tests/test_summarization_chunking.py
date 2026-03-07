from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

from openaip_pipeline.core.artifact_contract import make_stage_root
from openaip_pipeline.services.summarization.summarize import summarize_aip_overall_json_str


def _document() -> dict[str, Any]:
    return {
        "lgu": {"name": "Barangay Test", "type": "barangay", "confidence": "high"},
        "fiscal_year": 2026,
        "source": {"document_type": "BAIP", "page_count": 10},
    }


def _project(
    index: int,
    *,
    description_length: int = 120,
    has_error: bool = False,
) -> dict[str, Any]:
    ref_code = f"1000-{index:03d}"
    description = f"Project {index} " + ("Road rehabilitation " * 30)
    description = description[:description_length]
    return {
        "project_key": ref_code,
        "aip_ref_code": ref_code,
        "program_project_description": description,
        "implementing_agency": "Barangay Engineering Office",
        "start_date": "Jan 2026",
        "completion_date": "Dec 2026",
        "expected_output": "Completed road improvements",
        "source_of_funds": "General Fund",
        "amounts": {
            "personal_services": 0,
            "maintenance_and_other_operating_expenses": float(index * 1000),
            "financial_expenses": None,
            "capital_outlay": float(index * 500),
            "total": float(index * 1500),
        },
        "errors": ["R001 missing completion evidence"] if has_error else None,
        "source_refs": [
            {
                "page": max(1, index),
                "kind": "table_row",
                "evidence_text": description,
            }
        ],
    }


def _validated_payload(project_count: int, *, description_length: int = 120) -> dict[str, Any]:
    projects = [
        _project(index + 1, description_length=description_length, has_error=(index == 1))
        for index in range(project_count)
    ]
    return make_stage_root(
        stage="validate",
        aip_id="aip-summary-chunking",
        uploaded_file_id=None,
        document=_document(),
        projects=projects,
        warnings=[],
    )


class _SummaryResponses:
    def __init__(
        self,
        *,
        map_context_limit_projects: int | None = None,
        reduce_context_limit_count: int | None = None,
    ) -> None:
        self.map_context_limit_projects = map_context_limit_projects
        self.reduce_context_limit_count = reduce_context_limit_count
        self.map_calls: list[dict[str, Any]] = []
        self.reduce_calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> Any:
        payload = json.loads(kwargs["input"][1]["content"])
        usage = SimpleNamespace(input_tokens=10, output_tokens=5, total_tokens=15)

        if "chunk_summaries" in payload:
            self.reduce_calls.append(payload)
            summaries = payload.get("chunk_summaries", [])
            if (
                self.reduce_context_limit_count is not None
                and len(summaries) > self.reduce_context_limit_count
            ):
                raise RuntimeError("maximum context length exceeded")
            summary = f"Reduce({len(summaries)}): " + " | ".join(str(item) for item in summaries)
            return SimpleNamespace(output_text=json.dumps({"summary": summary}), usage=usage)

        self.map_calls.append(payload)
        projects = payload.get("projects", [])
        if (
            self.map_context_limit_projects is not None
            and len(projects) > self.map_context_limit_projects
        ):
            raise RuntimeError("maximum context length exceeded")
        refs = [
            str(project.get("aip_ref_code") or project.get("project_key") or f"IDX-{index}")
            for index, project in enumerate(projects)
        ]
        summary = f"Map({len(projects)}): " + ", ".join(refs)
        return SimpleNamespace(output_text=json.dumps({"summary": summary}), usage=usage)


class _SummaryClient:
    def __init__(
        self,
        *,
        map_context_limit_projects: int | None = None,
        reduce_context_limit_count: int | None = None,
    ) -> None:
        self.responses = _SummaryResponses(
            map_context_limit_projects=map_context_limit_projects,
            reduce_context_limit_count=reduce_context_limit_count,
        )


def test_small_input_uses_single_map_no_reduce() -> None:
    validated = _validated_payload(2)
    client = _SummaryClient()

    result = summarize_aip_overall_json_str(
        json.dumps(validated),
        model="gpt-5.2",
        client=client,
    )

    assert len(client.responses.map_calls) == 1
    assert len(client.responses.reduce_calls) == 0
    assert result.summary_text.startswith("Map(")
    assert result.usage == {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}


def test_large_input_chunks_into_map_and_reduce(monkeypatch) -> None:
    monkeypatch.setenv("PIPELINE_SUMMARIZE_CONTEXT_WINDOW_TOKENS", "1400")
    monkeypatch.setenv("PIPELINE_SUMMARIZE_RESPONSE_BUFFER_TOKENS", "100")
    validated = _validated_payload(30, description_length=420)
    client = _SummaryClient()

    result = summarize_aip_overall_json_str(
        json.dumps(validated),
        model="gpt-5.2",
        client=client,
    )

    map_calls = len(client.responses.map_calls)
    reduce_calls = len(client.responses.reduce_calls)
    assert map_calls > 1
    assert reduce_calls >= 1
    assert result.summary_text.startswith("Reduce(")
    total_calls = map_calls + reduce_calls
    assert result.usage == {
        "input_tokens": total_calls * 10,
        "output_tokens": total_calls * 5,
        "total_tokens": total_calls * 15,
    }


def test_multi_level_reduction_occurs_when_reduce_payload_overflows(monkeypatch) -> None:
    monkeypatch.setenv("PIPELINE_SUMMARIZE_CONTEXT_WINDOW_TOKENS", "1400")
    monkeypatch.setenv("PIPELINE_SUMMARIZE_RESPONSE_BUFFER_TOKENS", "100")
    validated = _validated_payload(30, description_length=420)
    client = _SummaryClient(reduce_context_limit_count=2)

    result = summarize_aip_overall_json_str(
        json.dumps(validated),
        model="gpt-5.2",
        client=client,
    )

    assert len(client.responses.map_calls) > 2
    assert len(client.responses.reduce_calls) > 1
    assert result.summary_text.startswith("Reduce(")


def test_map_context_overflow_splits_chunks_and_recovers() -> None:
    validated = _validated_payload(6, description_length=220)
    client = _SummaryClient(map_context_limit_projects=1)

    result = summarize_aip_overall_json_str(
        json.dumps(validated),
        model="gpt-5.2",
        client=client,
    )

    assert len(client.responses.map_calls) > 1
    assert len(client.responses.reduce_calls) >= 1
    assert result.summary_text


def test_reduce_context_overflow_splits_and_recovers(monkeypatch) -> None:
    monkeypatch.setenv("PIPELINE_SUMMARIZE_CONTEXT_WINDOW_TOKENS", "1400")
    monkeypatch.setenv("PIPELINE_SUMMARIZE_RESPONSE_BUFFER_TOKENS", "100")
    validated = _validated_payload(24, description_length=380)
    client = _SummaryClient(reduce_context_limit_count=2)

    result = summarize_aip_overall_json_str(
        json.dumps(validated),
        model="gpt-5.2",
        client=client,
    )

    assert len(client.responses.reduce_calls) > 1
    assert result.summary_text


def test_final_summary_preserves_grounding_fields(monkeypatch) -> None:
    monkeypatch.setenv("PIPELINE_SUMMARIZE_CONTEXT_WINDOW_TOKENS", "1400")
    monkeypatch.setenv("PIPELINE_SUMMARIZE_RESPONSE_BUFFER_TOKENS", "100")
    validated = _validated_payload(12, description_length=300)
    client = _SummaryClient()

    result = summarize_aip_overall_json_str(
        json.dumps(validated),
        model="gpt-5.2",
        client=client,
    )

    summary = result.summary_obj.get("summary") if isinstance(result.summary_obj, dict) else None
    assert isinstance(summary, dict)
    assert isinstance(summary.get("source_refs"), list) and summary["source_refs"]
    assert isinstance(summary.get("evidence_project_keys"), list) and summary["evidence_project_keys"]
