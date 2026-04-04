from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import supabase.client as supabase_client

from openaip_pipeline.services.chat.sql_router import maybe_answer_with_sql


class _FakeQuery:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = [dict(row) for row in rows]

    def select(self, _columns: str):
        return self

    def eq(self, key: str, value: Any):
        self._rows = [row for row in self._rows if row.get(key) == value]
        return self

    def in_(self, key: str, values: list[Any]):
        allowed = set(values)
        self._rows = [row for row in self._rows if row.get(key) in allowed]
        return self

    def ilike(self, key: str, pattern: str):
        needle = pattern.lower()
        starts = needle.startswith("%")
        ends = needle.endswith("%")
        core = needle.strip("%")

        def matches(value: str) -> bool:
            hay = value.lower()
            if starts and ends:
                return core in hay
            if starts:
                return hay.endswith(core)
            if ends:
                return hay.startswith(core)
            return hay == core

        self._rows = [
            row for row in self._rows if isinstance(row.get(key), str) and matches(str(row.get(key)))
        ]
        return self

    def execute(self):
        return SimpleNamespace(data=list(self._rows))


class _FakeSupabase:
    def __init__(self, tables: dict[str, list[dict[str, Any]]]) -> None:
        self._tables = tables

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self._tables.get(name, []))


def _fake_db() -> _FakeSupabase:
    return _FakeSupabase(
        {
            "aips": [
                {
                    "id": "aip-1",
                    "fiscal_year": 2025,
                    "barangay_id": "brgy-1",
                    "city_id": "city-1",
                    "municipality_id": None,
                    "status": "published",
                    "created_at": "2026-01-01T00:00:00Z",
                },
                {
                    "id": "aip-2",
                    "fiscal_year": 2026,
                    "barangay_id": "brgy-1",
                    "city_id": "city-1",
                    "municipality_id": None,
                    "status": "published",
                    "created_at": "2026-01-02T00:00:00Z",
                },
                {
                    "id": "aip-3",
                    "fiscal_year": 2025,
                    "barangay_id": "brgy-2",
                    "city_id": "city-1",
                    "municipality_id": None,
                    "status": "published",
                    "created_at": "2026-01-03T00:00:00Z",
                },
            ],
            "aip_totals": [
                {
                    "aip_id": "aip-1",
                    "total_investment_program": 1000,
                    "source_label": "total_investment_program",
                    "evidence_text": "FY 2025 published total for brgy-1",
                    "page_no": 2,
                },
                {
                    "aip_id": "aip-2",
                    "total_investment_program": 1200,
                    "source_label": "total_investment_program",
                    "evidence_text": "FY 2026 published total for brgy-1",
                    "page_no": 3,
                },
                {
                    "aip_id": "aip-3",
                    "total_investment_program": 500,
                    "source_label": "total_investment_program",
                    "evidence_text": "FY 2025 published total for brgy-2",
                    "page_no": 4,
                },
            ],
            "aip_line_items": [
                {
                    "id": "line-1",
                    "aip_id": "aip-1",
                    "fiscal_year": 2025,
                    "barangay_id": "brgy-1",
                    "aip_ref_code": "2025-001-001-001",
                    "program_project_title": "Road Rehabilitation",
                    "implementing_agency": "Engineering Office",
                    "start_date": "2025-01-01",
                    "end_date": "2025-12-31",
                    "fund_source": "General Fund",
                    "sector_code": "INFRA",
                    "sector_name": "Infrastructure",
                    "total": 600,
                    "expected_output": "Upgraded roads",
                    "page_no": 10,
                    "row_no": 5,
                    "table_no": 1,
                },
                {
                    "id": "line-2",
                    "aip_id": "aip-1",
                    "fiscal_year": 2025,
                    "barangay_id": "brgy-1",
                    "aip_ref_code": "2025-001-001-002",
                    "program_project_title": "Health Supplies",
                    "implementing_agency": "Health Office",
                    "start_date": "2025-02-01",
                    "end_date": "2025-08-31",
                    "fund_source": "Grant",
                    "sector_code": "HEALTH",
                    "sector_name": "Health",
                    "total": 400,
                    "expected_output": "Medical kits",
                    "page_no": 11,
                    "row_no": 6,
                    "table_no": 1,
                },
                {
                    "id": "line-3",
                    "aip_id": "aip-2",
                    "fiscal_year": 2026,
                    "barangay_id": "brgy-1",
                    "aip_ref_code": "2026-001-001-001",
                    "program_project_title": "Road Rehabilitation Phase 2",
                    "implementing_agency": "Engineering Office",
                    "start_date": "2026-01-01",
                    "end_date": "2026-12-31",
                    "fund_source": "Loan",
                    "sector_code": "INFRA",
                    "sector_name": "Infrastructure",
                    "total": 1200,
                    "expected_output": "Additional roads",
                    "page_no": 12,
                    "row_no": 1,
                    "table_no": 1,
                },
                {
                    "id": "line-4",
                    "aip_id": "aip-3",
                    "fiscal_year": 2025,
                    "barangay_id": "brgy-2",
                    "aip_ref_code": "2025-002-001-001",
                    "program_project_title": "Water System",
                    "implementing_agency": "Water Office",
                    "start_date": "2025-03-01",
                    "end_date": "2025-10-31",
                    "fund_source": "General Fund",
                    "sector_code": "UTIL",
                    "sector_name": "Utilities",
                    "total": 500,
                    "expected_output": "Water access",
                    "page_no": 9,
                    "row_no": 3,
                    "table_no": 1,
                },
            ],
            "projects": [
                {"aip_id": "aip-1", "category": "road_infrastructure"},
                {"aip_id": "aip-2", "category": "road_infrastructure"},
                {"aip_id": "aip-3", "category": "water_projects"},
            ],
            "barangays": [
                {"id": "brgy-1", "name": "Mamatid"},
                {"id": "brgy-2", "name": "San Jose"},
            ],
            "cities": [{"id": "city-1", "name": "Calamba"}],
            "municipalities": [],
        }
    )


