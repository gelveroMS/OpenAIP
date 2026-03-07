from __future__ import annotations

import json
import re
from types import SimpleNamespace
from typing import Any

import pytest

from openaip_pipeline.core.artifact_contract import make_stage_root
from openaip_pipeline.services.categorization.categorize import categorize_from_summarized_json_str


def _document() -> dict[str, Any]:
    return {
        "lgu": {"name": "City Test", "type": "city", "confidence": "high"},
        "fiscal_year": 2026,
        "source": {"document_type": "AIP", "page_count": 12},
    }


def _project(index: int, *, description_length: int = 120) -> dict[str, Any]:
    ref_code = f"3000-{index:03d}"
    description = (f"Project {index} " + ("Public infrastructure improvements " * 400))[
        :description_length
    ]
    return {
        "project_key": ref_code,
        "aip_ref_code": ref_code,
        "program_project_description": description,
        "implementing_agency": "City Engineering Office",
        "start_date": "Jan 2026",
        "completion_date": "Dec 2026",
        "expected_output": "Completed works",
        "source_of_funds": "General Fund",
        "amounts": {
            "personal_services": 0.0,
            "maintenance_and_other_operating_expenses": float(index * 1000),
            "capital_outlay": float(index * 500),
            "total": float(index * 1500),
        },
        "errors": None,
        "source_refs": [{"page": 1, "kind": "table_row", "evidence_text": description[:120]}],
    }


def _summarized_payload(project_count: int, *, description_length: int = 120) -> dict[str, Any]:
    return make_stage_root(
        stage="summarize",
        aip_id="aip-categorize-dynamic",
        uploaded_file_id=None,
        document=_document(),
        projects=[_project(idx + 1, description_length=description_length) for idx in range(project_count)],
        summary={"text": "Summary text", "source_refs": [{"page": 1, "kind": "table_row"}]},
        warnings=[],
    )


def _expected_category(ref_code: str) -> str:
    return "health" if ref_code[-1] in {"1", "3", "5", "7", "9"} else "infrastructure"


class _CategorizationResponses:
    def __init__(self, *, max_items_per_call: int | None = None) -> None:
        self.max_items_per_call = max_items_per_call
        self.attempt_sizes: list[int] = []
        self.success_sizes: list[int] = []

    def parse(self, **kwargs: Any) -> Any:
        user_text = str(kwargs["input"][1]["content"])
        body = user_text[len("Items:\n\n") :] if user_text.startswith("Items:\n\n") else user_text
        blocks = [block for block in body.split("\n\n---\n\n") if block.strip()]
        self.attempt_sizes.append(len(blocks))
        if self.max_items_per_call is not None and len(blocks) > self.max_items_per_call:
            raise RuntimeError("maximum context length exceeded")

        items: list[Any] = []
        for block in blocks:
            lines = block.splitlines()
            if not lines or not lines[0].startswith("ITEM "):
                continue
            index = int(lines[0].split(" ", 1)[1])
            details = "\n".join(lines[1:])
            match = re.search(r"RefCode:\s*(.+)", details)
            ref_code = match.group(1).strip() if match else ""
            category = "Healthcare" if _expected_category(ref_code) == "health" else "Infrastructure"
            items.append(SimpleNamespace(index=index, category=category))
        self.success_sizes.append(len(items))
        return SimpleNamespace(
            output_parsed=SimpleNamespace(items=items),
            usage=SimpleNamespace(input_tokens=8, output_tokens=4, total_tokens=12),
        )


class _CategorizationClient:
    def __init__(self, *, max_items_per_call: int | None = None) -> None:
        self.responses = _CategorizationResponses(max_items_per_call=max_items_per_call)


def test_small_input_uses_single_chunk() -> None:
    payload = _summarized_payload(3, description_length=120)
    client = _CategorizationClient()

    result = categorize_from_summarized_json_str(
        json.dumps(payload),
        model="gpt-5.2",
        batch_size=None,
        client=client,
    )

    assert client.responses.success_sizes == [3]
    assert result.usage == {"input_tokens": 8, "output_tokens": 4, "total_tokens": 12}
    for project in result.categorized_obj["projects"]:
        ref_code = str(project.get("aip_ref_code") or "")
        classification = project.get("classification") if isinstance(project.get("classification"), dict) else {}
        assert classification.get("category") == _expected_category(ref_code)
        assert classification.get("sector_code") == "3000"


def test_large_input_chunks_by_token_budget(monkeypatch) -> None:
    monkeypatch.setenv("PIPELINE_CATEGORIZE_CONTEXT_WINDOW_TOKENS", "2048")
    monkeypatch.setenv("PIPELINE_CATEGORIZE_RESPONSE_BUFFER_TOKENS", "1000")
    monkeypatch.setenv("PIPELINE_CATEGORIZE_PROJECT_FIELD_CHAR_LIMIT", "4000")
    payload = _summarized_payload(6, description_length=3000)
    client = _CategorizationClient()

    result = categorize_from_summarized_json_str(
        json.dumps(payload),
        model="gpt-5.2",
        batch_size=None,
        client=client,
    )

    assert len(client.responses.success_sizes) > 1
    assert result.usage["total_tokens"] == len(client.responses.success_sizes) * 12
    assert all(project.get("classification") for project in result.categorized_obj["projects"])


def test_context_overflow_splits_and_recovers() -> None:
    payload = _summarized_payload(5, description_length=220)
    client = _CategorizationClient(max_items_per_call=1)

    result = categorize_from_summarized_json_str(
        json.dumps(payload),
        model="gpt-5.2",
        batch_size=None,
        client=client,
    )

    assert len(client.responses.attempt_sizes) > len(client.responses.success_sizes)
    assert client.responses.success_sizes == [1, 1, 1, 1, 1]
    assert result.usage == {"input_tokens": 40, "output_tokens": 20, "total_tokens": 60}


def test_single_project_context_overflow_raises_explicit_error() -> None:
    payload = _summarized_payload(1, description_length=220)
    client = _CategorizationClient(max_items_per_call=0)

    with pytest.raises(RuntimeError, match="single project"):
        categorize_from_summarized_json_str(
            json.dumps(payload),
            model="gpt-5.2",
            batch_size=None,
            client=client,
        )
