from __future__ import annotations

import json
from pathlib import Path

import pytest

from eval import compare_strategy_runs as compare_mod


def test_compare_strategy_runs_outputs_delta(tmp_path: Path, monkeypatch, capsys) -> None:
    base = {
        "totals": {"pass_rate": 0.5, "fail_count": 5},
        "reporting": {
            "route_mismatch_count": 3,
            "rewrite_mismatch_count": 2,
            "planner_mode_mismatch_count": 1,
            "clarify_refuse_mismatch_count": 2,
            "verifier_mode_mismatch_count": 1,
            "generation_skipped_by_gate_count": 4,
            "mixed_plan_count": 3,
            "multi_query_trigger_count": 2,
            "semantic_retrieval_attempted_count": 8,
        },
        "instrumentation_warnings": {"unknown_route_family_count": 2},
    }
    candidate = {
        "totals": {"pass_rate": 0.7, "fail_count": 3},
        "reporting": {
            "route_mismatch_count": 1,
            "rewrite_mismatch_count": 1,
            "planner_mode_mismatch_count": 1,
            "clarify_refuse_mismatch_count": 1,
            "verifier_mode_mismatch_count": 1,
            "generation_skipped_by_gate_count": 2,
            "mixed_plan_count": 4,
            "multi_query_trigger_count": 3,
            "semantic_retrieval_attempted_count": 10,
        },
        "instrumentation_warnings": {"unknown_route_family_count": 1},
    }

    base_path = tmp_path / "base.json"
    candidate_path = tmp_path / "candidate.json"
    base_path.write_text(json.dumps(base), encoding="utf-8")
    candidate_path.write_text(json.dumps(candidate), encoding="utf-8")

    monkeypatch.setattr(
        compare_mod.sys,
        "argv",
        [
            "compare_strategy_runs.py",
            "--base",
            str(base_path),
            "--candidate",
            str(candidate_path),
        ],
    )

    code = compare_mod.main()
    assert code == 0
    out = capsys.readouterr().out
    payload = json.loads(out)
    assert payload["metric_deltas"]["pass_rate"]["delta"] == pytest.approx(0.2)
    assert payload["metric_deltas"]["unknown_route_family_count"]["delta"] == -1.0
