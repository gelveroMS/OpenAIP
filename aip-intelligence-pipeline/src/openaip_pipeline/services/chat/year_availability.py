from __future__ import annotations

from typing import Any

_SCOPE_TABLE_BY_TYPE: dict[str, str] = {
    "barangay": "barangays",
    "city": "cities",
    "municipality": "municipalities",
}

_AIP_SCOPE_ID_FIELD_BY_TYPE: dict[str, str] = {
    "barangay": "barangay_id",
    "city": "city_id",
    "municipality": "municipality_id",
}


def _normalize_space(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _normalize_lower(value: Any) -> str:
    return _normalize_space(value).lower()


def _coerce_year(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        cleaned = value.strip()
        if cleaned.isdigit():
            return int(cleaned)
    return None


def _scope_label(scope_type: str, scope_name: str) -> str:
    cleaned = _normalize_space(scope_name)
    lowered = cleaned.lower()
    if scope_type == "barangay":
        return cleaned if lowered.startswith("barangay ") else f"Barangay {cleaned}"
    if scope_type == "city":
        if lowered.startswith("city of ") or lowered.startswith("city ") or lowered.endswith(" city"):
            return cleaned
        return f"City {cleaned}"
    if scope_type == "municipality":
        if lowered.startswith("municipality of ") or lowered.startswith("municipality "):
            return cleaned
        return f"Municipality {cleaned}"
    return cleaned


def _resolve_scope_from_targets(retrieval_scope: dict[str, Any] | None) -> dict[str, str] | None:
    scope_payload = retrieval_scope or {}
    targets = scope_payload.get("targets")
    if not isinstance(targets, list) or len(targets) != 1:
        return None
    target = targets[0]
    if not isinstance(target, dict):
        return None

    scope_type = _normalize_lower(target.get("scope_type"))
    scope_id = _normalize_space(target.get("scope_id"))
    scope_name = _normalize_space(target.get("scope_name"))
    if scope_type not in _SCOPE_TABLE_BY_TYPE:
        return None
    if not scope_id:
        return None
    if not scope_name:
        scope_name = scope_id
    return {
        "scope_type": scope_type,
        "scope_id": scope_id,
        "scope_name": scope_name,
    }


def _resolve_scope_from_filters(*, supabase: Any, retrieval_filters: dict[str, Any]) -> dict[str, Any]:
    scope_type = _normalize_lower(retrieval_filters.get("scope_type"))
    scope_name = _normalize_space(retrieval_filters.get("scope_name"))
    if not scope_type or not scope_name:
        return {"state": "missing"}
    table = _SCOPE_TABLE_BY_TYPE.get(scope_type)
    if not table:
        return {"state": "missing"}

    try:
        rows = list((supabase.table(table).select("id,name").ilike("name", scope_name).execute().data) or [])
    except Exception:
        return {"state": "query_failed"}

    normalized_scope_name = _normalize_lower(scope_name)
    exact_rows = [
        row
        for row in rows
        if _normalize_lower(row.get("name")) == normalized_scope_name and _normalize_space(row.get("id"))
    ]
    if not exact_rows:
        return {"state": "missing"}

    unique_ids = sorted({_normalize_space(row.get("id")) for row in exact_rows if _normalize_space(row.get("id"))})
    if len(unique_ids) > 1:
        return {
            "state": "ambiguous",
            "scope_type": scope_type,
            "scope_name": scope_name,
            "scope_ids": unique_ids,
        }

    scope_id = unique_ids[0]
    matching_row = next((row for row in exact_rows if _normalize_space(row.get("id")) == scope_id), exact_rows[0])
    canonical_name = _normalize_space(matching_row.get("name")) or scope_name
    return {
        "state": "resolved",
        "scope_type": scope_type,
        "scope_id": scope_id,
        "scope_name": canonical_name,
    }


def _fetch_available_years(*, supabase: Any, resolved_scope: dict[str, str] | None) -> list[int]:
    query = supabase.table("aips").select("fiscal_year").eq("status", "published")
    if resolved_scope is not None:
        scope_type = resolved_scope.get("scope_type")
        scope_id = _normalize_space(resolved_scope.get("scope_id"))
        field = _AIP_SCOPE_ID_FIELD_BY_TYPE.get(scope_type or "")
        if field and scope_id:
            query = query.eq(field, scope_id)
    rows = list((query.execute().data) or [])
    years = sorted({_coerce_year(row.get("fiscal_year")) for row in rows if _coerce_year(row.get("fiscal_year")) is not None})
    return [int(year) for year in years]


def check_year_availability_preflight(
    *,
    supabase_url: str,
    supabase_service_key: str,
    question: str,
    retrieval_scope: dict[str, Any] | None,
    retrieval_filters: dict[str, Any] | None,
) -> dict[str, Any]:
    del question

    filters_payload = dict(retrieval_filters or {})
    requested_year = _coerce_year(filters_payload.get("fiscal_year"))
    if requested_year is None:
        return {
            "decision": "not_applicable",
            "reason": "requested_year_missing",
            "requested_fiscal_year": None,
            "available_fiscal_years": [],
            "year_availability_scope": None,
        }

    try:
        from supabase.client import create_client
    except Exception:
        return {
            "decision": "not_applicable",
            "reason": "supabase_client_unavailable",
            "requested_fiscal_year": requested_year,
            "available_fiscal_years": [],
            "year_availability_scope": None,
        }

    try:
        supabase = create_client(supabase_url, supabase_service_key)
    except Exception:
        return {
            "decision": "not_applicable",
            "reason": "supabase_client_init_failed",
            "requested_fiscal_year": requested_year,
            "available_fiscal_years": [],
            "year_availability_scope": None,
        }

    resolved_scope = _resolve_scope_from_targets(retrieval_scope)
    if resolved_scope is None:
        scope_resolution = _resolve_scope_from_filters(supabase=supabase, retrieval_filters=filters_payload)
        state = str(scope_resolution.get("state") or "")
        if state == "ambiguous":
            return {
                "decision": "ambiguous_scope",
                "reason": "scope_name_ambiguous",
                "requested_fiscal_year": requested_year,
                "available_fiscal_years": [],
                "year_availability_scope": {
                    "scope_type": str(scope_resolution.get("scope_type") or ""),
                    "scope_name": str(scope_resolution.get("scope_name") or ""),
                },
            }
        if state == "resolved":
            resolved_scope = {
                "scope_type": str(scope_resolution.get("scope_type") or ""),
                "scope_id": str(scope_resolution.get("scope_id") or ""),
                "scope_name": str(scope_resolution.get("scope_name") or ""),
            }
        elif state in {"query_failed", "missing"}:
            if state == "query_failed":
                return {
                    "decision": "not_applicable",
                    "reason": "scope_lookup_failed",
                    "requested_fiscal_year": requested_year,
                    "available_fiscal_years": [],
                    "year_availability_scope": None,
                }

    try:
        available_years = _fetch_available_years(supabase=supabase, resolved_scope=resolved_scope)
    except Exception:
        return {
            "decision": "not_applicable",
            "reason": "available_years_query_failed",
            "requested_fiscal_year": requested_year,
            "available_fiscal_years": [],
            "year_availability_scope": None,
        }

    if resolved_scope is None:
        scope_payload = {
            "scope_type": "global",
            "scope_name": "all published scopes",
        }
    else:
        resolved_scope_type = str(resolved_scope.get("scope_type") or "").strip()
        resolved_scope_name = str(resolved_scope.get("scope_name") or "").strip()
        scope_payload = {
            "scope_type": resolved_scope_type,
            "scope_name": _scope_label(resolved_scope_type, resolved_scope_name)
            if resolved_scope_name
            else resolved_scope_name,
        }

    return {
        "decision": "year_available" if requested_year in set(available_years) else "year_unavailable",
        "reason": "requested_year_available" if requested_year in set(available_years) else "requested_year_unavailable",
        "requested_fiscal_year": requested_year,
        "available_fiscal_years": available_years,
        "year_availability_scope": scope_payload,
    }

