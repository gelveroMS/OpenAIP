from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

from openaip_pipeline.core.settings import Settings
from openaip_pipeline.worker import processor as processor_module


def _settings() -> Settings:
    return Settings(
        openai_api_key="sk-test-openai",
        supabase_url="https://example.supabase.co",
        supabase_service_key="sb-test-service",
        supabase_storage_artifact_bucket="aip-artifacts",
        pipeline_model="gpt-5.2",
        embedding_model="text-embedding-3-large",
        batch_size=25,
        worker_poll_seconds=3.0,
        worker_run_once=False,
        artifact_inline_max_bytes=32768,
        enable_rag=False,
        dev_routes=False,
    )


def _extract_payload() -> dict[str, Any]:
    return {
        "projects": [{"aip_ref_code": "P-001", "program_project_description": "Project One"}],
        "totals": [
            {
                "source_label": "total_investment_program",
                "value": 100.0,
                "currency": "PHP",
                "page_no": 1,
                "evidence_text": "TOTAL INVESTMENT PROGRAM 100.00",
            }
        ],
    }


def _validate_payload() -> dict[str, Any]:
    return {
        "projects": [
            {
                "aip_ref_code": "P-001",
                "program_project_description": "Project One",
                "errors": None,
            }
        ],
        "totals": [],
    }


def _summarize_payload() -> dict[str, Any]:
    return {
        "projects": [
            {
                "aip_ref_code": "P-001",
                "program_project_description": "Project One",
                "errors": None,
            }
        ],
        "summary": {"text": "Summary from prior run."},
        "totals": [],
    }


def _categorize_payload() -> dict[str, Any]:
    return {
        "projects": [
            {
                "aip_ref_code": "P-001",
                "program_project_description": "Project One",
                "classification": {"category": "other", "sector_code": "0000"},
            }
        ],
        "summary": {"text": "Summary from prior run."},
        "totals": [],
    }


class _FakeClient:
    def __init__(self) -> None:
        self.download_calls = 0
        self.update_calls: list[tuple[str, dict[str, Any], dict[str, str]]] = []

    def create_signed_url(self, bucket_id: str, object_name: str, expires_in: int = 600) -> str:
        return f"https://signed.local/{bucket_id}/{object_name}?exp={expires_in}"

    def download_bytes(self, url: str) -> bytes:
        self.download_calls += 1
        return b"%PDF-1.4 test"

    def update(
        self,
        table: str,
        patch: dict[str, Any],
        *,
        filters: dict[str, str],
        select: str | None = None,
    ) -> list[dict[str, Any]]:
        self.update_calls.append((table, patch, filters))
        return []


class _FakeRepo:
    def __init__(
        self,
        *,
        lineage: dict[str, str | None] | None = None,
        artifacts: dict[tuple[str, str], dict[str, Any]] | None = None,
        scope: str = "city",
    ) -> None:
        self.client = _FakeClient()
        self._lineage = lineage or {}
        self._artifacts = artifacts or {}
        self.scope = scope
        self.stage_calls: list[str] = []
        self.progress_calls: list[tuple[str, int, str | None]] = []
        self.inserted_artifacts: list[tuple[str, dict[str, Any], str | None]] = []
        self.upsert_totals_calls: list[list[Any]] = []
        self.succeeded = False
        self.failed: list[tuple[str, str]] = []

    def get_aip_scope(self, aip_id: str) -> str:
        return self.scope

    def get_uploaded_file(self, run: dict[str, Any]) -> Any:
        return SimpleNamespace(id="file-001", bucket_id="uploads", object_name="sample.pdf")

    def set_run_stage(self, *, run_id: str, stage: str) -> None:
        self.stage_calls.append(stage)

    def set_run_progress(
        self,
        *,
        run_id: str,
        stage: str,
        stage_progress_pct: int,
        progress_message: str | None = None,
    ) -> None:
        self.progress_calls.append((stage, stage_progress_pct, progress_message))

    def insert_artifact(
        self,
        *,
        run_id: str,
        aip_id: str,
        artifact_type: str,
        artifact_json: dict[str, Any] | None,
        artifact_text: str | None = None,
    ) -> str:
        self.inserted_artifacts.append((artifact_type, artifact_json or {}, artifact_text))
        return f"{artifact_type}-artifact-id"

    def upsert_aip_totals(self, *, aip_id: str, totals: Any) -> None:
        if isinstance(totals, list):
            self.upsert_totals_calls.append(totals)
        else:
            self.upsert_totals_calls.append([])

    def upsert_projects(
        self,
        *,
        aip_id: str,
        extraction_artifact_id: str,
        projects: Any,
    ) -> None:
        return None

    def upsert_aip_line_items(self, *, aip_id: str, projects: Any) -> list[dict[str, Any]]:
        return []

    def upsert_aip_line_item_embeddings(self, *, line_items: list[dict[str, Any]], model: str) -> None:
        return None

    def set_run_succeeded(self, *, run_id: str) -> None:
        self.succeeded = True

    def set_run_failed(self, *, run_id: str, stage: str, error_message: str) -> None:
        self.failed.append((stage, error_message))

    def get_stage_artifact(self, *, run_id: str, artifact_type: str) -> dict[str, Any] | None:
        return self._artifacts.get((run_id, artifact_type))

    def get_parent_run_id(self, *, run_id: str) -> str | None:
        return self._lineage.get(run_id)


