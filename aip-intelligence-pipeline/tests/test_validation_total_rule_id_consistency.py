from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

from openaip_pipeline.core.artifact_contract import make_stage_root
from openaip_pipeline.services.validation.barangay import (
    _validate_total_barangay,
    validate_projects_json_str as validate_barangay,
)
from openaip_pipeline.services.validation.city import (
    _validate_total_city,
    validate_projects_json_str as validate_city,
)


def _document(lgu_type: str) -> dict[str, Any]:
    return {
        "lgu": {"name": "Validation Test", "type": lgu_type, "confidence": "high"},
        "fiscal_year": 2026,
        "source": {"document_type": "AIP", "page_count": 1},
    }


def _project(amounts: dict[str, float | None]) -> dict[str, Any]:
    return {
        "project_key": "9000-01",
        "aip_ref_code": "9000-01",
        "program_project_description": "SK Fund",
        "implementing_agency": "Brgy Hall",
        "start_date": "1/1/2026",
        "completion_date": "12/31/2026",
        "expected_output": "Transferred 10% of general fund",
        "source_of_funds": "General Admin.",
        "amounts": amounts,
        "errors": None,
        "source_refs": [{"page": 1, "kind": "table_row", "evidence_text": "row"}],
    }


class _R005MismatchResponses:
    def __init__(self, message: str) -> None:
        self._message = message

    def create(self, **kwargs: Any) -> Any:
        payload = json.loads(kwargs["input"][1]["content"])
        projects = payload.get("projects", [])
        output = {"projects": [{"errors": [self._message]} for _ in projects]}
        return SimpleNamespace(
            output_text=json.dumps(output),
            usage=SimpleNamespace(input_tokens=1, output_tokens=1, total_tokens=2),
        )


class _ValidationClient:
    def __init__(self, message: str) -> None:
        self.responses = _R005MismatchResponses(message)


def test_city_total_mismatch_stays_single_r005() -> None:
    amounts = {
        "personal_services": 10.0,
        "maintenance_and_other_operating_expenses": 5.0,
        "capital_outlay": 0.0,
        "total": 1.0,
    }
    message = "R005 total mismatch: expected 15.00 but got 1.00"
    payload = make_stage_root(
        stage="extract",
        aip_id="aip-city-r005",
        uploaded_file_id=None,
        document=_document("city"),
        projects=[_project(amounts)],
        warnings=[],
    )

    result = validate_city(
        json.dumps(payload),
        model="gpt-5.2",
        batch_size=25,
        client=_ValidationClient(message),
    )

    errors = result.validated_obj["projects"][0]["errors"]
    assert errors == [message]
    assert not any("R004 total mismatch" in err for err in errors)


def test_barangay_total_mismatch_stays_single_r005() -> None:
    amounts = {
        "personal_services": 10.0,
        "maintenance_and_other_operating_expenses": 5.0,
        "financial_expenses": 2.0,
        "capital_outlay": 0.0,
        "total": 1.0,
    }
    message = "R005 total mismatch: expected 17.00 but got 1.00"
    payload = make_stage_root(
        stage="extract",
        aip_id="aip-barangay-r005",
        uploaded_file_id=None,
        document=_document("barangay"),
        projects=[_project(amounts)],
        warnings=[],
    )

    result = validate_barangay(
        json.dumps(payload),
        model="gpt-5.2",
        batch_size=25,
        client=_ValidationClient(message),
    )

    errors = result.validated_obj["projects"][0]["errors"]
    assert errors == [message]
    assert not any("R004 total mismatch" in err for err in errors)


def test_total_helpers_emit_r005_rule_id() -> None:
    city_errors = _validate_total_city(
        {
            "amounts": {
                "personal_services": 10.0,
                "maintenance_and_other_operating_expenses": 5.0,
                "capital_outlay": 0.0,
                "total": 1.0,
            }
        }
    )
    barangay_errors = _validate_total_barangay(
        {
            "amounts": {
                "personal_services": 10.0,
                "maintenance_and_other_operating_expenses": 5.0,
                "financial_expenses": 2.0,
                "capital_outlay": 0.0,
                "total": 1.0,
            }
        }
    )

    assert city_errors == ["R005 total mismatch: expected 15.00 but got 1.00"]
    assert barangay_errors == ["R005 total mismatch: expected 17.00 but got 1.00"]
