from __future__ import annotations

from typing import Any
from urllib.error import HTTPError

import pytest

from openaip_pipeline.adapters.supabase.repositories import PipelineRepository


class _FakeProjectsClient:
    def __init__(
        self,
        *,
        conflict_on_insert_refs: set[str] | None = None,
        conflict_row_human_edited: bool = False,
    ) -> None:
        self.insert_calls: list[dict[str, Any]] = []
        self.update_calls: list[dict[str, Any]] = []
        self.projects_by_key: dict[tuple[str, str], dict[str, Any]] = {}
        self.conflict_on_insert_refs = {ref.lower() for ref in (conflict_on_insert_refs or set())}
        self.conflict_row_human_edited = conflict_row_human_edited

    @staticmethod
    def _strip_eq(value: str | None) -> str | None:
        if not isinstance(value, str):
            return None
        return value[3:] if value.startswith("eq.") else value

    def select(
        self,
        table: str,
        *,
        select: str,
        filters: dict[str, str] | None = None,
        order: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        del select, order
        if table != "projects":
            return []
        rows = list(self.projects_by_key.values())
        if filters:
            aip_id = self._strip_eq(filters.get("aip_id"))
            ref_code = self._strip_eq(filters.get("aip_ref_code"))
            if aip_id:
                rows = [row for row in rows if row.get("aip_id") == aip_id]
            if ref_code:
                rows = [row for row in rows if row.get("aip_ref_code") == ref_code]
        if limit is not None:
            rows = rows[:limit]
        return rows

    def insert(
        self,
        table: str,
        row: dict[str, Any],
        *,
        select: str | None = None,
        on_conflict: str | None = None,
        upsert: bool = False,
    ) -> list[dict[str, Any]]:
        del select, on_conflict, upsert
        self.insert_calls.append({"table": table, "row": dict(row)})
        if table != "projects":
            return [{"id": "ok"}]

        aip_id = str(row["aip_id"])
        ref_code = str(row["aip_ref_code"])
        key = (aip_id, ref_code.lower())

        if key[1] in self.conflict_on_insert_refs:
            self.conflict_on_insert_refs.remove(key[1])
            self.projects_by_key[key] = {
                "id": "proj-conflict",
                "aip_id": aip_id,
                "aip_ref_code": ref_code,
                "is_human_edited": self.conflict_row_human_edited,
            }
            raise HTTPError(url="http://example.test", code=409, msg="Conflict", hdrs=None, fp=None)

        if key in self.projects_by_key:
            raise HTTPError(url="http://example.test", code=409, msg="Conflict", hdrs=None, fp=None)

        row_id = f"proj-{len(self.projects_by_key) + 1}"
        stored = {
            "id": row_id,
            "aip_id": aip_id,
            "aip_ref_code": ref_code,
            "is_human_edited": False,
        }
        self.projects_by_key[key] = stored
        return [stored]

    def update(
        self,
        table: str,
        patch: dict[str, Any],
        *,
        filters: dict[str, str],
        select: str | None = None,
    ) -> list[dict[str, Any]]:
        del select
        self.update_calls.append({"table": table, "patch": dict(patch), "filters": dict(filters)})
        if table != "projects":
            return []
        row_id = self._strip_eq(filters.get("id"))
        if not row_id:
            return []
        for key, row in self.projects_by_key.items():
            if row.get("id") != row_id:
                continue
            updated = {**row, **patch}
            self.projects_by_key[key] = updated
            return [updated]
        return []


def _sample_project(ref_code: str, description: str) -> dict[str, Any]:
    return {
        "aip_ref_code": ref_code,
        "program_project_description": description,
        "implementing_agency": "Barangay Council",
        "start_date": "2026-01-01",
        "completion_date": "2026-12-31",
        "expected_output": "Output",
        "source_of_funds": "General Fund",
        "amounts": {
            "personal_services": 100.0,
            "maintenance_and_other_operating_expenses": 200.0,
            "financial_expenses": 0.0,
            "capital_outlay": 300.0,
            "total": 600.0,
        },
        "classification": {"category": "other"},
    }


def test_upsert_projects_updates_second_duplicate_ref_in_same_payload() -> None:
    fake_client = _FakeProjectsClient()
    repo = PipelineRepository(fake_client)  # type: ignore[arg-type]

    repo.upsert_projects(
        aip_id="aip-123",
        extraction_artifact_id="artifact-1",
        projects=[
            _sample_project("1000-A", "First description"),
            _sample_project("1000-A", "Updated description"),
        ],
    )

    project_inserts = [call for call in fake_client.insert_calls if call["table"] == "projects"]
    project_updates = [call for call in fake_client.update_calls if call["table"] == "projects"]
    assert len(project_inserts) == 1
    assert len(project_updates) == 1
    assert project_updates[0]["patch"]["program_project_description"] == "Updated description"


def test_upsert_projects_recovers_from_insert_conflict_and_updates_row() -> None:
    fake_client = _FakeProjectsClient(conflict_on_insert_refs={"1000-A"})
    repo = PipelineRepository(fake_client)  # type: ignore[arg-type]

    repo.upsert_projects(
        aip_id="aip-123",
        extraction_artifact_id="artifact-1",
        projects=[_sample_project("1000-A", "Recovered on conflict")],
    )

    project_updates = [call for call in fake_client.update_calls if call["table"] == "projects"]
    assert len(project_updates) == 1
    assert project_updates[0]["filters"]["id"] == "eq.proj-conflict"


def test_upsert_projects_keeps_human_edited_row_on_insert_conflict() -> None:
    fake_client = _FakeProjectsClient(
        conflict_on_insert_refs={"1000-A"},
        conflict_row_human_edited=True,
    )
    repo = PipelineRepository(fake_client)  # type: ignore[arg-type]

    repo.upsert_projects(
        aip_id="aip-123",
        extraction_artifact_id="artifact-1",
        projects=[_sample_project("1000-A", "Should not overwrite human edit")],
    )

    project_updates = [call for call in fake_client.update_calls if call["table"] == "projects"]
    assert project_updates == []


def test_upsert_projects_conflict_without_lookup_row_surfaces_context() -> None:
    class _MissingConflictClient(_FakeProjectsClient):
        def insert(
            self,
            table: str,
            row: dict[str, Any],
            *,
            select: str | None = None,
            on_conflict: str | None = None,
            upsert: bool = False,
        ) -> list[dict[str, Any]]:
            del row, select, on_conflict, upsert
            if table == "projects":
                raise HTTPError(
                    url="http://example.test",
                    code=409,
                    msg=(
                        "Conflict | code=23503 | "
                        "message=insert violates foreign key constraint \"fk_projects_sector\" | "
                        "details=Key (sector_code)=(A101) is not present in table \"sectors\"."
                    ),
                    hdrs=None,
                    fp=None,
                )
            return []

    repo = PipelineRepository(_MissingConflictClient())  # type: ignore[arg-type]

    with pytest.raises(RuntimeError) as error_info:
        repo.upsert_projects(
            aip_id="aip-123",
            extraction_artifact_id="artifact-1",
            projects=[_sample_project("A101-01", "Will fail with FK")],
        )

    message = str(error_info.value)
    assert "lookup found no conflicting row" in message
    assert "aip_id=aip-123" in message
    assert "aip_ref_code=A101-01" in message
    assert "fk_projects_sector" in message