def _patch_pipeline_fns(
    monkeypatch,
    *,
    call_counts: dict[str, int],
    extract_payload: dict[str, Any] | None = None,
    validate_payload: dict[str, Any] | None = None,
    scale_payload: dict[str, Any] | None = None,
    summarize_payload: dict[str, Any] | None = None,
    categorize_payload: dict[str, Any] | None = None,
    validation_batch_sizes: list[int | None] | None = None,
) -> None:
    monkeypatch.setattr(
        processor_module,
        "_enforce_retry_guardrail",
        lambda **_: None,
    )
    monkeypatch.setattr(
        processor_module,
        "run_with_heartbeat",
        lambda *, fn, **kwargs: fn(),
    )

    def fake_extract(*args: Any, **kwargs: Any) -> Any:
        call_counts["extract"] += 1
        payload = extract_payload or _extract_payload()
        return SimpleNamespace(payload=payload, json_str=json.dumps(payload, ensure_ascii=False))

    def fake_validate(extraction_json_str: str, **kwargs: Any) -> Any:
        call_counts["validate"] += 1
        if validation_batch_sizes is not None:
            value = kwargs.get("batch_size")
            validation_batch_sizes.append(value if isinstance(value, int) else None)
        payload = validate_payload or _validate_payload()
        progress_cb = kwargs.get("on_progress")
        if callable(progress_cb):
            project_count = (
                len(payload.get("projects"))
                if isinstance(payload.get("projects"), list)
                else 0
            )
            progress_cb(
                0,
                project_count,
                0,
                1,
                (
                    "Validation preflight: "
                    f"{project_count} project(s) planned across 1 chunk(s)."
                ),
            )
            progress_cb(
                0,
                project_count,
                1,
                1,
                (
                    "Validation chunk start: "
                    f"processing chunk 1/1 with {project_count} project(s)."
                ),
            )
            progress_cb(
                project_count,
                project_count,
                1,
                1,
                f"Validating projects {project_count}/{project_count} (chunk 1/1)...",
            )
        return SimpleNamespace(validated_obj=payload, validated_json_str=json.dumps(payload, ensure_ascii=False))

    def fake_summarize(validated_json_str: str, **kwargs: Any) -> Any:
        call_counts["summarize"] += 1
        payload = summarize_payload or _summarize_payload()
        text = str((payload.get("summary") or {}).get("text") or "Generated summary.")
        return SimpleNamespace(
            summary_obj=payload,
            summary_json_str=json.dumps(payload, ensure_ascii=False),
            summary_text=text,
        )

    def fake_categorize(summary_json_str: str, **kwargs: Any) -> Any:
        call_counts["categorize"] += 1
        payload = categorize_payload or _categorize_payload()
        return SimpleNamespace(
            categorized_obj=payload,
            categorized_json_str=json.dumps(payload, ensure_ascii=False),
        )

    def fake_scale(validated_json_str: str, **kwargs: Any) -> Any:
        if "scale_amounts" in call_counts:
            call_counts["scale_amounts"] += 1
        payload = scale_payload or validate_payload or _validate_payload()
        return SimpleNamespace(
            scaled_obj=payload,
            scaled_json_str=json.dumps(payload, ensure_ascii=False),
            scope=str(kwargs.get("scope") or ""),
            scaled=True,
        )

    monkeypatch.setattr(processor_module, "run_city_extraction", fake_extract)
    monkeypatch.setattr(processor_module, "validate_city", fake_validate)
    monkeypatch.setattr(processor_module, "scale_validated_amounts_json_str", fake_scale)
    monkeypatch.setattr(processor_module, "summarize_aip_overall_json_str", fake_summarize)
    monkeypatch.setattr(processor_module, "categorize_from_summarized_json_str", fake_categorize)


