from __future__ import annotations

import json
import random
import time
from dataclasses import dataclass
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

try:
    import httpx
except ModuleNotFoundError:  # pragma: no cover - exercised in environments without httpx
    httpx = None  # type: ignore[assignment]


@dataclass
class HttpCallResult:
    http_status: int | None
    json_body: dict[str, Any] | None
    raw_text: str | None
    error: str | None
    attempts: int
    timing_ms: float


class WebsiteChatClient:
    def __init__(
        self,
        base_url: str,
        bearer_token: str | None = None,
        cookie_header: str | None = None,
        origin_header: str | None = None,
        referer_header: str | None = None,
        timeout_s: float = 30.0,
        max_retries: int = 6,
        backoff_base_s: float = 0.5,
        backoff_cap_s: float = 8.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self.backoff_base_s = backoff_base_s
        self.backoff_cap_s = backoff_cap_s
        self.timeout_s = timeout_s

        headers = {"Content-Type": "application/json"}
        if bearer_token:
            headers["Authorization"] = f"Bearer {bearer_token}"
        if cookie_header:
            headers["Cookie"] = cookie_header
        if origin_header:
            headers["Origin"] = origin_header
        if referer_header:
            headers["Referer"] = referer_header

        self._headers = headers
        if httpx is not None:
            self._client = httpx.Client(
                timeout=httpx.Timeout(timeout_s),
                headers=headers,
                follow_redirects=True,
            )
        else:
            self._client = None

    def close(self) -> None:
        if self._client is not None:
            self._client.close()

    def __enter__(self) -> "WebsiteChatClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def post_message(self, content: str, session_id: str | None = None) -> HttpCallResult:
        endpoint = f"{self.base_url}/api/barangay/chat/messages"
        payload: dict[str, Any] = {"content": content}
        if session_id:
            payload["sessionId"] = session_id

        started = time.perf_counter()
        last_error: str | None = None

        for attempt in range(1, self.max_retries + 2):
            try:
                status, body, text_body = self._post(endpoint=endpoint, payload=payload)

                if status in {429, 502, 503, 504} and attempt <= self.max_retries:
                    self._sleep_with_backoff(attempt)
                    continue

                return HttpCallResult(
                    http_status=status,
                    json_body=body,
                    raw_text=text_body,
                    error=None,
                    attempts=attempt,
                    timing_ms=(time.perf_counter() - started) * 1000,
                )
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
                if attempt <= self.max_retries:
                    self._sleep_with_backoff(attempt)
                    continue
                return HttpCallResult(
                    http_status=None,
                    json_body=None,
                    raw_text=None,
                    error=last_error,
                    attempts=attempt,
                    timing_ms=(time.perf_counter() - started) * 1000,
                )

        return HttpCallResult(
            http_status=None,
            json_body=None,
            raw_text=None,
            error=last_error or "Unknown HTTP failure",
            attempts=self.max_retries + 1,
            timing_ms=(time.perf_counter() - started) * 1000,
        )

    def _sleep_with_backoff(self, attempt: int) -> None:
        backoff = min(self.backoff_cap_s, self.backoff_base_s * (2 ** (attempt - 1)))
        jitter = random.uniform(0, backoff * 0.2)
        time.sleep(backoff + jitter)

    def _post(self, *, endpoint: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any] | None, str | None]:
        if self._client is not None:
            response = self._client.post(endpoint, json=payload)
            status = int(response.status_code)
            try:
                parsed = response.json()
                if isinstance(parsed, dict):
                    return status, parsed, None
            except ValueError:
                pass
            return status, None, response.text

        data = json.dumps(payload).encode("utf-8")
        req = urllib_request.Request(endpoint, data=data, headers=self._headers, method="POST")
        try:
            with urllib_request.urlopen(req, timeout=self.timeout_s) as response:
                status = int(response.getcode())
                raw_text = response.read().decode("utf-8", errors="replace")
                try:
                    parsed = json.loads(raw_text)
                    if isinstance(parsed, dict):
                        return status, parsed, None
                except json.JSONDecodeError:
                    pass
                return status, None, raw_text
        except urllib_error.HTTPError as exc:
            status = int(exc.code)
            raw_bytes = exc.read() if exc.fp is not None else b""
            raw_text = raw_bytes.decode("utf-8", errors="replace") if raw_bytes else None
            if raw_text:
                try:
                    parsed = json.loads(raw_text)
                    if isinstance(parsed, dict):
                        return status, parsed, None
                except json.JSONDecodeError:
                    pass
            return status, None, raw_text

