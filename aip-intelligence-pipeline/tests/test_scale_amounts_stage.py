from __future__ import annotations

import json
from typing import Any

from openaip_pipeline.core.artifact_contract import make_stage_root
from openaip_pipeline.services.scaling.scale_amounts import scale_validated_amounts_json_str


def _document(scope: str = "city") -> dict[str, Any]:
    return {
        "lgu": {"name": "Test LGU", "type": scope, "confidence": "high"},
        "fiscal_year": 2026,
        "source": {"document_type": "AIP", "page_count": 1},
    }


def _validated_payload() -> dict[str, Any]:
    return make_stage_root(
        stage="validate",
        aip_id="aip-scale-1",
        uploaded_file_id="upload-1",
        document=_document("city"),
        projects=[
            {
                "project_key": "1000-A",
                "aip_ref_code": "1000-A",
                "program_project_description": "Project A",
                "amounts": {
                    "personal_services_raw": "1.5",
                    "mooe_raw": "2.5",
                    "capital_outlay_raw": "3.0",
                    "total_raw": "7.0",
                    "personal_services": 1.5,
                    "maintenance_and_other_operating_expenses": 2.5,
                    "financial_expenses": 0.5,
                    "capital_outlay": 3.0,
                    "total": 7.5,
                },
                "climate": {
                    "climate_change_adaptation": "12.50",
                    "climate_change_mitigation": "N/A",
                },
                "source_refs": [{"page": 1, "kind": "table_row", "table_index": 0, "row_index": 0}],
            }
        ],
        totals=[
            {
                "source_label": "total_investment_program",
                "value": 100.25,
                "currency": "PHP",
                "page_no": 1,
                "evidence_text": "TOTAL INVESTMENT PROGRAM 100.25",
            }
        ],
        warnings=[],
    )


def test_scale_city_payload_multiplies_target_fields_and_keeps_raw_fields() -> None:
    validated = _validated_payload()
    result = scale_validated_amounts_json_str(json.dumps(validated), scope="city")

    assert result.scaled is True
    assert result.scaled_obj["stage"] == "scale_amounts"

    project = result.scaled_obj["projects"][0]
    amounts = project["amounts"]
    climate = project["climate"]
    totals = result.scaled_obj["totals"][0]

    assert amounts["personal_services"] == 1500.0
    assert amounts["maintenance_and_other_operating_expenses"] == 2500.0
    assert amounts["financial_expenses"] == 500.0
    assert amounts["capital_outlay"] == 3000.0
    assert amounts["total"] == 7500.0

    assert climate["climate_change_adaptation"] == "12500"
    assert climate["climate_change_mitigation"] == "N/A"

    assert totals["value"] == 100250.0
    assert totals["evidence_text"] == "TOTAL INVESTMENT PROGRAM 100.25"

    # raw fields must remain unchanged
    assert amounts["personal_services_raw"] == "1.5"
    assert amounts["mooe_raw"] == "2.5"
    assert amounts["capital_outlay_raw"] == "3.0"
    assert amounts["total_raw"] == "7.0"


def test_non_city_scope_is_passthrough_with_stage_update_only() -> None:
    validated = _validated_payload()
    result = scale_validated_amounts_json_str(json.dumps(validated), scope="barangay")

    assert result.scaled is False
    assert result.scaled_obj["stage"] == "scale_amounts"

    project = result.scaled_obj["projects"][0]
    amounts = project["amounts"]
    climate = project["climate"]
    totals = result.scaled_obj["totals"][0]

    assert amounts["personal_services"] == 1.5
    assert amounts["maintenance_and_other_operating_expenses"] == 2.5
    assert amounts["financial_expenses"] == 0.5
    assert amounts["capital_outlay"] == 3.0
    assert amounts["total"] == 7.5
    assert climate["climate_change_adaptation"] == "12.50"
    assert climate["climate_change_mitigation"] == "N/A"
    assert totals["value"] == 100.25
