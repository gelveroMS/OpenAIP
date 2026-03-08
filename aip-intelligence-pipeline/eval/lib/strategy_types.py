from __future__ import annotations

from dataclasses import dataclass
from typing import Any


RouteFamily = str
PlannerMode = str
ResponseMode = str
VerifierMode = str


@dataclass(frozen=True)
class StrategyExpected:
    expected_planner_mode: PlannerMode | None
    expected_route_family: RouteFamily | None
    expected_rewrite: bool | None
    expected_response_mode: ResponseMode | None
    expected_verifier_mode: VerifierMode | None
    semantic_retrieval_expected: bool
    multi_query_allowed: bool
    expected_status: str | None


@dataclass(frozen=True)
class StrategyCase:
    id: str
    category: str
    conversation_id: str | None
    turn_index: int
    question: str
    expected: StrategyExpected


@dataclass
class StrategyObserved:
    status: str | None
    planner_mode: str | None
    route_family: str | None
    rewrite_applied: bool | None
    response_mode: str | None
    verifier_mode: str | None
    semantic_retrieval_attempted: bool
    multi_query_triggered: bool
    generation_skipped_by_gate: bool
    rewrite_reason_code: str | None
    planner_reason_code: str | None
    response_mode_reason_code: str | None
    verifier_policy_reason_code: str | None


@dataclass
class StrategyEvalResult:
    id: str
    request: dict[str, Any]
    response: dict[str, Any]
    observed: StrategyObserved
    pass_fail: bool
    mismatch_categories: list[str]
    errors: list[str]
    timing_ms: float
    attempts: int


@dataclass(frozen=True)
class StrategyProfile:
    name: str
    flags: dict[str, bool]
