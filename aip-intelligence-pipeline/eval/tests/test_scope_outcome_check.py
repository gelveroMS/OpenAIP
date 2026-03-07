from __future__ import annotations

import json
from pathlib import Path

from eval import run_scope_outcome_check as run_mod


def test_classify_observed_outcome_mapping() -> None:
    outcome, status, reason, inst = run_mod.classify_observed_outcome(
        payload={
            "status": "answer",
            "assistantMessage": {"retrievalMeta": {"refused": False}},
        },
        http_status=200,
        raw_text=None,
        error=None,
    )
    assert (outcome, status, reason, inst) == ("in_scope_answerable", "answer", None, None)

    outcome, status, reason, inst = run_mod.classify_observed_outcome(
        payload={
            "status": "refusal",
            "assistantMessage": {"retrievalMeta": {"refusalReason": "unsupported_request"}},
        },
        http_status=200,
        raw_text=None,
        error=None,
    )
    assert (outcome, status, reason, inst) == ("out_of_scope", "refusal", "unsupported_request", None)

    outcome, status, reason, inst = run_mod.classify_observed_outcome(
        payload={
            "status": "refusal",
            "assistantMessage": {"retrievalMeta": {"refusalReason": "document_limitation"}},
        },
        http_status=200,
        raw_text=None,
        error=None,
    )
    assert (outcome, status, reason, inst) == ("in_scope_no_data", "refusal", "document_limitation", None)

    outcome, status, reason, inst = run_mod.classify_observed_outcome(
        payload={"status": "clarification", "assistantMessage": {"retrievalMeta": {}}},
        http_status=200,
        raw_text=None,
        error=None,
    )
    assert (outcome, status, reason, inst) == ("in_scope_ambiguous", "clarification", None, None)


def test_classify_observed_outcome_instrumentation_detection() -> None:
    outcome, status, reason, inst = run_mod.classify_observed_outcome(
        payload=None,
        http_status=200,
        raw_text="<!DOCTYPE html><html><body>Login</body></html>",
        error=None,
    )
    assert (outcome, status, reason, inst) == (
        "instrumentation_error",
        None,
        None,
        "html_login_or_redirect",
    )

    outcome, status, reason, inst = run_mod.classify_observed_outcome(
        payload=None,
        http_status=200,
        raw_text='{"not":"expected"}',
        error=None,
    )
    assert (outcome, status, reason, inst) == (
        "instrumentation_error",
        None,
        None,
        "non_json_response",
    )

    outcome, status, reason, inst = run_mod.classify_observed_outcome(
        payload={},
        http_status=200,
        raw_text=None,
        error=None,
    )
    assert (outcome, status, reason, inst) == ("unknown_outcome", None, None, None)


