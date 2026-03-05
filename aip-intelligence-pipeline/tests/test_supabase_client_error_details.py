from __future__ import annotations

import io
import json
import urllib.request
from urllib.error import HTTPError

import pytest

from openaip_pipeline.adapters.supabase.client import SupabaseConfig, SupabaseRestClient


def test_request_enriches_http_error_with_postgrest_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "code": "23503",
        "message": 'insert or update on table "projects" violates foreign key constraint "fk_projects_sector"',
        "details": 'Key (sector_code)=(A101) is not present in table "sectors".',
        "hint": None,
    }
    body = json.dumps(payload).encode("utf-8")

    def _raise_http_error(*args: object, **kwargs: object) -> object:
        del args, kwargs
        raise HTTPError(
            url="https://example.supabase.co/rest/v1/projects",
            code=409,
            msg="Conflict",
            hdrs=None,
            fp=io.BytesIO(body),
        )

    monkeypatch.setattr(urllib.request, "urlopen", _raise_http_error)

    client = SupabaseRestClient(SupabaseConfig(url="https://example.supabase.co", service_key="sb-key"))
    with pytest.raises(HTTPError) as error_info:
        client.insert("projects", {"aip_id": "aip-1", "aip_ref_code": "A101-01"})

    message = str(error_info.value)
    assert "HTTP Error 409" in message
    assert "code=23503" in message
    assert "fk_projects_sector" in message
    assert "Key (sector_code)=(A101)" in message
    assert getattr(error_info.value, "supabase_error_payload") == payload