def test_resume_from_validate_skips_extraction(monkeypatch) -> None:
    calls = {"extract": 0, "validate": 0, "summarize": 0, "categorize": 0}
    validation_batch_sizes: list[int | None] = []
    _patch_pipeline_fns(
        monkeypatch,
        call_counts=calls,
        validation_batch_sizes=validation_batch_sizes,
    )

    repo = _FakeRepo(
        lineage={"run-new": "run-old"},
        artifacts={("run-old", "extract"): _extract_payload()},
        scope="city",
    )
    run = {
        "id": "run-new",
        "aip_id": "aip-001",
        "uploaded_file_id": "file-001",
        "resume_from_stage": "validate",
        "model_name": "gpt-5.2",
    }

    processor_module.process_run(repo=repo, settings=_settings(), run=run)

    assert calls == {"extract": 0, "validate": 1, "summarize": 1, "categorize": 1}
    assert repo.stage_calls[0] == "validate"
    assert repo.succeeded is True
    assert repo.failed == []
    inserted_types = [row[0] for row in repo.inserted_artifacts]
    assert "extract" not in inserted_types
    assert inserted_types[:4] == ["validate", "scale_amounts", "summarize", "categorize"]
    assert repo.upsert_totals_calls
    assert validation_batch_sizes == [processor_module.VALIDATION_FIXED_BATCH_SIZE]


def test_validate_stage_writes_intermediate_progress_and_logs(monkeypatch, capsys) -> None:
    calls = {"extract": 0, "validate": 0, "summarize": 0, "categorize": 0}
    _patch_pipeline_fns(monkeypatch, call_counts=calls)

    repo = _FakeRepo(
        lineage={"run-new": "run-old"},
        artifacts={("run-old", "extract"): _extract_payload()},
        scope="city",
    )
    run = {
        "id": "run-new",
        "aip_id": "aip-001",
        "uploaded_file_id": "file-001",
        "resume_from_stage": "validate",
        "model_name": "gpt-5.2",
    }

    processor_module.process_run(repo=repo, settings=_settings(), run=run)

    validate_messages = [
        message
        for stage, _, message in repo.progress_calls
        if stage == "validate" and isinstance(message, str)
    ]
    assert validate_messages
    assert any("fixed chunk size" in message.lower() for message in validate_messages)
    assert any("Validation preflight:" in message for message in validate_messages)
    assert any("Validation chunk start:" in message for message in validate_messages)
    assert "Validation complete." in validate_messages
    preflight_index = next(
        idx for idx, message in enumerate(validate_messages) if "Validation preflight:" in message
    )
    complete_index = validate_messages.index("Validation complete.")
    assert preflight_index < complete_index

    captured = capsys.readouterr()
    assert "[WORKER][VALIDATE] run=run-new" in captured.out


def test_scale_stage_runs_before_summarize_and_passes_scaled_payload(monkeypatch) -> None:
    calls = {"extract": 0, "validate": 0, "scale_amounts": 0, "summarize": 0, "categorize": 0}
    scaled_payload = {
        "projects": [
            {
                "aip_ref_code": "P-001",
                "program_project_description": "Project One",
                "errors": None,
            }
        ],
        "totals": [],
        "scaled_marker": True,
    }
    _patch_pipeline_fns(
        monkeypatch,
        call_counts=calls,
        scale_payload=scaled_payload,
    )

    captured_payload: dict[str, Any] = {}

    def fake_summarize(validated_json_str: str, **kwargs: Any) -> Any:
        calls["summarize"] += 1
        captured_payload["input"] = json.loads(validated_json_str)
        payload = _summarize_payload()
        text = str((payload.get("summary") or {}).get("text") or "Generated summary.")
        return SimpleNamespace(
            summary_obj=payload,
            summary_json_str=json.dumps(payload, ensure_ascii=False),
            summary_text=text,
        )

    monkeypatch.setattr(processor_module, "summarize_aip_overall_json_str", fake_summarize)

    repo = _FakeRepo(
        lineage={"run-new": "run-old"},
        artifacts={("run-old", "extract"): _extract_payload()},
        scope="city",
    )
    run = {
        "id": "run-new",
        "aip_id": "aip-001",
        "uploaded_file_id": "file-001",
        "resume_from_stage": "validate",
        "model_name": "gpt-5.2",
    }

    processor_module.process_run(repo=repo, settings=_settings(), run=run)

    assert calls["scale_amounts"] == 1
    assert calls["summarize"] == 1
    assert captured_payload["input"].get("scaled_marker") is True


