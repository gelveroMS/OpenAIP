from __future__ import annotations

import json
from pathlib import Path

from eval.lib.strategy_io import load_and_validate_strategy_cases, load_strategy_profiles


def test_load_and_validate_strategy_cases(tmp_path: Path) -> None:
    schema_path = Path(__file__).resolve().parents[1] / "schema" / "chat-strategy.schema.json"
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
    input_path = tmp_path / "cases.jsonl"
    input_path.write_text(json.dumps(case) + "\n", encoding="utf-8")

    cases = load_and_validate_strategy_cases(input_path=input_path, schema_path=schema_path)
    assert len(cases) == 1
    assert cases[0].id == "S0001"
    assert cases[0].expected.expected_route_family == "sql_totals"


def test_load_strategy_profiles(tmp_path: Path) -> None:
    path = tmp_path / "profiles.json"
    path.write_text(
        json.dumps({"baseline": {"CHAT_CONTEXTUAL_REWRITE_ENABLED": False}}),
        encoding="utf-8",
    )

    profiles = load_strategy_profiles(path)
    assert "baseline" in profiles
    assert profiles["baseline"].flags["CHAT_CONTEXTUAL_REWRITE_ENABLED"] is False
