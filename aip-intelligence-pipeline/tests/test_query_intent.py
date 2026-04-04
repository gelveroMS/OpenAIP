from __future__ import annotations

from openaip_pipeline.services.query_intent import detect_exhaustive_intent


def test_detect_exhaustive_intent_positive_with_synonym() -> None:
    detected = detect_exhaustive_intent("Show every project for Barangay Mamatid.")
    assert detected["is_list_query"] is True
    assert detected["exhaustive_intent"] is True
    assert detected["exhaustive_signal"] == "every"


def test_detect_exhaustive_intent_positive_with_typo() -> None:
    detected = detect_exhaustive_intent("Show evry projects where fund source is GAD fund.")
    assert detected["is_list_query"] is True
    assert detected["exhaustive_intent"] is True
    assert detected["exhaustive_signal"] == "evry"


def test_detect_exhaustive_intent_negative_for_top_query() -> None:
    detected = detect_exhaustive_intent("Show top 5 projects for FY 2025.")
    assert detected["is_list_query"] is True
    assert detected["exhaustive_intent"] is False
    assert detected["exhaustive_signal"] is None