def test_resume_from_summarize_skips_extract_and_validate(monkeypatch) -> None:
    calls = {"extract": 0, "validate": 0, "summarize": 0, "categorize": 0}
    _patch_pipeline_fns(monkeypatch, call_counts=calls)

    repo = _FakeRepo(
        lineage={"run-new": "run-old"},
        artifacts={("run-old", "scale_amounts"): _validate_payload()},
        scope="city",
    )
    run = {
        "id": "run-new",
        "aip_id": "aip-001",
        "uploaded_file_id": "file-001",
        "resume_from_stage": "summarize",
        "model_name": "gpt-5.2",
    }

    processor_module.process_run(repo=repo, settings=_settings(), run=run)

    assert calls == {"extract": 0, "validate": 0, "summarize": 1, "categorize": 1}
    assert repo.stage_calls[0] == "summarize"
    assert repo.succeeded is True
    inserted_types = [row[0] for row in repo.inserted_artifacts]
    assert inserted_types == ["summarize", "categorize"]


def test_resume_from_categorize_skips_prior_stages(monkeypatch) -> None:
    calls = {"extract": 0, "validate": 0, "summarize": 0, "categorize": 0}
    _patch_pipeline_fns(monkeypatch, call_counts=calls)

    summary_payload = _summarize_payload()
    repo = _FakeRepo(
        lineage={"run-new": "run-old"},
        artifacts={("run-old", "summarize"): summary_payload},
        scope="city",
    )
    run = {
        "id": "run-new",
        "aip_id": "aip-001",
        "uploaded_file_id": "file-001",
        "resume_from_stage": "categorize",
        "model_name": "gpt-5.2",
    }

    processor_module.process_run(repo=repo, settings=_settings(), run=run)

    assert calls == {"extract": 0, "validate": 0, "summarize": 0, "categorize": 1}
    assert repo.stage_calls == ["categorize"]
    assert repo.succeeded is True
    assert repo.inserted_artifacts[0][0] == "categorize"
    assert repo.inserted_artifacts[0][2] == "Summary from prior run."


def test_missing_prerequisite_artifact_falls_back_to_extract(monkeypatch) -> None:
    calls = {"extract": 0, "validate": 0, "summarize": 0, "categorize": 0}
    _patch_pipeline_fns(monkeypatch, call_counts=calls)

    repo = _FakeRepo(
        lineage={"run-new": "run-old"},
        artifacts={},
        scope="city",
    )
    run = {
        "id": "run-new",
        "aip_id": "aip-001",
        "uploaded_file_id": "file-001",
        "resume_from_stage": "validate",
        "model_name": "gpt-5.2",
    }

    processor_module.process_run(repo=repo, settings=_settings(), run=run)

    assert calls == {"extract": 1, "validate": 1, "summarize": 1, "categorize": 1}
    assert repo.stage_calls[0] == "extract"
    assert repo.succeeded is True


def test_corrupt_prerequisite_artifact_falls_back_to_extract(monkeypatch) -> None:
    calls = {"extract": 0, "validate": 0, "summarize": 0, "categorize": 0}
    _patch_pipeline_fns(monkeypatch, call_counts=calls)

    repo = _FakeRepo(
        lineage={"run-new": "run-old"},
        artifacts={("run-old", "extract"): {"projects": "not-a-list"}},
        scope="city",
    )
    run = {
        "id": "run-new",
        "aip_id": "aip-001",
        "uploaded_file_id": "file-001",
        "resume_from_stage": "validate",
        "model_name": "gpt-5.2",
    }

    processor_module.process_run(repo=repo, settings=_settings(), run=run)

    assert calls == {"extract": 1, "validate": 1, "summarize": 1, "categorize": 1}
    assert repo.stage_calls[0] == "extract"
    assert repo.succeeded is True


def test_lineage_traversal_finds_prerequisite_artifact_from_ancestor(monkeypatch) -> None:
    calls = {"extract": 0, "validate": 0, "summarize": 0, "categorize": 0}
    _patch_pipeline_fns(monkeypatch, call_counts=calls)

    repo = _FakeRepo(
        lineage={"run-new": "run-mid", "run-mid": "run-root", "run-root": None},
        artifacts={("run-root", "extract"): _extract_payload()},
        scope="city",
    )
    run = {
        "id": "run-new",
        "aip_id": "aip-001",
        "uploaded_file_id": "file-001",
        "resume_from_stage": "validate",
        "model_name": "gpt-5.2",
    }

    processor_module.process_run(repo=repo, settings=_settings(), run=run)

    assert calls["extract"] == 0
    assert calls["validate"] == 1
    assert repo.stage_calls[0] == "validate"
    assert repo.succeeded is True
