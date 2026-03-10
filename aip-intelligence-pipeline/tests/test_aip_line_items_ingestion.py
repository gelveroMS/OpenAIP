from __future__ import annotations

from typing import Any

from openaip_pipeline.adapters.supabase.repositories import PipelineRepository


class _FakeClient:
    def __init__(self) -> None:
        self.insert_calls: list[dict[str, Any]] = []
        self.update_calls: list[dict[str, Any]] = []

    def select(
        self,
        table: str,
        *,
        select: str,
        filters: dict[str, str] | None = None,
        order: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        del select, order, limit
        if table == "aips":
            return [
                {
                    "id": "aip-123",
                    "fiscal_year": 2026,
                    "barangay_id": "brgy-001",
                    "city_id": None,
                    "municipality_id": None,
                }
            ]
        if table == "aip_line_items":
            if filters and filters.get("aip_id") == "eq.aip-123":
                return [
                    {
                        "id": "line-001",
                        "aip_ref_code": "1000-A",
                        "page_no": 1,
                        "row_no": 3,
                        "table_no": 0,
                    }
                ]
        return []

    def insert(
        self,
        table: str,
        row: dict[str, Any],
        *,
        select: str | None = None,
        on_conflict: str | None = None,
        upsert: bool = False,
    ) -> list[dict[str, Any]]:
        self.insert_calls.append(
            {
                "table": table,
                "row": row,
                "select": select,
                "on_conflict": on_conflict,
                "upsert": upsert,
            }
        )
        if table == "aip_line_items":
            return [{"id": "line-inserted"}]
        return [{"id": "ok"}]

    def update(
        self,
        table: str,
        patch: dict[str, Any],
        *,
        filters: dict[str, str],
        select: str | None = None,
    ) -> list[dict[str, Any]]:
        self.update_calls.append(
            {
                "table": table,
                "patch": patch,
                "filters": filters,
                "select": select,
            }
        )
        return [{"id": "line-001"}]


def test_upsert_aip_line_items_uses_source_of_truth_context_and_updates_existing() -> None:
    fake_client = _FakeClient()
    repo = PipelineRepository(fake_client)  # type: ignore[arg-type]

    upserted = repo.upsert_aip_line_items(
        aip_id="aip-123",
        projects=[
            {
                "aip_ref_code": "1000-A",
                "program_project_description": "Honoraria - Administrative",
                "implementing_agency": "Barangay Council",
                "start_date": "2026-01-01",
                "completion_date": "2026-12-31",
                "source_of_funds": "General Fund",
                "expected_output": "Monthly release",
                "amounts": {
                    "personal_services": 1000,
                    "maintenance_and_other_operating_expenses": 500,
                    "capital_outlay": 0,
                    "financial_expenses": 0,
                    "total": 1500,
                },
                "source_refs": [{"page": 1, "row_index": 3, "table_index": 0}],
            }
        ],
    )

    assert len(fake_client.update_calls) == 1
    update_call = fake_client.update_calls[0]
    assert update_call["table"] == "aip_line_items"
    assert update_call["patch"]["fiscal_year"] == 2026
    assert update_call["patch"]["barangay_id"] == "brgy-001"
    assert update_call["patch"]["program_project_title"] == "Honoraria - Administrative"
    assert update_call["patch"]["page_no"] == 1
    assert update_call["patch"]["row_no"] == 3
    assert update_call["patch"]["table_no"] == 0
    assert update_call["patch"]["sector_code"] == "1000"

    assert len(upserted) == 1
    assert upserted[0]["id"] == "line-001"
    assert "Schedule=2026-01-01..2026-12-31" in upserted[0]["embedding_text"]


def test_upsert_aip_line_items_null_or_invalid_ref_yields_null_sector() -> None:
    fake_client = _FakeClient()
    repo = PipelineRepository(fake_client)  # type: ignore[arg-type]

    repo.upsert_aip_line_items(
        aip_id="aip-123",
        projects=[
            {
                "aip_ref_code": "A101-01",
                "sector_code": "1000",
                "sector_name": "General Sector",
                "program_project_description": "Invalid ref sector should clear",
                "source_refs": [{"page": 2, "row_index": 5, "table_index": 0}],
            },
            {
                "aip_ref_code": None,
                "sector_code": "3000",
                "sector_name": "Social Sector",
                "program_project_description": "Null ref sector should clear",
                "source_refs": [{"page": 3, "row_index": 7, "table_index": 1}],
            },
        ],
    )

    line_item_inserts = [
        call
        for call in fake_client.insert_calls
        if call["table"] == "aip_line_items"
    ]
    assert len(line_item_inserts) == 2
    for call in line_item_inserts:
        assert call["row"]["sector_code"] is None
        assert call["row"]["sector_name"] is None


def test_upsert_aip_line_item_embeddings_uses_conflict_key() -> None:
    fake_client = _FakeClient()
    repo = PipelineRepository(fake_client)  # type: ignore[arg-type]

    repo.upsert_aip_line_item_embeddings(
        line_items=[
            {
                "line_item_id": "line-001",
                "embedding": [0.1, 0.2, 0.3],
            }
        ],
        model="text-embedding-3-large",
    )

    assert len(fake_client.insert_calls) == 1
    call = fake_client.insert_calls[0]
    assert call["table"] == "aip_line_item_embeddings"
    assert call["on_conflict"] == "line_item_id"
    assert call["upsert"] is True
    assert call["row"]["line_item_id"] == "line-001"
