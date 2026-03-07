from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from openaip_pipeline.core.settings import Settings


@dataclass(frozen=True)
class SupabaseConfig:
    url: str
    service_key: str


class SupabaseGuardrailError(RuntimeError):
    def __init__(self, reason_code: str, message: str):
        super().__init__(message)
        self.reason_code = reason_code


def _read_positive_float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        parsed = float(raw.strip())
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _read_positive_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        parsed = int(raw.strip())
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _extract_http_error_payload(error: urllib.error.HTTPError) -> tuple[dict[str, Any] | None, str | None]:
    body_bytes: bytes | None = None
    if getattr(error, "fp", None) is not None:
        try:
            body_bytes = error.read()
        except Exception:
            body_bytes = None
    if not body_bytes:
        return None, None
    raw_body = body_bytes.decode("utf-8", errors="replace")
    try:
        parsed = json.loads(raw_body)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, dict):
        return parsed, raw_body
    return None, raw_body


def _format_http_error_message(
    *,
    base_message: str,
    payload: dict[str, Any] | None,
    raw_body: str | None,
) -> str:
    details: list[str] = []
    if isinstance(payload, dict):
        for key in ("code", "message", "details", "hint"):
            value = payload.get(key)
            if value is None:
                continue
            text = str(value).strip()
            if text:
                details.append(f"{key}={text}")
    elif raw_body:
        snippet = raw_body.strip().replace("\n", " ")
        if snippet:
            details.append(f"body={snippet[:600]}")
    if not details:
        return base_message
    return f"{base_message} | " + " | ".join(details)


class SupabaseRestClient:
    def __init__(self, config: SupabaseConfig):
        self.config = config
        self.base_url = config.url.rstrip("/")
        self.service_key = config.service_key
        self.http_timeout_seconds = _read_positive_float_env("PIPELINE_SUPABASE_HTTP_TIMEOUT_SECONDS", 120.0)
        self.download_timeout_seconds = _read_positive_float_env("PIPELINE_SUPABASE_DOWNLOAD_TIMEOUT_SECONDS", 120.0)
        self.source_pdf_max_bytes = _read_positive_int_env("PIPELINE_SOURCE_PDF_MAX_BYTES", 15 * 1024 * 1024)

        # Security proof:
        # - PIPELINE_SUPABASE_HTTP_TIMEOUT_SECONDS bounds REST calls (default 120s)
        # - PIPELINE_SUPABASE_DOWNLOAD_TIMEOUT_SECONDS bounds signed-download calls (default 120s)
        # - PIPELINE_SOURCE_PDF_MAX_BYTES bounds source PDF downloads (default 15728640 / 15MB)
        # - Example guardrail error: reason_code=SOURCE_PDF_TOO_LARGE

    @classmethod
    def from_settings(cls, settings: Settings) -> "SupabaseRestClient":
        return cls(SupabaseConfig(url=settings.supabase_url, service_key=settings.supabase_service_key))

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
        }
        if extra:
            headers.update(extra)
        return headers

    def _rest_url(self, table: str, query: dict[str, str] | None = None) -> str:
        url = f"{self.base_url}/rest/v1/{table}"
        if not query:
            return url
        return f"{url}?{urllib.parse.urlencode(query, safe=',()*.')}"

    def _request(
        self,
        method: str,
        url: str,
        *,
        payload: dict[str, Any] | None = None,
        raw_bytes: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        body = raw_bytes
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url=url, data=body, headers=self._headers(headers), method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.http_timeout_seconds) as response:
                data = response.read()
                if not data:
                    return None
                if (response.headers.get("Content-Type") or "").startswith("application/json"):
                    return json.loads(data.decode("utf-8"))
                return data
        except urllib.error.HTTPError as error:
            parsed_payload, raw_body = _extract_http_error_payload(error)
            if parsed_payload is not None:
                setattr(error, "supabase_error_payload", parsed_payload)
            if raw_body is not None:
                setattr(error, "supabase_error_raw", raw_body)
            error.msg = _format_http_error_message(
                base_message=str(error.msg),
                payload=parsed_payload,
                raw_body=raw_body,
            )
            raise

    def select(
        self,
        table: str,
        *,
        select: str,
        filters: dict[str, str] | None = None,
        order: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        query: dict[str, str] = {"select": select}
        if filters:
            query.update(filters)
        if order:
            query["order"] = order
        if limit is not None:
            query["limit"] = str(limit)
        data = self._request("GET", self._rest_url(table, query))
        return data or []

    def insert(
        self,
        table: str,
        row: dict[str, Any],
        *,
        select: str | None = None,
        on_conflict: str | None = None,
        upsert: bool = False,
    ) -> list[dict[str, Any]]:
        query: dict[str, str] = {}
        if select:
            query["select"] = select
        if on_conflict:
            query["on_conflict"] = on_conflict
        headers = {"Prefer": "return=representation"}
        if upsert:
            headers["Prefer"] = "resolution=merge-duplicates,return=representation"
        data = self._request("POST", self._rest_url(table, query or None), payload=row, headers=headers)
        return data or []

    def update(
        self,
        table: str,
        patch: dict[str, Any],
        *,
        filters: dict[str, str],
        select: str | None = None,
    ) -> list[dict[str, Any]]:
        query = dict(filters)
        if select:
            query["select"] = select
        data = self._request(
            "PATCH",
            self._rest_url(table, query),
            payload=patch,
            headers={"Prefer": "return=representation"},
        )
        return data or []

    def create_signed_url(self, bucket_id: str, object_name: str, expires_in: int = 600) -> str:
        object_path = urllib.parse.quote(object_name, safe="/")
        url = f"{self.base_url}/storage/v1/object/sign/{bucket_id}/{object_path}"
        data = self._request("POST", url, payload={"expiresIn": expires_in})
        if not isinstance(data, dict):
            raise RuntimeError("Signed URL response is invalid.")
        signed = data.get("signedURL") or data.get("signedUrl")
        if not isinstance(signed, str) or not signed:
            raise RuntimeError("Signed URL is missing.")
        if signed.startswith("http://") or signed.startswith("https://"):
            return signed
        if signed.startswith("/"):
            return f"{self.base_url}/storage/v1{signed}"
        return f"{self.base_url}/storage/v1/{signed}"

    def download_bytes(self, url: str) -> bytes:
        req = urllib.request.Request(url=url, method="GET")
        total = 0
        chunks: list[bytes] = []
        with urllib.request.urlopen(req, timeout=self.download_timeout_seconds) as response:
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > self.source_pdf_max_bytes:
                    raise SupabaseGuardrailError(
                        "SOURCE_PDF_TOO_LARGE",
                        (
                            "Downloaded source PDF exceeded PIPELINE_SOURCE_PDF_MAX_BYTES "
                            f"({self.source_pdf_max_bytes} bytes)."
                        ),
                    )
                chunks.append(chunk)
        return b"".join(chunks)

    def upload_bytes(self, *, bucket_id: str, object_name: str, content: bytes, content_type: str) -> str:
        object_path = urllib.parse.quote(object_name, safe="/")
        url = f"{self.base_url}/storage/v1/object/{bucket_id}/{object_path}"
        self._request(
            "POST",
            url,
            raw_bytes=content,
            headers={
                "Content-Type": content_type,
                "x-upsert": "true",
            },
        )
        return object_name

