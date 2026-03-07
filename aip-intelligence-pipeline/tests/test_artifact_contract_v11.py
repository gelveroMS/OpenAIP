from __future__ import annotations

import json
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

from openaip_pipeline.core.artifact_contract import (
    collect_summary_evidence,
    infer_sector_code,
    make_stage_root,
)
from openaip_pipeline.services.categorization.categorize import categorize_from_summarized_json_str
from openaip_pipeline.services.extraction.barangay import _normalize_barangay_row
from openaip_pipeline.services.summarization.summarize import summarize_aip_overall_json_str
from openaip_pipeline.services.validation.city import validate_projects_json_str


def _base_document() -> dict[str, Any]:
    return {
        "lgu": {"name": "Barangay Mamatid", "type": "barangay", "confidence": "high"},
        "fiscal_year": 2026,
        "source": {"document_type": "BAIP", "page_count": 8},
    }


def _project(
    *,
    key: str,
    ref: str,
    desc: str,
    total: float,
    page: int,
    errors: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "project_key": key,
        "aip_ref_code": ref,
        "program_project_description": desc,
        "implementing_agency": "Barangay Office",
        "start_date": "Jan 2026",
        "completion_date": "Dec 2026",
        "expected_output": "Done",
        "source_of_funds": "General Fund",
        "amounts": {
            "personal_services_raw": "0",
            "mooe_raw": str(total / 2),
            "financial_expenses_raw": None,
            "capital_outlay_raw": str(total / 2),
            "total_raw": str(total),
            "personal_services": 0,
            "maintenance_and_other_operating_expenses": total / 2,
            "financial_expenses": None,
            "capital_outlay": total / 2,
            "total": total,
        },
        "errors": errors,
        "source_refs": [
            {"page": page, "kind": "table_row", "evidence_text": desc},
        ],
    }


class _ValidationResponses:
    def create(self, **kwargs: Any) -> Any:
        user_payload = json.loads(kwargs["input"][1]["content"])
        projects = user_payload.get("projects", [])
        output = {"projects": [{"errors": None} for _ in projects]}
        return SimpleNamespace(
            output_text=json.dumps(output),
            usage=SimpleNamespace(input_tokens=1, output_tokens=1, total_tokens=2),
        )


class _ValidationClient:
    def __init__(self) -> None:
        self.responses = _ValidationResponses()


def test_validate_mutates_errors_only() -> None:
    extract_payload = make_stage_root(
        stage="extract",
        aip_id="aip-validate-1",
        uploaded_file_id=None,
        document=_base_document(),
        projects=[_project(key="1000-A", ref="1000-A", desc="Project A", total=1000, page=2)],
        warnings=[],
    )
    before = deepcopy(extract_payload["projects"][0])
    result = validate_projects_json_str(
        json.dumps(extract_payload),
        model="gpt-5.2",
        batch_size=1,
        client=_ValidationClient(),
    )
    after = result.validated_obj["projects"][0]
    before.pop("errors", None)
    compare = deepcopy(after)
    compare.pop("errors", None)
    assert compare == before


class _SummaryResponses:
    def create(self, **kwargs: Any) -> Any:
        output = {"summary": "Project C and Project D are dominant and Project B has validation issues."}
        return SimpleNamespace(
            output_text=json.dumps(output),
            usage=SimpleNamespace(input_tokens=1, output_tokens=1, total_tokens=2),
        )


class _SummaryClient:
    def __init__(self) -> None:
        self.responses = _SummaryResponses()


