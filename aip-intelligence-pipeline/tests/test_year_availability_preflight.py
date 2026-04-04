from __future__ import annotations

import sys
import types
from types import SimpleNamespace
from typing import Any

from openaip_pipeline.services.chat.year_availability import check_year_availability_preflight


class _FakeQuery:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = [dict(row) for row in rows]

    def select(self, _columns: str):
        return self

    def eq(self, key: str, value: Any):
        self._rows = [row for row in self._rows if row.get(key) == value]
        return self

    def ilike(self, key: str, pattern: str):
        needle = str(pattern or "").lower()
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


def _install_fake_supabase(monkeypatch, fake_db: _FakeSupabase) -> None:
    fake_module = types.SimpleNamespace(create_client=lambda *_args, **_kwargs: fake_db)
    monkeypatch.setitem(sys.modules, "supabase.client", fake_module)


def test_scope_target_year_unavailable_returns_available_years(monkeypatch) -> None:
    fake_db = _FakeSupabase(
        {
            "aips": [
                {"status": "published", "fiscal_year": 2025, "barangay_id": "brgy-pulo"},
                {"status": "published", "fiscal_year": 2026, "barangay_id": "brgy-pulo"},
                {"status": "published", "fiscal_year": 2026, "barangay_id": "brgy-mamatid"},
            ]
        }
    )
    _install_fake_supabase(monkeypatch, fake_db)

    result = check_year_availability_preflight(
        supabase_url="https://example.test",
        supabase_service_key="service-key",
        question="Which projects in Barangay Pulo FY 2024 are health related?",
        retrieval_scope={
            "mode": "named_scopes",
            "targets": [{"scope_type": "barangay", "scope_id": "brgy-pulo", "scope_name": "Pulo"}],
        },
        retrieval_filters={"fiscal_year": 2024},
    )

    assert result["decision"] == "year_unavailable"
    assert result["requested_fiscal_year"] == 2024
    assert result["available_fiscal_years"] == [2025, 2026]
    assert result["year_availability_scope"] == {"scope_type": "barangay", "scope_name": "Barangay Pulo"}


def test_scope_target_year_available_returns_year_available(monkeypatch) -> None:
    fake_db = _FakeSupabase(
        {
            "aips": [
                {"status": "published", "fiscal_year": 2025, "barangay_id": "brgy-pulo"},
                {"status": "published", "fiscal_year": 2026, "barangay_id": "brgy-pulo"},
            ]
        }
    )
    _install_fake_supabase(monkeypatch, fake_db)

    result = check_year_availability_preflight(
        supabase_url="https://example.test",
        supabase_service_key="service-key",
        question="Which projects in Barangay Pulo FY 2026 are health related?",
        retrieval_scope={
            "mode": "named_scopes",
            "targets": [{"scope_type": "barangay", "scope_id": "brgy-pulo", "scope_name": "Pulo"}],
        },
        retrieval_filters={"fiscal_year": 2026},
    )

    assert result["decision"] == "year_available"
    assert result["requested_fiscal_year"] == 2026
    assert result["available_fiscal_years"] == [2025, 2026]


def test_scope_name_ambiguity_returns_ambiguous_scope(monkeypatch) -> None:
    fake_db = _FakeSupabase(
        {
            "aips": [
                {"status": "published", "fiscal_year": 2025, "barangay_id": "brgy-1"},
                {"status": "published", "fiscal_year": 2026, "barangay_id": "brgy-2"},
            ],
            "barangays": [
                {"id": "brgy-1", "name": "Pulo"},
                {"id": "brgy-2", "name": "Pulo"},
            ],
        }
    )
    _install_fake_supabase(monkeypatch, fake_db)

    result = check_year_availability_preflight(
        supabase_url="https://example.test",
        supabase_service_key="service-key",
        question="Which projects in Barangay Pulo FY 2026 are health related?",
        retrieval_scope={"mode": "global", "targets": []},
        retrieval_filters={"fiscal_year": 2026, "scope_type": "barangay", "scope_name": "Pulo"},
    )

    assert result["decision"] == "ambiguous_scope"
    assert result["reason"] == "scope_name_ambiguous"
    assert result["year_availability_scope"] == {"scope_type": "barangay", "scope_name": "Pulo"}