def _fake_db_with_many_gad_rows() -> _FakeSupabase:
    db = _fake_db()
    rows = list(db._tables.get("aip_line_items", []))
    for index in range(1, 25):
        rows.append(
            {
                "id": f"line-gad-{index}",
                "aip_id": "aip-1",
                "fiscal_year": 2025,
                "barangay_id": "brgy-1",
                "aip_ref_code": f"2025-001-900-{index:03d}",
                "program_project_title": f"GAD Initiative {index}",
                "implementing_agency": "GAD Office",
                "start_date": "2025-01-01",
                "end_date": "2025-12-31",
                "fund_source": "GAD Fund",
                "sector_code": "SOC",
                "sector_name": "Social Services",
                "total": 100 + index,
                "expected_output": "GAD support services",
                "page_no": 20,
                "row_no": index,
                "table_no": 2,
            }
        )
    db._tables["aip_line_items"] = rows
    return db


def _scope_brgy_1() -> dict[str, Any]:
    return {
        "mode": "named_scopes",
        "targets": [
            {
                "scope_type": "barangay",
                "scope_id": "brgy-1",
                "scope_name": "Mamatid",
            }
        ],
    }


def _call(question: str, *, scope: dict[str, Any] | None = None, filters: dict[str, Any] | None = None):
    return maybe_answer_with_sql(
        supabase_url="https://example.test",
        supabase_service_key="service-key",
        question=question,
        retrieval_scope=scope or {"mode": "global", "targets": []},
        retrieval_filters=filters or {},
    )


def test_totals_route(monkeypatch) -> None:
    monkeypatch.setattr(supabase_client, "create_client", lambda *_args, **_kwargs: _fake_db())
    result = _call("What is the total investment program for FY 2025?", scope=_scope_brgy_1())
    assert result is not None
    assert result["retrieval_meta"]["route_family"] == "sql_totals"
    assert result["retrieval_meta"]["status"] == "answer"
    assert "PHP" in result["answer"]


def test_top_projects_route(monkeypatch) -> None:
    monkeypatch.setattr(supabase_client, "create_client", lambda *_args, **_kwargs: _fake_db())
    result = _call("Show top 2 projects for FY 2025.", scope=_scope_brgy_1())
    assert result is not None
    assert result["retrieval_meta"]["route_family"] == "aggregate_sql"
    assert result["retrieval_meta"]["aggregation"] == "top_projects"
    assert "Top 2 projects" in result["answer"]


