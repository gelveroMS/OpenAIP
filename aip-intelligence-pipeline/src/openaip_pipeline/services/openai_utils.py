from __future__ import annotations

import os
from typing import Any

from openai import OpenAI

from openaip_pipeline.core.errors import ConfigurationError


def _read_positive_float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        parsed = float(raw.strip())
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _read_non_negative_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        parsed = int(raw.strip())
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 0 else default


def build_openai_client(api_key: str | None = None) -> OpenAI:
    resolved = (api_key or os.getenv("OPENAI_API_KEY", "")).strip()
    if not resolved:
        raise ConfigurationError("OPENAI_API_KEY not found.")
    timeout_seconds = _read_positive_float_env("PIPELINE_OPENAI_TIMEOUT_SECONDS", 600.0)
    max_retries = _read_non_negative_int_env("PIPELINE_OPENAI_MAX_RETRIES", 3)
    return OpenAI(
        api_key=resolved,
        timeout=timeout_seconds,
        max_retries=max_retries,
    )


def safe_usage_dict(response: Any) -> dict[str, int | None]:
    usage = getattr(response, "usage", None)
    if not usage:
        return {"input_tokens": None, "output_tokens": None, "total_tokens": None}

    def pick(*names: str) -> int | None:
        for name in names:
            if hasattr(usage, name):
                value = getattr(usage, name)
                if isinstance(value, int):
                    return value
        return None

    return {
        "input_tokens": pick("input_tokens", "prompt_tokens"),
        "output_tokens": pick("output_tokens", "completion_tokens"),
        "total_tokens": pick("total_tokens"),
    }