def test_read_cases_validates_expected_outcome_enum(tmp_path: Path) -> None:
    valid_input = tmp_path / "ok.json"
    valid_input.write_text(
        json.dumps(
            {
                "version": "v1",
                "items": [
                    {
                        "id": "SO1000",
                        "question": "Sample",
                        "expected_outcome": "in_scope_no_data",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    version, rows = run_mod._read_cases(valid_input)
    assert version == "v1"
    assert rows[0].expected_outcome == "in_scope_no_data"

    invalid_input = tmp_path / "bad.json"
    invalid_input.write_text(
        json.dumps(
            {
                "version": "v1",
                "items": [
                    {
                        "id": "SO1001",
                        "question": "Sample",
                        "expected_outcome": "not_valid",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    try:
        run_mod._read_cases(invalid_input)
    except RuntimeError as exc:
        assert "invalid expected_outcome" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError for invalid expected_outcome.")


def test_build_summary_is_deterministic() -> None:
    rows = [
        {
            "id": "SO1",
            "question": "q1",
            "expected_outcome": "in_scope_answerable",
            "observed_outcome": "in_scope_answerable",
            "match": True,
            "observed_status": "answer",
            "observed_refusal_reason": None,
            "instrumentation_reason": None,
            "http_status": 200,
            "attempts": 1,
            "timing_ms": 10.1,
            "error": None,
            "json_payload_present": True,
            "notes": None,
        },
        {
            "id": "SO2",
            "question": "q2",
            "expected_outcome": "in_scope_no_data",
            "observed_outcome": "in_scope_no_data",
            "match": True,
            "observed_status": "refusal",
            "observed_refusal_reason": "document_limitation",
            "instrumentation_reason": None,
            "http_status": 200,
            "attempts": 1,
            "timing_ms": 11.2,
            "error": None,
            "json_payload_present": True,
            "notes": None,
        },
    ]
    summary_a = run_mod.build_summary(
        rows=rows,
        run_id="run-a",
        input_path=Path("eval/questions/scope_outcome_seed_v1.json"),
        base_url="http://localhost:3000",
    )
    summary_b = run_mod.build_summary(
        rows=rows,
        run_id="run-a",
        input_path=Path("eval/questions/scope_outcome_seed_v1.json"),
        base_url="http://localhost:3000",
    )
    assert summary_a == summary_b


class _FakeHttpResult:
    def __init__(self, payload: dict):
        self.http_status = 200
        self.json_body = payload
        self.raw_text = None
        self.error = None
        self.attempts = 1
        self.timing_ms = 5.0


class _FakeClient:
    def __init__(self, *args, **kwargs):  # noqa: D401, ANN001, ANN003
        self.calls: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):  # noqa: ANN001
        return None

    def post_message(self, content: str, session_id: str | None = None):
        self.calls.append({"content": content, "session_id": session_id})
        lowered = content.lower()
        if "unsupported" in lowered:
            payload = {
                "status": "refusal",
                "assistantMessage": {"retrievalMeta": {"status": "refusal", "refusalReason": "unsupported_request"}},
            }
        elif "no data" in lowered:
            payload = {
                "status": "refusal",
                "assistantMessage": {"retrievalMeta": {"status": "refusal", "refusalReason": "document_limitation"}},
            }
        elif "clarify" in lowered:
            payload = {
                "status": "clarification",
                "assistantMessage": {"retrievalMeta": {"status": "clarification"}},
            }
        else:
            payload = {
                "status": "answer",
                "assistantMessage": {"retrievalMeta": {"status": "answer", "refused": False}},
            }
        return _FakeHttpResult(payload)


def test_runner_writes_expected_artifacts(tmp_path: Path, monkeypatch) -> None:
    input_path = tmp_path / "cases.json"
    input_path.write_text(
        json.dumps(
            {
                "version": "seed-test",
                "items": [
                    {
                        "id": "SOA",
                        "question": "Valid answer question",
                        "expected_outcome": "in_scope_answerable",
                    },
                    {
                        "id": "SOB",
                        "question": "No data question",
                        "expected_outcome": "in_scope_no_data",
                    },
                    {
                        "id": "SOC",
                        "question": "Unsupported question",
                        "expected_outcome": "out_of_scope",
                    },
                    {
                        "id": "SOD",
                        "question": "Clarify this question",
                        "expected_outcome": "in_scope_ambiguous",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    run_dir = tmp_path / "results" / "run-1"

    monkeypatch.setattr(run_mod, "WebsiteChatClient", _FakeClient)
    monkeypatch.setattr(run_mod, "_build_run_id", lambda: "run-1")
    monkeypatch.setenv("OPENAIP_WEBSITE_BASE_URL", "http://localhost:3000")

    argv = [
        "run_scope_outcome_check.py",
        "--input",
        str(input_path),
        "--out-root",
        str(tmp_path / "results"),
    ]
    monkeypatch.setattr(run_mod.sys, "argv", argv)

    code = run_mod.main()
    assert code == 0
    assert (run_dir / "summary.json").exists()
    assert (run_dir / "detailed.csv").exists()
    assert (run_dir / "mismatches.csv").exists()

    summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
    assert summary["total"] == 4
    assert summary["pass"] == 4
    assert summary["counts"]["instrumentation_error_count"] == 0
