from __future__ import annotations

import json
from pathlib import Path

from eval import run_strategy_regression as run_mod


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
        return _FakeHttpResult(
            {
                "sessionId": "session-1",
                "status": "answer",
                "assistantMessage": {
                    "retrievalMeta": {
                        "routeFamily": "sql_totals",
                        "queryPlanMode": "structured_only",
                        "queryRewriteApplied": False,
                        "verifierMode": "structured",
                        "responseModeReasonCode": "full_answer",
                        "verifierPolicyReasonCode": "structured_match",
                        "semanticRetrievalAttempted": False,
                    }
                },
            }
        )


def test_run_strategy_regression_writes_artifacts(tmp_path: Path, monkeypatch) -> None:
    case = {
        "id": "S0001",
        "category": "structured_only",
        "conversation_id": None,
        "turn_index": 1,
        "question": "What is the total health budget for 2024?",
        "expected": {
            "expected_planner_mode": "structured_only",
            "expected_route_family": "sql_totals",
            "expected_rewrite": False,
            "expected_response_mode": "full",
            "expected_verifier_mode": "structured",
            "semantic_retrieval_expected": False,
            "multi_query_allowed": False,
            "expected_status": "answer",
        },
    }

    schema_path = Path(__file__).resolve().parents[1] / "schema" / "chat-strategy.schema.json"
    input_path = tmp_path / "cases.jsonl"
    input_path.write_text(json.dumps(case) + "\n", encoding="utf-8")

    run_dir = tmp_path / "results" / "run-1"
    run_dir.mkdir(parents=True)

    monkeypatch.setattr(run_mod, "WebsiteChatClient", _FakeClient)
    monkeypatch.setattr(run_mod, "ensure_run_dir", lambda *_args, **_kwargs: run_dir)
    monkeypatch.setattr(run_mod, "sha256_file", lambda *_args, **_kwargs: "deadbeef")
    monkeypatch.setattr(run_mod, "build_run_id", lambda *_args, **_kwargs: "20260306-000000-deadbeef")
    monkeypatch.setenv("OPENAIP_WEBSITE_BASE_URL", "http://localhost:3000")

    argv = [
        "run_strategy_regression.py",
        "--input",
        str(input_path),
        "--schema",
        str(schema_path),
    ]
    monkeypatch.setattr(run_mod.sys, "argv", argv)

    code = run_mod.main()
    assert code == 0
    assert (run_dir / "summary.json").exists()
    assert (run_dir / "detailed.jsonl").exists()
    assert (run_dir / "failures.jsonl").exists()