def test_summary_grounding_uses_top_and_flagged_projects() -> None:
    projects = [
        _project(key="1000-A", ref="1000-A", desc="Project A", total=100, page=1),
        _project(key="1000-B", ref="1000-B", desc="Project B", total=200, page=2, errors=["R001 missing"]),
        _project(key="1000-C", ref="1000-C", desc="Project C", total=500, page=3),
        _project(key="1000-D", ref="1000-D", desc="Project D", total=400, page=4),
    ]
    validate_payload = make_stage_root(
        stage="validate",
        aip_id="aip-summary-1",
        uploaded_file_id=None,
        document=_base_document(),
        projects=projects,
        warnings=[],
    )
    summary_result = summarize_aip_overall_json_str(
        json.dumps(validate_payload),
        model="gpt-5.2",
        client=_SummaryClient(),
    )
    summary = summary_result.summary_obj["summary"]
    assert isinstance(summary["source_refs"], list) and summary["source_refs"]
    assert isinstance(summary.get("evidence_project_keys"), list) and summary["evidence_project_keys"]
    assert "1000-B" in summary["evidence_project_keys"]
    assert any(ref.get("page") == 2 for ref in summary["source_refs"])
    assert any(ref.get("evidence_text") for ref in summary["source_refs"])


def test_collect_summary_evidence_returns_refs_and_keys() -> None:
    projects = [
        _project(key="1000-A", ref="1000-A", desc="Project Alpha", total=100, page=5),
        _project(key="1000-B", ref="1000-B", desc="Project Beta", total=200, page=6, errors=["R004 mismatch"]),
    ]
    refs, keys = collect_summary_evidence(projects, summary_text="Project Beta is prioritized.")
    assert refs
    assert keys
    assert "1000-B" in keys


class _CategorizeResponses:
    def parse(self, **kwargs: Any) -> Any:
        return SimpleNamespace(
            output_parsed=SimpleNamespace(items=[SimpleNamespace(index=0, category="Healthcare")]),
            usage=SimpleNamespace(input_tokens=1, output_tokens=1, total_tokens=2),
        )


class _CategorizeClient:
    def __init__(self) -> None:
        self.responses = _CategorizeResponses()


def test_categorize_normalizes_enum_and_sector_only() -> None:
    project = _project(key="1000-X", ref="1000-X", desc="Project Health", total=300, page=8)
    summarize_payload = make_stage_root(
        stage="summarize",
        aip_id="aip-cat-1",
        uploaded_file_id=None,
        document=_base_document(),
        projects=[project],
        summary={"text": "Health focused", "source_refs": [{"page": 8, "kind": "table_row"}]},
        warnings=[],
    )
    before_project = deepcopy(summarize_payload["projects"][0])
    result = categorize_from_summarized_json_str(
        json.dumps(summarize_payload),
        model="gpt-5.2",
        batch_size=25,
        client=_CategorizeClient(),
    )
    after_project = result.categorized_obj["projects"][0]
    assert after_project["classification"]["category"] == "health"
    assert after_project["classification"]["sector_code"] == "1000"
    before_project["classification"] = after_project["classification"]
    assert after_project == before_project
    assert infer_sector_code("XYZ") == "unknown"


def test_normalization_and_stable_hashes_for_source_refs() -> None:
    row = {
        "aip_ref_code": "1000-\n 2026-001",
        "program_project_description": "  Construction   of  Drainage  ",
        "implementing_agency": " Barangay Office ",
        "start_date": "Jan 2026",
        "completion_date": "Dec 2026",
        "expected_output": "output",
        "source_of_funds": "fund",
        "personal_services": " 0 ",
        "maintenance_and_other_operating_expenses": " 1,000 ",
        "financial_expenses": None,
        "capital_outlay": "2,000",
        "total": "3,000",
    }
    normalized_a, _ = _normalize_barangay_row(row=row, page=3, row_index=1)
    normalized_b, _ = _normalize_barangay_row(row=row, page=3, row_index=1)
    assert "\n" not in (normalized_a.get("aip_ref_code") or "")
    assert "\n" not in (normalized_a.get("project_key") or "")
    ref_a = normalized_a["source_refs"][0]
    ref_b = normalized_b["source_refs"][0]
    assert ref_a.get("anchor_hash") == ref_b.get("anchor_hash")
    assert ref_a.get("row_signature") == ref_b.get("row_signature")
