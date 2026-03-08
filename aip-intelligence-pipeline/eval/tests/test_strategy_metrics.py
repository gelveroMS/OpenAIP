from __future__ import annotations

from eval.lib.strategy_metrics import (
    build_strategy_summary,
    evaluate_strategy_result,
    extract_strategy_observed,
)
from eval.lib.strategy_types import StrategyCase, StrategyEvalResult, StrategyExpected, StrategyObserved


def _case(**overrides) -> StrategyCase:
    expected = StrategyExpected(
        expected_planner_mode="structured_only",
        expected_route_family="sql_totals",
        expected_rewrite=False,
        expected_response_mode="full",
        expected_verifier_mode="structured",
        semantic_retrieval_expected=False,
        multi_query_allowed=False,
        expected_status="answer",
    )
    return StrategyCase(
        id="S0001",
        category="structured_only",
        conversation_id=None,
        turn_index=1,
        question="Total for 2024?",
        expected=overrides.get("expected", expected),
    )


def _result(observed: StrategyObserved) -> StrategyEvalResult:
    return StrategyEvalResult(
        id="S0001",
        request={"question": "Total for 2024?"},
        response={"http_status": 200, "json_body": {}},
        observed=observed,
        pass_fail=False,
        mismatch_categories=[],
        errors=[],
        timing_ms=10.0,
        attempts=1,
    )


def test_extract_strategy_observed_tracks_semantic_attempted_and_multi_query() -> None:
    observed = extract_strategy_observed(
        {
            "status": "answer",
            "assistantMessage": {
                "retrievalMeta": {
                    "routeFamily": "pipeline_fallback",
                    "queryRewriteApplied": False,
                    "verifierMode": "retrieval",
                    "semanticRetrievalAttempted": True,
                    "selectiveMultiQueryTriggered": True,
                    "generationSkippedByGate": False,
                }
            },
        }
    )
    assert observed.semantic_retrieval_attempted is True
    assert observed.multi_query_triggered is True


def test_evaluate_strategy_result_detects_route_mismatch() -> None:
    case = _case()
    observed = StrategyObserved(
        status="answer",
        planner_mode="structured_only",
        route_family="unknown",
        rewrite_applied=False,
        response_mode="full",
        verifier_mode="structured",
        semantic_retrieval_attempted=False,
        multi_query_triggered=False,
        generation_skipped_by_gate=False,
        rewrite_reason_code=None,
        planner_reason_code=None,
        response_mode_reason_code=None,
        verifier_policy_reason_code=None,
    )
    evaluated = evaluate_strategy_result(case, _result(observed))
    assert evaluated.pass_fail is False
    assert "route_mismatch" in evaluated.mismatch_categories


def test_build_strategy_summary_counts_instrumentation_warnings() -> None:
    case = _case()
    observed = StrategyObserved(
        status="answer",
        planner_mode="structured_only",
        route_family="unknown",
        rewrite_applied=False,
        response_mode="full",
        verifier_mode="structured",
        semantic_retrieval_attempted=False,
        multi_query_triggered=False,
        generation_skipped_by_gate=True,
        rewrite_reason_code="no_rewrite_standalone",
        planner_reason_code=None,
        response_mode_reason_code=None,
        verifier_policy_reason_code="structured_match",
    )
    evaluated = evaluate_strategy_result(case, _result(observed))
    summary = build_strategy_summary([case], [evaluated])

    assert summary["instrumentation_warnings"]["unknown_route_family_count"] == 1
    assert summary["reporting"]["generation_skipped_by_gate_count"] == 1
