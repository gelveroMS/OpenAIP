from __future__ import annotations

import json
from typing import Any, Callable, TypeVar


T = TypeVar("T")


def estimate_tokens_from_text(text: str) -> int:
    if not text:
        return 0
    return max(1, (len(text.encode("utf-8")) + 3) // 4)


def estimate_tokens_from_json(payload: Any) -> int:
    return estimate_tokens_from_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    )


def chunk_items_by_token_budget(
    *,
    items: list[T],
    static_payload: dict[str, Any],
    add_item_fn: Callable[[dict[str, Any], list[T]], dict[str, Any]],
    budget_tokens: int,
    max_items_per_chunk: int | None = None,
) -> list[list[T]]:
    if budget_tokens <= 0:
        raise ValueError("budget_tokens must be >= 1")
    if max_items_per_chunk is not None and max_items_per_chunk <= 0:
        raise ValueError("max_items_per_chunk must be >= 1 when provided")
    if not items:
        return []

    chunks: list[list[T]] = []
    current: list[T] = []

    for item in items:
        candidate = [*current, item]
        if max_items_per_chunk is not None and len(candidate) > max_items_per_chunk:
            if current:
                chunks.append(current)
            current = [item]
            continue

        candidate_payload = add_item_fn(static_payload, candidate)
        candidate_tokens = estimate_tokens_from_json(candidate_payload)
        if not current or candidate_tokens <= budget_tokens:
            current = candidate
            continue

        chunks.append(current)
        current = [item]

    if current:
        chunks.append(current)
    return chunks


def is_context_limit_error(error: Exception) -> bool:
    code = str(getattr(error, "code", "") or "").lower()
    if code and "context" in code:
        return True
    message = str(error).lower()
    return any(
        marker in message
        for marker in (
            "context length",
            "maximum context length",
            "context window",
            "too many tokens",
        )
    )


def sum_usage(usages: list[dict[str, Any]]) -> dict[str, int | None]:
    def _sum_key(key: str) -> int | None:
        values = [usage.get(key) for usage in usages if isinstance(usage.get(key), int)]
        return sum(values) if values else None

    return {
        "input_tokens": _sum_key("input_tokens"),
        "output_tokens": _sum_key("output_tokens"),
        "total_tokens": _sum_key("total_tokens"),
    }
