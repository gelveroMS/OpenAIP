from __future__ import annotations

from collections import Counter
from dataclasses import asdict
from typing import Any

from eval.lib.strategy_types import StrategyCase, StrategyEvalResult, StrategyObserved


def _as_str(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    return None


def _derive_response_mode(status: str | None, retrieval_meta: dict[str, Any] | None) -> str | None:
    mixed_mode = _as_str((retrieval_meta or {}).get("mixedResponseMode"))
    if mixed_mode in {"full", "partial", "clarify", "refuse"}:
        return mixed_mode

    if status == "clarification":
        return "clarify"
    if status == "refusal":
        return "refuse"

    reason = _as_str((retrieval_meta or {}).get("reason"))
    if reason == "partial_evidence":
        return "partial"
    if status == "answer":
        return "full"
    return None


def _infer_semantic_attempted(route_family: str | None, retrieval_meta: dict[str, Any] | None) -> bool:
    explicit = _as_bool((retrieval_meta or {}).get("semanticRetrievalAttempted"))
    if explicit is not None:
        return explicit

    if route_family in {"pipeline_fallback", "mixed_plan"}:
        return True

    telemetry_keys = [
        "denseCandidateCount",
        "keywordCandidateCount",
        "fusedCandidateCount",
        "evidenceGateDecision",
        "selectiveMultiQueryTriggered",
    ]
    return any((retrieval_meta or {}).get(key) is not None for key in telemetry_keys)


def extract_strategy_observed(response_json: dict[str, Any] | None) -> StrategyObserved:
    if not response_json:
        return StrategyObserved(
            status=None,
            planner_mode=None,
            route_family=None,
            rewrite_applied=None,
            response_mode=None,
            verifier_mode=None,
            semantic_retrieval_attempted=False,
            multi_query_triggered=False,
            generation_skipped_by_gate=False,
            rewrite_reason_code=None,
            planner_reason_code=None,
            response_mode_reason_code=None,
            verifier_policy_reason_code=None,
        )

    status = _as_str(response_json.get("status"))
    assistant = response_json.get("assistantMessage")
    retrieval_meta: dict[str, Any] | None = None
    if isinstance(assistant, dict):
        candidate = assistant.get("retrievalMeta")
        if isinstance(candidate, dict):
            retrieval_meta = candidate

    if status is None:
        status = _as_str((retrieval_meta or {}).get("status"))

    route_family = _as_str((retrieval_meta or {}).get("routeFamily"))
    rewrite_applied = _as_bool((retrieval_meta or {}).get("queryRewriteApplied"))
    planner_mode = _as_str((retrieval_meta or {}).get("queryPlanMode"))
    response_mode = _derive_response_mode(status, retrieval_meta)
    verifier_mode = _as_str((retrieval_meta or {}).get("verifierMode"))

    multi_query_triggered = bool((retrieval_meta or {}).get("selectiveMultiQueryTriggered") is True)
    generation_skipped_by_gate = bool((retrieval_meta or {}).get("generationSkippedByGate") is True)

    semantic_retrieval_attempted = _infer_semantic_attempted(route_family, retrieval_meta)

    return StrategyObserved(
        status=status,
        planner_mode=planner_mode,
        route_family=route_family,
        rewrite_applied=rewrite_applied,
        response_mode=response_mode,
        verifier_mode=verifier_mode,
        semantic_retrieval_attempted=semantic_retrieval_attempted,
        multi_query_triggered=multi_query_triggered,
        generation_skipped_by_gate=generation_skipped_by_gate,
        rewrite_reason_code=_as_str((retrieval_meta or {}).get("rewriteReasonCode")),
        planner_reason_code=_as_str((retrieval_meta or {}).get("plannerReasonCode")),
        response_mode_reason_code=_as_str((retrieval_meta or {}).get("responseModeReasonCode")),
        verifier_policy_reason_code=_as_str((retrieval_meta or {}).get("verifierPolicyReasonCode")),
    )


def evaluate_strategy_result(case: StrategyCase, result: StrategyEvalResult) -> StrategyEvalResult:
    expected = case.expected
    observed = result.observed

    errors: list[str] = []
    mismatches: list[str] = []

    if expected.expected_planner_mode is not None and observed.planner_mode != expected.expected_planner_mode:
        errors.append(
            f"Planner mode mismatch: expected '{expected.expected_planner_mode}', observed '{observed.planner_mode}'."
        )
        mismatches.append("planner_mode_mismatch")

    if expected.expected_route_family is not None and observed.route_family != expected.expected_route_family:
        errors.append(
            f"Route family mismatch: expected '{expected.expected_route_family}', observed '{observed.route_family}'."
        )
        mismatches.append("route_mismatch")

    if expected.expected_rewrite is not None and observed.rewrite_applied != expected.expected_rewrite:
        errors.append(
            f"Rewrite mismatch: expected '{expected.expected_rewrite}', observed '{observed.rewrite_applied}'."
        )
        mismatches.append("rewrite_mismatch")

    if expected.expected_response_mode is not None and observed.response_mode != expected.expected_response_mode:
        errors.append(
            f"Response mode mismatch: expected '{expected.expected_response_mode}', observed '{observed.response_mode}'."
        )
        mismatches.append("clarify_refuse_mismatch")

    if expected.expected_verifier_mode is not None and observed.verifier_mode != expected.expected_verifier_mode:
        errors.append(
            f"Verifier mode mismatch: expected '{expected.expected_verifier_mode}', observed '{observed.verifier_mode}'."
        )
        mismatches.append("verifier_mode_mismatch")

    if expected.expected_status is not None and observed.status != expected.expected_status:
        errors.append(
            f"Status mismatch: expected '{expected.expected_status}', observed '{observed.status}'."
        )
        mismatches.append("status_mismatch")

    if observed.semantic_retrieval_attempted != expected.semantic_retrieval_expected:
        errors.append(
            "Semantic retrieval mismatch: "
            f"expected attempted={expected.semantic_retrieval_expected}, observed attempted={observed.semantic_retrieval_attempted}."
        )
        mismatches.append("semantic_retrieval_mismatch")

    if not expected.multi_query_allowed and observed.multi_query_triggered:
        errors.append("Multi-query triggered but expected multi_query_allowed=false.")
        mismatches.append("multi_query_overuse")

    result.errors = errors
    result.mismatch_categories = mismatches
    result.pass_fail = len(errors) == 0
    return result


def build_strategy_summary(cases: list[StrategyCase], results: list[StrategyEvalResult]) -> dict[str, Any]:
    total = len(results)
    pass_count = sum(1 for result in results if result.pass_fail)
    fail_count = total - pass_count

    mismatch_counter: Counter[str] = Counter()
    category_counter: Counter[str] = Counter()
    failures_by_category: Counter[str] = Counter()

    case_by_id = {case.id: case for case in cases}
    for result in results:
        case = case_by_id[result.id]
        category_counter[case.category] += 1
        if not result.pass_fail:
            failures_by_category[case.category] += 1
        mismatch_counter.update(result.mismatch_categories)

    unknown_route_family_count = sum(1 for result in results if result.observed.route_family == "unknown")
    missing_route_family_count = sum(1 for result in results if result.observed.route_family is None)
    missing_reason_code_count = sum(
        1
        for result in results
        if (
            result.observed.response_mode_reason_code is None
            or result.observed.verifier_policy_reason_code is None
        )
    )

    semantic_expected_count = sum(1 for case in cases if case.expected.semantic_retrieval_expected)
    semantic_attempted_count = sum(1 for result in results if result.observed.semantic_retrieval_attempted)
    route_labeled_cases = [
        (case, result)
        for case, result in zip(cases, results, strict=False)
        if case.expected.expected_route_family is not None
    ]
    route_match_count = sum(
        1
        for case, result in route_labeled_cases
        if result.observed.route_family == case.expected.expected_route_family
        and result.observed.route_family != "unknown"
    )
    route_unknown_count = sum(
        1 for _case, result in route_labeled_cases if result.observed.route_family == "unknown"
    )

    return {
        "totals": {
            "total_case_count": total,
            "pass_count": pass_count,
            "fail_count": fail_count,
            "pass_rate": (pass_count / total) if total else 0.0,
        },
        "reporting": {
            "failures_by_category": dict(failures_by_category),
            "mismatch_counts": dict(mismatch_counter),
            "route_mismatch_count": mismatch_counter.get("route_mismatch", 0),
            "rewrite_mismatch_count": mismatch_counter.get("rewrite_mismatch", 0),
            "planner_mode_mismatch_count": mismatch_counter.get("planner_mode_mismatch", 0),
            "clarify_refuse_mismatch_count": mismatch_counter.get("clarify_refuse_mismatch", 0),
            "verifier_mode_mismatch_count": mismatch_counter.get("verifier_mode_mismatch", 0),
            "generation_skipped_by_gate_count": sum(
                1 for result in results if result.observed.generation_skipped_by_gate
            ),
            "mixed_plan_count": sum(1 for result in results if result.observed.planner_mode == "mixed"),
            "multi_query_trigger_count": sum(
                1 for result in results if result.observed.multi_query_triggered
            ),
            "semantic_retrieval_expected_count": semantic_expected_count,
            "semantic_retrieval_attempted_count": semantic_attempted_count,
        },
        "route_accuracy": {
            "labeled_case_count": len(route_labeled_cases),
            "match_count_excluding_unknown": route_match_count,
            "unknown_observed_count": route_unknown_count,
            "match_rate_excluding_unknown": (
                (route_match_count / len(route_labeled_cases)) if route_labeled_cases else 0.0
            ),
        },
        "instrumentation_warnings": {
            "unknown_route_family_count": unknown_route_family_count,
            "missing_route_family_count": missing_route_family_count,
            "missing_reason_code_count": missing_reason_code_count,
        },
        "category_counts": dict(category_counter),
    }


def strategy_result_to_row(case: StrategyCase, result: StrategyEvalResult) -> dict[str, Any]:
    return {
        "id": result.id,
        "category": case.category,
        "conversation_id": case.conversation_id,
        "turn_index": case.turn_index,
        "question": case.question,
        "expected": asdict(case.expected),
        "request": result.request,
        "response": result.response,
        "observed": asdict(result.observed),
        "pass": result.pass_fail,
        "mismatch_categories": result.mismatch_categories,
        "errors": result.errors,
        "timing_ms": result.timing_ms,
        "attempts": result.attempts,
    }
