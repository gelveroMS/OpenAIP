from __future__ import annotations

from typing import Any
from urllib.error import HTTPError, URLError

import pytest

from openaip_pipeline.adapters.supabase.repositories import PipelineRepository, ProgressTrackingReadinessError


class _SelectErrorClient:
    def __init__(self, error: Exception):
        self.error = error

    def select(
        self,
        table: str,
        *,
        select: str,
        filters: dict[str, str] | None = None,
        order: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        del table, select, filters, order, limit
        raise self.error


def _http_error(*, code: int, msg: str = "Error", payload: dict[str, Any] | None = None) -> HTTPError:
    error = HTTPError(
        url="https://example.supabase.co/rest/v1/extraction_runs",
        code=code,
        msg=msg,
        hdrs=None,
        fp=None,
    )
    if payload is not None:
        setattr(error, "supabase_error_payload", payload)
    return error


def test_progress_readiness_classifies_missing_columns() -> None:
    payload = {
        "code": "42703",
        "message": 'column extraction_runs.overall_progress_pct does not exist',
        "details": None,
        "hint": None,
    }
    source_error = _http_error(code=400, msg="Bad Request", payload=payload)
    repo = PipelineRepository(_SelectErrorClient(source_error))  # type: ignore[arg-type]

    with pytest.raises(ProgressTrackingReadinessError) as error_info:
        repo.assert_progress_tracking_ready()

    error = error_info.value
    assert error.reason_code == "PROGRESS_COLUMNS_MISSING"
    assert error.retryable is False
    assert "2026-02-19_extraction_run_progress.sql" in str(error)
    assert error.__cause__ is source_error


@pytest.mark.parametrize("status_code", [401, 403])
def test_progress_readiness_classifies_auth_errors(status_code: int) -> None:
    source_error = _http_error(code=status_code, msg="Unauthorized")
    repo = PipelineRepository(_SelectErrorClient(source_error))  # type: ignore[arg-type]

    with pytest.raises(ProgressTrackingReadinessError) as error_info:
        repo.assert_progress_tracking_ready()

    error = error_info.value
    assert error.reason_code == "SUPABASE_AUTH_FAILED"
    assert error.retryable is False
    assert "SUPABASE_SERVICE_KEY" in str(error)


@pytest.mark.parametrize("status_code", [504, 522])
def test_progress_readiness_classifies_retryable_http_failures(status_code: int) -> None:
    source_error = _http_error(code=status_code, msg="Gateway Timeout")
    repo = PipelineRepository(_SelectErrorClient(source_error))  # type: ignore[arg-type]

    with pytest.raises(ProgressTrackingReadinessError) as error_info:
        repo.assert_progress_tracking_ready()

    error = error_info.value
    assert error.reason_code == "SUPABASE_API_UNAVAILABLE"
    assert error.retryable is True
    assert f"HTTP {status_code}" in str(error)


def test_progress_readiness_classifies_timeout_errors() -> None:
    source_error = TimeoutError("The read operation timed out")
    repo = PipelineRepository(_SelectErrorClient(source_error))  # type: ignore[arg-type]

    with pytest.raises(ProgressTrackingReadinessError) as error_info:
        repo.assert_progress_tracking_ready()

    error = error_info.value
    assert error.reason_code == "SUPABASE_API_TIMEOUT"
    assert error.retryable is True


def test_progress_readiness_classifies_network_errors() -> None:
    source_error = URLError("[Errno -2] Name or service not known")
    repo = PipelineRepository(_SelectErrorClient(source_error))  # type: ignore[arg-type]

    with pytest.raises(ProgressTrackingReadinessError) as error_info:
        repo.assert_progress_tracking_ready()

    error = error_info.value
    assert error.reason_code == "SUPABASE_NETWORK_ERROR"
    assert error.retryable is True
