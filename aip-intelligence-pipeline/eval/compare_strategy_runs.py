from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare two strategy regression summary.json files.")
    parser.add_argument("--base", type=Path, required=True, help="Path to baseline summary.json")
    parser.add_argument("--candidate", type=Path, required=True, help="Path to candidate summary.json")
    parser.add_argument("--output", type=Path, default=None, help="Optional output JSON file")
    return parser.parse_args()


def _load_summary(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"Invalid summary JSON: {path}")
    return payload


def _num(payload: dict[str, Any], path: list[str], default: float = 0.0) -> float:
    current: Any = payload
    for key in path:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
    if isinstance(current, (int, float)):
        return float(current)
    return default


def _delta(base: dict[str, Any], candidate: dict[str, Any], path: list[str]) -> dict[str, float]:
    base_value = _num(base, path)
    candidate_value = _num(candidate, path)
    return {
        "base": base_value,
        "candidate": candidate_value,
        "delta": candidate_value - base_value,
    }


def main() -> int:
    args = parse_args()
    base = _load_summary(args.base)
    candidate = _load_summary(args.candidate)

    metrics = {
        "pass_rate": _delta(base, candidate, ["totals", "pass_rate"]),
        "fail_count": _delta(base, candidate, ["totals", "fail_count"]),
        "route_mismatch_count": _delta(base, candidate, ["reporting", "route_mismatch_count"]),
        "rewrite_mismatch_count": _delta(base, candidate, ["reporting", "rewrite_mismatch_count"]),
        "planner_mode_mismatch_count": _delta(base, candidate, ["reporting", "planner_mode_mismatch_count"]),
        "clarify_refuse_mismatch_count": _delta(base, candidate, ["reporting", "clarify_refuse_mismatch_count"]),
        "verifier_mode_mismatch_count": _delta(base, candidate, ["reporting", "verifier_mode_mismatch_count"]),
        "generation_skipped_by_gate_count": _delta(base, candidate, ["reporting", "generation_skipped_by_gate_count"]),
        "mixed_plan_count": _delta(base, candidate, ["reporting", "mixed_plan_count"]),
        "multi_query_trigger_count": _delta(base, candidate, ["reporting", "multi_query_trigger_count"]),
        "semantic_retrieval_attempted_count": _delta(
            base, candidate, ["reporting", "semantic_retrieval_attempted_count"]
        ),
        "unknown_route_family_count": _delta(
            base, candidate, ["instrumentation_warnings", "unknown_route_family_count"]
        ),
    }

    payload = {
        "base_run": base.get("run", {}),
        "candidate_run": candidate.get("run", {}),
        "metric_deltas": metrics,
    }

    output = json.dumps(payload, ensure_ascii=False, indent=2)
    print(output)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
