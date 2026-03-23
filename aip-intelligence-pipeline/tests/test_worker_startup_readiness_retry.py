from __future__ import annotations

from typing import Any

import pytest

from openaip_pipeline.adapters.supabase.repositories import ProgressTrackingReadinessError
from openaip_pipeline.worker.runner import _assert_progress_tracking_ready_with_retries


class _FakeReadyRepo:
    def __init__(self, outcomes: list[Exception | None]):
        self.outcomes = list(outcomes)
        self.calls = 0

    def assert_progress_tracking_ready(self) -> None:
        self.calls += 1
        if self.outcomes:
            result = self.outcomes.pop(0)
            if result is not None:
                raise result


def _retryable_error(reason_code: str = "SUPABASE_API_UNAVAILABLE") -> ProgressTrackingReadinessError:
    return ProgressTrackingReadinessError(
        reason_code=reason_code,
        retryable=True,
        message=f"retryable failure ({reason_code})",
    )


def _non_retryable_error(reason_code: str = "PROGRESS_COLUMNS_MISSING") -> ProgressTrackingReadinessError:
    return ProgressTrackingReadinessError(
        reason_code=reason_code,
        retryable=False,
        message=f"non-retryable failure ({reason_code})",
    )


def test_startup_readiness_retries_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    sleep_calls: list[Any] = []
    monkeypatch.setattr("openaip_pipeline.worker.runner.time.sleep", lambda seconds: sleep_calls.append(seconds))

    repo = _FakeReadyRepo([_retryable_error(), _retryable_error(), None])
    _assert_progress_tracking_ready_with_retries(repo)  # type: ignore[arg-type]

    assert repo.calls == 3
    assert sleep_calls == [2, 4]


def test_startup_readiness_fails_fast_on_non_retryable(monkeypatch: pytest.MonkeyPatch) -> None:
    sleep_calls: list[Any] = []
    monkeypatch.setattr("openaip_pipeline.worker.runner.time.sleep", lambda seconds: sleep_calls.append(seconds))

    expected_error = _non_retryable_error()
    repo = _FakeReadyRepo([expected_error])

    with pytest.raises(ProgressTrackingReadinessError) as error_info:
        _assert_progress_tracking_ready_with_retries(repo)  # type: ignore[arg-type]

    assert error_info.value is expected_error
    assert repo.calls == 1
    assert sleep_calls == []


def test_startup_readiness_retries_then_raises_after_exhaustion(monkeypatch: pytest.MonkeyPatch) -> None:
    sleep_calls: list[Any] = []
    monkeypatch.setattr("openaip_pipeline.worker.runner.time.sleep", lambda seconds: sleep_calls.append(seconds))

    failures = [_retryable_error() for _ in range(4)]
    repo = _FakeReadyRepo(failures)

    with pytest.raises(ProgressTrackingReadinessError) as error_info:
        _assert_progress_tracking_ready_with_retries(repo)  # type: ignore[arg-type]

    assert error_info.value.retryable is True
    assert repo.calls == 4
    assert sleep_calls == [2, 4, 8]
