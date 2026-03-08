from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    from jsonschema import Draft202012Validator
except ModuleNotFoundError:  # pragma: no cover - exercised in environments without jsonschema
    Draft202012Validator = None  # type: ignore[assignment]

from eval.lib.strategy_types import StrategyCase, StrategyExpected, StrategyProfile


def load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"File not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON file {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"Expected JSON object in {path}")
    return payload


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise RuntimeError(f"Questions file not found: {path}")

    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, raw_line in enumerate(handle, start=1):
            line = raw_line.rstrip("\n\r")
            if line.strip() == "":
                raise RuntimeError(f"Blank line detected at line {line_no}; blank lines are not allowed.")
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"Invalid JSON at line {line_no}: {exc}") from exc
            if not isinstance(parsed, dict):
                raise RuntimeError(f"Line {line_no} is not a JSON object")
            records.append(parsed)
    return records


def validate_schema(records: list[dict[str, Any]], schema: dict[str, Any]) -> None:
    if Draft202012Validator is None:
        # Minimal fallback validation for environments that do not install optional deps.
        required_top = {"id", "category", "turn_index", "question", "expected"}
        required_expected = {"semantic_retrieval_expected", "multi_query_allowed"}
        for line_no, obj in enumerate(records, start=1):
            missing_top = sorted(required_top - obj.keys())
            if missing_top:
                raise RuntimeError(
                    f"Schema validation failed at line {line_no}: missing required fields {missing_top}."
                )
            expected = obj.get("expected")
            if not isinstance(expected, dict):
                raise RuntimeError(f"Schema validation failed at line {line_no}: expected must be an object.")
            missing_expected = sorted(required_expected - expected.keys())
            if missing_expected:
                raise RuntimeError(
                    f"Schema validation failed at line {line_no}, field expected: missing {missing_expected}."
                )
        return

    validator = Draft202012Validator(schema)
    for line_no, obj in enumerate(records, start=1):
        errors = sorted(validator.iter_errors(obj), key=lambda err: list(err.absolute_path))
        if errors:
            err = errors[0]
            path = ".".join(str(part) for part in err.absolute_path) or "<root>"
            raise RuntimeError(f"Schema validation failed at line {line_no}, field {path}: {err.message}")


def to_strategy_cases(records: list[dict[str, Any]]) -> list[StrategyCase]:
    cases: list[StrategyCase] = []
    for record in records:
        expected = record.get("expected") or {}
        if not isinstance(expected, dict):
            raise RuntimeError(f"Case {record.get('id')} missing expected object")

        cases.append(
            StrategyCase(
                id=str(record["id"]),
                category=str(record["category"]),
                conversation_id=(
                    str(record["conversation_id"])
                    if record.get("conversation_id") not in {None, ""}
                    else None
                ),
                turn_index=int(record["turn_index"]),
                question=str(record["question"]),
                expected=StrategyExpected(
                    expected_planner_mode=(
                        str(expected["expected_planner_mode"])
                        if expected.get("expected_planner_mode") is not None
                        else None
                    ),
                    expected_route_family=(
                        str(expected["expected_route_family"])
                        if expected.get("expected_route_family") is not None
                        else None
                    ),
                    expected_rewrite=(
                        bool(expected["expected_rewrite"])
                        if expected.get("expected_rewrite") is not None
                        else None
                    ),
                    expected_response_mode=(
                        str(expected["expected_response_mode"])
                        if expected.get("expected_response_mode") is not None
                        else None
                    ),
                    expected_verifier_mode=(
                        str(expected["expected_verifier_mode"])
                        if expected.get("expected_verifier_mode") is not None
                        else None
                    ),
                    semantic_retrieval_expected=bool(expected["semantic_retrieval_expected"]),
                    multi_query_allowed=bool(expected["multi_query_allowed"]),
                    expected_status=(
                        str(expected["expected_status"])
                        if expected.get("expected_status") is not None
                        else None
                    ),
                ),
            )
        )
    return cases


def load_and_validate_strategy_cases(
    *,
    input_path: Path,
    schema_path: Path,
) -> list[StrategyCase]:
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    if not isinstance(schema, dict):
        raise RuntimeError("Strategy schema must be a JSON object")

    records = load_jsonl(input_path)
    validate_schema(records, schema)

    return to_strategy_cases(records)


def load_strategy_profiles(path: Path) -> dict[str, StrategyProfile]:
    payload = load_json(path)
    profiles: dict[str, StrategyProfile] = {}
    for name, value in payload.items():
        if not isinstance(value, dict):
            raise RuntimeError(f"Profile '{name}' must map to object of flag booleans")
        flags: dict[str, bool] = {}
        for flag_name, flag_value in value.items():
            if not isinstance(flag_value, bool):
                raise RuntimeError(f"Profile '{name}' flag '{flag_name}' must be boolean")
            flags[str(flag_name)] = bool(flag_value)
        profiles[str(name)] = StrategyProfile(name=str(name), flags=flags)
    return profiles
