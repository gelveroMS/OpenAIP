from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from eval.lib.strategy_metrics import strategy_result_to_row
from eval.lib.strategy_types import StrategyCase, StrategyEvalResult


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def build_strategy_summary_payload(
    *,
    summary_metrics: dict[str, Any],
    run_id: str,
    command_used: str,
    base_url: str | None,
    auth_mode: str,
    input_path: str,
    input_sha256: str,
    total_cases: int,
    profile_name: str | None,
    profile_flags: dict[str, bool] | None,
) -> dict[str, Any]:
    return {
        "run": {
            "run_id": run_id,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "command": command_used,
            "base_url": base_url,
            "auth_mode": auth_mode,
            "input_path": input_path,
            "input_sha256": input_sha256,
            "total_cases": total_cases,
            "profile_name": profile_name,
            "profile_flags": profile_flags or {},
        },
        **summary_metrics,
    }


def write_strategy_artifacts(
    *,
    run_dir: Path,
    cases: list[StrategyCase],
    results: list[StrategyEvalResult],
    summary_payload: dict[str, Any],
    command_used: str,
    base_url: str | None,
    auth_mode: str,
    input_path: str,
    input_sha256: str,
) -> None:
    case_map = {case.id: case for case in cases}
    detailed_rows = [strategy_result_to_row(case_map[result.id], result) for result in results]
    failures = [row for row in detailed_rows if not row["pass"]]

    write_json(run_dir / "summary.json", summary_payload)
    _write_summary_csv(run_dir / "summary.csv", cases, results)
    write_jsonl(run_dir / "detailed.jsonl", detailed_rows)
    write_jsonl(run_dir / "failures.jsonl", failures)
    _write_readme(
        path=run_dir / "README.md",
        command_used=command_used,
        base_url=base_url,
        auth_mode=auth_mode,
        input_path=input_path,
        input_sha256=input_sha256,
    )


def _write_summary_csv(path: Path, cases: list[StrategyCase], results: list[StrategyEvalResult]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    case_map = {case.id: case for case in cases}
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "id",
                "category",
                "expected_route_family",
                "observed_route_family",
                "expected_response_mode",
                "observed_response_mode",
                "expected_verifier_mode",
                "observed_verifier_mode",
                "semantic_retrieval_expected",
                "semantic_retrieval_attempted",
                "multi_query_triggered",
                "pass",
                "timing_ms",
            ],
        )
        writer.writeheader()
        for result in results:
            case = case_map[result.id]
            writer.writerow(
                {
                    "id": result.id,
                    "category": case.category,
                    "expected_route_family": case.expected.expected_route_family,
                    "observed_route_family": result.observed.route_family,
                    "expected_response_mode": case.expected.expected_response_mode,
                    "observed_response_mode": result.observed.response_mode,
                    "expected_verifier_mode": case.expected.expected_verifier_mode,
                    "observed_verifier_mode": result.observed.verifier_mode,
                    "semantic_retrieval_expected": str(case.expected.semantic_retrieval_expected).lower(),
                    "semantic_retrieval_attempted": str(result.observed.semantic_retrieval_attempted).lower(),
                    "multi_query_triggered": str(result.observed.multi_query_triggered).lower(),
                    "pass": str(result.pass_fail).lower(),
                    "timing_ms": f"{result.timing_ms:.2f}",
                }
            )


def _write_readme(
    *,
    path: Path,
    command_used: str,
    base_url: str | None,
    auth_mode: str,
    input_path: str,
    input_sha256: str,
) -> None:
    lines = [
        "# Strategy Regression Run Artifact",
        "",
        "## Reproduce",
        "",
        "```powershell",
        command_used,
        "```",
        "",
        "## Run Context",
        "",
        f"- Input path: `{input_path}`",
        f"- Input SHA256: `{input_sha256}`",
        f"- Base URL: `{base_url or 'N/A (dry-run)'}`",
        f"- Auth mode: `{auth_mode}`",
        "",
        "## Notes",
        "",
        "- Unknown route families are tracked as instrumentation warnings.",
        "- This runner compares operational strategy fields, not natural-language output similarity.",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