def test_totals_by_sector_route(monkeypatch) -> None:
    monkeypatch.setattr(supabase_client, "create_client", lambda *_args, **_kwargs: _fake_db())
    result = _call("Give budget totals by sector for FY 2025.", scope=_scope_brgy_1())
    assert result is not None
    assert result["retrieval_meta"]["route_family"] == "aggregate_sql"
    assert result["retrieval_meta"]["aggregation"] == "totals_by_sector"
    assert "Budget totals by sector" in result["answer"]


def test_totals_by_fund_source_route(monkeypatch) -> None:
    monkeypatch.setattr(supabase_client, "create_client", lambda *_args, **_kwargs: _fake_db())
    result = _call("Show totals by fund source for FY 2025.", scope=_scope_brgy_1())
    assert result is not None
    assert result["retrieval_meta"]["route_family"] == "aggregate_sql"
    assert result["retrieval_meta"]["aggregation"] == "totals_by_fund_source"
    assert "Budget totals by fund source" in result["answer"]


def test_compare_years_route(monkeypatch) -> None:
    monkeypatch.setattr(supabase_client, "create_client", lambda *_args, **_kwargs: _fake_db())
    result = _call("Compare FY 2025 vs FY 2026.", scope=_scope_brgy_1())
    assert result is not None
    assert result["retrieval_meta"]["route_family"] == "aggregate_sql"
    assert result["retrieval_meta"]["aggregation"] == "compare_years"
    assert "Comparison" in result["answer"]


def test_compare_years_clarification(monkeypatch) -> None:
    monkeypatch.setattr(supabase_client, "create_client", lambda *_args, **_kwargs: _fake_db())
    result = _call("Compare this year budget.", scope=_scope_brgy_1())
    assert result is not None
    assert result["retrieval_meta"]["status"] == "clarification"
    assert result["retrieval_meta"]["route_family"] == "aggregate_sql"


def test_line_item_lookup_route(monkeypatch) -> None:
    monkeypatch.setattr(supabase_client, "create_client", lambda *_args, **_kwargs: _fake_db())
    result = _call("What is the fund source for 2025-001-001-001?", scope=_scope_brgy_1())
    assert result is not None
    assert result["retrieval_meta"]["route_family"] == "row_sql"
    assert result["retrieval_meta"]["status"] == "answer"
    assert "fund source" in result["answer"].lower()


def test_metadata_route(monkeypatch) -> None:
    monkeypatch.setattr(supabase_client, "create_client", lambda *_args, **_kwargs: _fake_db())
    result = _call("What years are available?", scope={"mode": "global", "targets": []})
    assert result is not None
    assert result["retrieval_meta"]["route_family"] == "metadata_sql"
    assert result["retrieval_meta"]["metadata_intent"] == "years"
    assert "Available fiscal years" in result["answer"]


def test_filtered_project_list_route_with_cap(monkeypatch) -> None:
    monkeypatch.setattr(supabase_client, "create_client", lambda *_args, **_kwargs: _fake_db_with_many_gad_rows())
    result = _call("Show all projects where fund source is GAD fund for FY 2025.", scope=_scope_brgy_1())
    assert result is not None
    assert result["retrieval_meta"]["route_family"] == "filtered_list_sql"
    assert result["retrieval_meta"]["aggregation"] == "filtered_project_list"
    assert result["retrieval_meta"]["exhaustive_intent"] is True
    assert result["retrieval_meta"]["result_cap"] == 20
    assert result["retrieval_meta"]["total_matches"] == 24
    assert result["retrieval_meta"]["returned_count"] == 20
    assert result["retrieval_meta"]["truncated"] is True
    assert "Showing first 20 of 24 matches" in result["answer"]


def test_filtered_project_list_route_supports_typo_synonym(monkeypatch) -> None:
    monkeypatch.setattr(supabase_client, "create_client", lambda *_args, **_kwargs: _fake_db_with_many_gad_rows())
    result = _call("Show evry projects where funcing source is GAD fund for FY 2025.", scope=_scope_brgy_1())
    assert result is not None
    assert result["retrieval_meta"]["route_family"] == "filtered_list_sql"
    assert result["retrieval_meta"]["aggregation"] == "filtered_project_list"
    assert result["retrieval_meta"]["exhaustive_signal"] == "evry"


def test_unmatched_query_returns_none(monkeypatch) -> None:
    monkeypatch.setattr(supabase_client, "create_client", lambda *_args, **_kwargs: _fake_db())
    result = _call("Tell me a story about procurement policy.")
    assert result is None
