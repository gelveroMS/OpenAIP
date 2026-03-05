from __future__ import annotations

from openaip_pipeline.services.chunking.context_window import (
    chunk_items_by_token_budget,
    estimate_tokens_from_json,
    is_context_limit_error,
    sum_usage,
)


def _add_items(payload: dict[str, object], chunk: list[str]) -> dict[str, object]:
    return {**payload, "items": chunk}


def test_chunk_items_by_token_budget_respects_budget_and_cap() -> None:
    items = [f"ITEM-{idx}-" + ("x" * 120) for idx in range(8)]
    static_payload = {"type": "test"}
    budget_tokens = estimate_tokens_from_json(_add_items(static_payload, items[:2])) + 4
    chunks = chunk_items_by_token_budget(
        items=items,
        static_payload=static_payload,
        add_item_fn=_add_items,
        budget_tokens=budget_tokens,
        max_items_per_chunk=3,
    )

    flattened = [item for chunk in chunks for item in chunk]
    assert flattened == items
    assert chunks
    for chunk in chunks:
        assert 1 <= len(chunk) <= 3
        assert estimate_tokens_from_json(_add_items(static_payload, chunk)) <= budget_tokens


def test_context_limit_detection_and_usage_sum() -> None:
    assert is_context_limit_error(RuntimeError("maximum context length exceeded")) is True
    assert is_context_limit_error(RuntimeError("something else")) is False
    assert sum_usage(
        [
            {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5},
            {"input_tokens": 4, "output_tokens": 1, "total_tokens": 5},
        ]
    ) == {"input_tokens": 7, "output_tokens": 3, "total_tokens": 10}
