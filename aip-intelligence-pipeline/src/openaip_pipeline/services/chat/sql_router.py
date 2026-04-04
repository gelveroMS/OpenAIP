from __future__ import annotations

import re
from typing import Any

from openaip_pipeline.services.query_intent import detect_exhaustive_intent

YEAR_RE = re.compile(r"\b(20\d{2})\b")
REF_RE = re.compile(r"\b\d{4}-[a-z0-9-]{3,}\b", re.IGNORECASE)
TOP_RE = re.compile(r"\btop\s+(\d{1,2})\b", re.IGNORECASE)
FILTERED_LIST_CAP = 20


def _norm(text: str) -> str:
    return " ".join((text or "").lower().split())


def _num(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.strip().replace(",", "")
        if not cleaned:
            return None
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _int(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def _php(value: float | None) -> str:
    if value is None:
        return "N/A"
    return f"PHP {value:,.2f}"


def _years(text: str) -> list[int]:
    out: list[int] = []
    for match in YEAR_RE.findall(text or ""):
        year = int(match)
        if year not in out:
            out.append(year)
    return out


def _parse_top_limit(normalized: str) -> int:
    match = TOP_RE.search(normalized)
    if not match:
        return 10
    parsed = _int(match.group(1))
    if parsed is None:
        return 10
    return max(1, min(parsed, 50))


def _targets(scope: dict[str, Any] | None) -> list[dict[str, str]]:
    if not isinstance(scope, dict):
        return []
    raw = scope.get("targets")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        scope_type = str(item.get("scope_type") or "").strip().lower()
        scope_id = str(item.get("scope_id") or "").strip()
        scope_name = str(item.get("scope_name") or "").strip()
        if scope_type in {"barangay", "city", "municipality"} and scope_id:
            out.append(
                {
                    "scope_type": scope_type,
                    "scope_id": scope_id,
                    "scope_name": scope_name,
                }
            )
    return out


def _match_scope(row: dict[str, Any], target: dict[str, str]) -> bool:
    if target["scope_type"] == "barangay":
        return str(row.get("barangay_id") or "") == target["scope_id"]
    if target["scope_type"] == "city":
        return str(row.get("city_id") or "") == target["scope_id"]
    return str(row.get("municipality_id") or "") == target["scope_id"]


def _scope_filter(rows: list[dict[str, Any]], targets: list[dict[str, str]]) -> list[dict[str, Any]]:
    if not targets:
        return rows
    return [row for row in rows if any(_match_scope(row, target) for target in targets)]


def _scope_label(targets: list[dict[str, str]]) -> str:
    if not targets:
        return "all published scopes"
    if len(targets) == 1:
        target = targets[0]
        name = target["scope_name"] or target["scope_id"]
        if target["scope_type"] == "barangay" and not name.lower().startswith("barangay "):
            return f"Barangay {name}"
        if target["scope_type"] == "city" and "city" not in name.lower():
            return f"City {name}"
        if target["scope_type"] == "municipality" and "municipality" not in name.lower():
            return f"Municipality {name}"
        return name
    return "selected scopes"


def _response(
    *,
    question: str,
    answer: str,
    citations: list[dict[str, Any]],
    route_family: str,
    status: str = "answer",
    refused: bool = False,
    reason: str | None = None,
    extra_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "reason": reason
        or ("clarification_needed" if status == "clarification" else "insufficient_evidence" if refused else "ok"),
        "status": status,
        "route_family": route_family,
        "context_count": len(citations),
        "exhaustive_intent": False,
        "exhaustive_signal": None,
        "result_cap": None,
        "total_matches": None,
        "returned_count": None,
        "truncated": False,
    }
    if extra_meta:
        meta.update(extra_meta)
    return {
        "question": question,
        "answer": answer,
        "refused": refused,
        "citations": citations,
        "retrieval_meta": meta,
        "context_count": len(citations),
    }


def _sys_cite(source_id: str, snippet: str, metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_id": source_id,
        "scope_type": "system",
        "scope_name": "Structured SQL",
        "snippet": snippet,
        "insufficient": False,
        "metadata": metadata,
    }


def _fetch_aips(*, supabase: Any, fiscal_year: int | None, targets: list[dict[str, str]]) -> list[dict[str, Any]]:
    query = (
        supabase.table("aips")
        .select("id,fiscal_year,barangay_id,city_id,municipality_id,created_at")
        .eq("status", "published")
    )
    if fiscal_year is not None:
        query = query.eq("fiscal_year", fiscal_year)
    rows = list((query.execute().data or []))
    rows = _scope_filter(rows, targets)
    rows.sort(
        key=lambda row: (int(row.get("fiscal_year") or 0), str(row.get("created_at") or "")),
        reverse=True,
    )
    return rows


def _sum_totals(*, supabase: Any, aip_ids: list[str]) -> tuple[float | None, list[dict[str, Any]]]:
    if not aip_ids:
        return None, []
    rows = list(
        (
            supabase.table("aip_totals")
            .select("aip_id,total_investment_program,evidence_text,page_no")
            .in_("aip_id", aip_ids)
            .eq("source_label", "total_investment_program")
            .execute()
            .data
        )
        or []
    )
    values = [_num(row.get("total_investment_program")) for row in rows]
    clean = [value for value in values if value is not None]
    return (sum(clean), rows) if clean else (None, rows)


def _sum_line_item_totals(*, supabase: Any, aip_ids: list[str]) -> float | None:
    if not aip_ids:
        return None
    rows = list((supabase.table("aip_line_items").select("total").in_("aip_id", aip_ids).execute().data) or [])
    values = [_num(row.get("total")) for row in rows]
    clean = [value for value in values if value is not None]
    return sum(clean) if clean else None


def _fetch_line_items(
    *,
    supabase: Any,
    aip_ids: list[str],
    fiscal_year: int | None = None,
) -> list[dict[str, Any]]:
    if not aip_ids:
        return []
    query = supabase.table("aip_line_items").select(
        "id,aip_id,fiscal_year,barangay_id,aip_ref_code,program_project_title,"
        "implementing_agency,start_date,end_date,fund_source,sector_code,sector_name,total,"
        "expected_output,page_no,row_no,table_no"
    )
    query = query.in_("aip_id", aip_ids)
    if fiscal_year is not None:
        query = query.eq("fiscal_year", fiscal_year)
    return list((query.execute().data or []))


def _fetch_name_map(*, supabase: Any, table: str, ids: list[str]) -> dict[str, str]:
    deduped = sorted({item for item in ids if item})
    if not deduped:
        return {}
    rows = list((supabase.table(table).select("id,name").in_("id", deduped).execute().data) or [])
    out: dict[str, str] = {}
    for row in rows:
        key = str(row.get("id") or "").strip()
        name = str(row.get("name") or "").strip()
        if key and name:
            out[key] = name
    return out

def _detect_metadata(normalized: str) -> str | None:
    exhaustive = detect_exhaustive_intent(normalized)
    if (
        exhaustive["exhaustive_intent"]
        and any(token in normalized for token in ["project", "projects", "program", "programs"])
        and _extract_filtered_project_filters(normalized)
    ):
        return None

    has_enum = any(
        token in normalized
        for token in ["list", "show", "available", "which", "what are", "what years", "which years"]
    )
    has_aggregation = any(
        token in normalized
        for token in ["totals", "total by", "breakdown", "distribution", "compare", "comparison", " vs ", " versus "]
    )
    if any(token in normalized for token in ["what years", "which years", "available years", "list fiscal years"]):
        return "years"
    if has_enum and "sector" in normalized and not has_aggregation:
        return "sectors"
    if has_enum and any(token in normalized for token in ["fund source", "funding source", "source of funds"]) and not has_aggregation:
        return "fund_sources"
    if has_enum and any(token in normalized for token in ["project categories", "project category", "project types", "categories"]):
        return "project_categories"
    if has_enum and any(token in normalized for token in ["implementing agencies", "implementing agency", "departments", "offices"]):
        return "agencies"
    if has_enum and any(token in normalized for token in ["barangays", "available scopes", "scope list", "list scopes"]):
        return "scopes"
    return None


def _is_compare_years(normalized: str) -> bool:
    return any(token in normalized for token in ["compare", "comparison", "difference", " vs ", " versus "])


def _is_totals(normalized: str) -> bool:
    if any(token in normalized for token in ["by sector", "fund source", "top projects", "compare", " vs ", " versus "]):
        return False
    return any(
        token in normalized
        for token in ["total investment program", "total investment", "grand total", "total budget", "overall budget"]
    )


def _extract_filter_value(normalized: str, patterns: list[str]) -> str | None:
    tail_stop = (
        r"(?=\s+(?:for\s+fy|for\s+fiscal\s+year|in\s+fy|in\s+fiscal\s+year|"
        r"in\s+barangay|in\s+city|in\s+municipality|with\s+citations|with\s+sources)\b|$)"
    )
    for head in patterns:
        match = re.search(
            rf"(?:{head})\s*(?:is|=|:)?\s*([a-z0-9/&().,\- ]+?){tail_stop}",
            normalized,
            flags=re.IGNORECASE,
        )
        if not match:
            continue
        value = " ".join(str(match.group(1) or "").strip().split())
        value = value.strip(" .,;:")
        if value:
            return value
    return None


def _extract_filtered_project_filters(normalized: str) -> dict[str, str]:
    filters: dict[str, str] = {}
    fund_source = _extract_filter_value(
        normalized,
        [
            r"fund\s+source",
            r"funding\s+source",
            r"source\s+of\s+funds",
            r"funcing\s+source",
            r"fund\s+from",
        ],
    )
    if fund_source:
        filters["fund_source"] = fund_source

    sector = _extract_filter_value(
        normalized,
        [
            r"sector",
            r"sector\s+name",
            r"under\s+sector",
            r"in\s+sector",
        ],
    )
    if sector:
        filters["sector"] = sector

    implementing_agency = _extract_filter_value(
        normalized,
        [
            r"implementing\s+agency",
            r"implemented\s+by",
            r"agency",
            r"office",
        ],
    )
    if implementing_agency:
        filters["implementing_agency"] = implementing_agency
    return filters


def _matches_filter(value: Any, filter_value: str) -> bool:
    if not filter_value:
        return True
    left = _norm(str(value or ""))
    right = _norm(filter_value)
    if not left or not right:
        return False
    return right in left


def _detect_aggregation(normalized: str) -> str | None:
    has_projects = any(token in normalized for token in ["project", "projects", "program", "programs"])
    exhaustive = detect_exhaustive_intent(normalized)
    if has_projects and exhaustive["exhaustive_intent"] and _extract_filtered_project_filters(normalized):
        return "filtered_project_list"
    if has_projects and any(token in normalized for token in ["top ", "largest", "highest", "most funded"]):
        return "top_projects"
    if any(token in normalized for token in ["by sector", "sector totals", "sector breakdown", "breakdown by sector"]):
        return "totals_by_sector"
    if any(
        token in normalized
        for token in [
            "by fund source",
            "fund source totals",
            "fund source breakdown",
            "breakdown by fund",
            "totals by fund source",
        ]
    ):
        return "totals_by_fund_source"
    return None


def _is_line_item_query(question: str, normalized: str) -> bool:
    if REF_RE.search(question):
        return True
    return any(token in normalized for token in ["ref code", "line item", "fund source for", "schedule for", "implementing agency for"])


def _extract_fact_fields(normalized: str) -> list[str]:
    fields: list[str] = []
    if any(token in normalized for token in ["how much", "amount", "allocated", "allocation", "budget", "cost", "total"]):
        fields.append("amount")
    if any(token in normalized for token in ["schedule", "timeline", "start", "end date", "when"]):
        fields.append("schedule")
    if any(token in normalized for token in ["fund source", "funding source", "source of funds"]):
        fields.append("fund_source")
    if any(token in normalized for token in ["implementing agency", "implemented by", "who will implement"]):
        fields.append("implementing_agency")
    if any(token in normalized for token in ["expected output", "target output", "deliverable", "output"]):
        fields.append("expected_output")
    if not fields:
        fields.append("amount")
    return fields


def _format_schedule(start_date: Any, end_date: Any) -> str:
    start = str(start_date or "").strip()
    end = str(end_date or "").strip()
    if start and end:
        return f"{start} to {end}"
    if start:
        return f"{start} to N/A"
    if end:
        return f"N/A to {end}"
    return "N/A"


def _answer_totals(
    *,
    supabase: Any,
    question: str,
    targets: list[dict[str, str]],
    fiscal_year: int | None,
) -> dict[str, Any] | None:
    aips = _fetch_aips(supabase=supabase, fiscal_year=fiscal_year, targets=targets)
    if not aips:
        return None
    aip_ids = [str(row.get("id")) for row in aips if row.get("id")]

    total_value, total_rows = _sum_totals(supabase=supabase, aip_ids=aip_ids)
    if total_value is None:
        total_value = _sum_line_item_totals(supabase=supabase, aip_ids=aip_ids)
    if total_value is None:
        return None

    scope_label = _scope_label(targets)
    fy_label = f" for FY {fiscal_year}" if fiscal_year is not None else ""
    answer = f"Total investment program for {scope_label}{fy_label}: {_php(total_value)}."

    citations: list[dict[str, Any]] = []
    for index, row in enumerate(total_rows[:3], start=1):
        citations.append(
            {
                "source_id": f"S{index}",
                "scope_type": "system",
                "scope_name": "Published AIP totals",
                "snippet": str(row.get("evidence_text") or "Total investment program value from structured totals table."),
                "insufficient": False,
                "metadata": {
                    "type": "aip_totals",
                    "aip_id": row.get("aip_id"),
                    "page_no": row.get("page_no"),
                    "fiscal_year_filter": fiscal_year,
                },
            }
        )

    if not citations:
        citations = [
            _sys_cite(
                "S0",
                "Computed from published AIP line-item totals.",
                {
                    "type": "aip_line_items",
                    "aggregate_type": "total_investment_program",
                    "fiscal_year_filter": fiscal_year,
                },
            )
        ]

    return _response(
        question=question,
        answer=answer,
        citations=citations,
        route_family="sql_totals",
        extra_meta={"fiscal_year_filter": fiscal_year},
    )


def _answer_top_projects(
    *,
    supabase: Any,
    question: str,
    targets: list[dict[str, str]],
    fiscal_year: int | None,
    limit: int,
) -> dict[str, Any] | None:
    aips = _fetch_aips(supabase=supabase, fiscal_year=fiscal_year, targets=targets)
    if not aips:
        return None
    aip_ids = [str(row.get("id")) for row in aips if row.get("id")]
    rows = _fetch_line_items(supabase=supabase, aip_ids=aip_ids, fiscal_year=fiscal_year)

    ranked = [row for row in rows if _num(row.get("total")) is not None]
    ranked.sort(key=lambda row: _num(row.get("total")) or 0.0, reverse=True)
    top_rows = ranked[:limit]
    if not top_rows:
        return None

    scope_label = _scope_label(targets)
    fy_label = f"FY {fiscal_year}" if fiscal_year is not None else "All fiscal years"

    lines: list[str] = []
    citations: list[dict[str, Any]] = []
    for index, row in enumerate(top_rows, start=1):
        title = str(row.get("program_project_title") or "Untitled project").strip()
        amount = _php(_num(row.get("total")))
        ref_code = str(row.get("aip_ref_code") or "").strip() or "N/A"
        fund_source = str(row.get("fund_source") or "").strip() or "Unspecified"
        lines.append(f"{index}. {title} - {amount} - {fund_source} - Ref {ref_code}")

        citations.append(
            {
                "source_id": f"A{index}",
                "scope_type": "system",
                "scope_name": "Published AIP line items",
                "snippet": f"{title} - Total {amount} - Fund {fund_source} - Ref {ref_code}",
                "insufficient": False,
                "metadata": {
                    "type": "aip_line_item",
                    "line_item_id": row.get("id"),
                    "aip_id": row.get("aip_id"),
                    "fiscal_year": row.get("fiscal_year"),
                    "page_no": row.get("page_no"),
                    "row_no": row.get("row_no"),
                    "table_no": row.get("table_no"),
                },
            }
        )

    answer = f"Top {len(top_rows)} projects by total ({scope_label}; {fy_label}):\n" + "\n".join(lines)
    return _response(
        question=question,
        answer=answer,
        citations=citations,
        route_family="aggregate_sql",
        extra_meta={
            "aggregation": "top_projects",
            "fiscal_year_filter": fiscal_year,
            "limit": limit,
        },
    )


def _answer_filtered_project_list(
    *,
    supabase: Any,
    question: str,
    normalized: str,
    targets: list[dict[str, str]],
    fiscal_year: int | None,
    exhaustive_signal: str | None,
) -> dict[str, Any] | None:
    filters = _extract_filtered_project_filters(normalized)
    if not filters:
        return None

    aips = _fetch_aips(supabase=supabase, fiscal_year=fiscal_year, targets=targets)
    if not aips:
        return None
    aip_ids = [str(row.get("id")) for row in aips if row.get("id")]
    rows = _fetch_line_items(supabase=supabase, aip_ids=aip_ids, fiscal_year=fiscal_year)

    filtered_rows: list[dict[str, Any]] = []
    for row in rows:
        if "fund_source" in filters and not _matches_filter(row.get("fund_source"), filters["fund_source"]):
            continue
        if "sector" in filters:
            sector_label = " ".join(
                [
                    str(row.get("sector_code") or "").strip(),
                    str(row.get("sector_name") or "").strip(),
                ]
            ).strip()
            if not _matches_filter(sector_label, filters["sector"]):
                continue
        if "implementing_agency" in filters and not _matches_filter(
            row.get("implementing_agency"), filters["implementing_agency"]
        ):
            continue
        filtered_rows.append(row)

    deduped: dict[str, dict[str, Any]] = {}
    for row in filtered_rows:
        title = str(row.get("program_project_title") or "").strip() or "Untitled project"
        ref_code = str(row.get("aip_ref_code") or "").strip()
        key = "|".join([str(row.get("aip_id") or ""), title.lower(), ref_code.lower()])
        if key not in deduped:
            deduped[key] = row

    ranked = sorted(
        deduped.values(),
        key=lambda row: (
            str(row.get("program_project_title") or "").strip().lower(),
            str(row.get("aip_ref_code") or "").strip().lower(),
            str(row.get("id") or "").strip().lower(),
        ),
    )
    total_matches = len(ranked)
    if total_matches == 0:
        return None

    returned_rows = ranked[:FILTERED_LIST_CAP]
    returned_count = len(returned_rows)
    truncated = total_matches > returned_count
    scope_label = _scope_label(targets)
    fy_label = f"FY {fiscal_year}" if fiscal_year is not None else "All fiscal years"

    filter_parts = []
    if "fund_source" in filters:
        filter_parts.append(f"fund source='{filters['fund_source']}'")
    if "sector" in filters:
        filter_parts.append(f"sector='{filters['sector']}'")
    if "implementing_agency" in filters:
        filter_parts.append(f"implementing agency='{filters['implementing_agency']}'")
    filter_label = ", ".join(filter_parts) if filter_parts else "applied filters"

    lines: list[str] = []
    citations: list[dict[str, Any]] = []
    for index, row in enumerate(returned_rows, start=1):
        title = str(row.get("program_project_title") or "Untitled project").strip()
        amount = _php(_num(row.get("total")))
        ref_code = str(row.get("aip_ref_code") or "").strip() or "N/A"
        fund_source = str(row.get("fund_source") or "").strip() or "Unspecified"
        agency = str(row.get("implementing_agency") or "").strip() or "Unspecified"
        lines.append(f"{index}. {title} - {amount} - Fund: {fund_source} - Agency: {agency} - Ref {ref_code}")
        citations.append(
            {
                "source_id": f"F{index}",
                "scope_type": "system",
                "scope_name": "Published AIP line items",
                "snippet": f"{title} - {fund_source} - {agency} - Ref {ref_code}",
                "insufficient": False,
                "metadata": {
                    "type": "aip_line_item",
                    "line_item_id": row.get("id"),
                    "aip_id": row.get("aip_id"),
                    "fiscal_year": row.get("fiscal_year"),
                    "page_no": row.get("page_no"),
                    "row_no": row.get("row_no"),
                    "table_no": row.get("table_no"),
                },
            }
        )

    answer = f"Projects matching {filter_label} ({scope_label}; {fy_label}):\n" + "\n".join(lines)
    if truncated:
        remaining = total_matches - returned_count
        answer += (
            f"\nShowing first {returned_count} of {total_matches} matches. "
            f"{remaining} more matches are available. Narrow the scope, fiscal year, or filters for the next query."
        )

    return _response(
        question=question,
        answer=answer,
        citations=citations,
        route_family="filtered_list_sql",
        extra_meta={
            "aggregation": "filtered_project_list",
            "fiscal_year_filter": fiscal_year,
            "applied_filters": filters,
            "exhaustive_intent": True,
            "exhaustive_signal": exhaustive_signal,
            "result_cap": FILTERED_LIST_CAP,
            "total_matches": total_matches,
            "returned_count": returned_count,
            "truncated": truncated,
        },
    )


def _answer_totals_by_sector(
    *,
    supabase: Any,
    question: str,
    targets: list[dict[str, str]],
    fiscal_year: int | None,
) -> dict[str, Any] | None:
    aips = _fetch_aips(supabase=supabase, fiscal_year=fiscal_year, targets=targets)
    if not aips:
        return None
    aip_ids = [str(row.get("id")) for row in aips if row.get("id")]
    rows = _fetch_line_items(supabase=supabase, aip_ids=aip_ids, fiscal_year=fiscal_year)

    aggregate: dict[str, dict[str, Any]] = {}
    for row in rows:
        code = str(row.get("sector_code") or "").strip()
        name = str(row.get("sector_name") or "").strip()
        key = f"{code}|{name}"
        bucket = aggregate.get(key)
        if bucket is None:
            bucket = {
                "sector_code": code or None,
                "sector_name": name or None,
                "total": 0.0,
                "count": 0,
            }
            aggregate[key] = bucket
        bucket["total"] = float(bucket["total"]) + (_num(row.get("total")) or 0.0)
        bucket["count"] = int(bucket["count"]) + 1

    ranked = sorted(aggregate.values(), key=lambda item: float(item["total"]), reverse=True)
    if not ranked:
        return None

    scope_label = _scope_label(targets)
    fy_label = f"FY {fiscal_year}" if fiscal_year is not None else "All fiscal years"
    lines = []
    for index, row in enumerate(ranked, start=1):
        label = " - ".join([value for value in [row.get("sector_code"), row.get("sector_name")] if value]) or "Unspecified sector"
        lines.append(f"{index}. {label}: {_php(_num(row.get('total')))} ({int(row.get('count') or 0)} items)")

    answer = f"Budget totals by sector ({scope_label}; {fy_label}):\n" + "\n".join(lines)
    citations = [
        _sys_cite(
            "S0",
            "Aggregated from published AIP line items by sector.",
            {
                "type": "aip_line_items",
                "aggregate_type": "totals_by_sector",
                "fiscal_year_filter": fiscal_year,
                "bucket_count": len(ranked),
            },
        )
    ]
    return _response(
        question=question,
        answer=answer,
        citations=citations,
        route_family="aggregate_sql",
        extra_meta={"aggregation": "totals_by_sector", "fiscal_year_filter": fiscal_year},
    )


def _answer_totals_by_fund_source(
    *,
    supabase: Any,
    question: str,
    targets: list[dict[str, str]],
    fiscal_year: int | None,
) -> dict[str, Any] | None:
    aips = _fetch_aips(supabase=supabase, fiscal_year=fiscal_year, targets=targets)
    if not aips:
        return None
    aip_ids = [str(row.get("id")) for row in aips if row.get("id")]
    rows = _fetch_line_items(supabase=supabase, aip_ids=aip_ids, fiscal_year=fiscal_year)

    aggregate: dict[str, dict[str, Any]] = {}
    for row in rows:
        label = str(row.get("fund_source") or "").strip() or "Unspecified"
        bucket = aggregate.get(label)
        if bucket is None:
            bucket = {"fund_source": label, "total": 0.0, "count": 0}
            aggregate[label] = bucket
        bucket["total"] = float(bucket["total"]) + (_num(row.get("total")) or 0.0)
        bucket["count"] = int(bucket["count"]) + 1

    ranked = sorted(aggregate.values(), key=lambda item: float(item["total"]), reverse=True)
    if not ranked:
        return None

    scope_label = _scope_label(targets)
    fy_label = f"FY {fiscal_year}" if fiscal_year is not None else "All fiscal years"
    lines = [
        f"{index}. {str(row.get('fund_source') or 'Unspecified')}: {_php(_num(row.get('total')))} ({int(row.get('count') or 0)} items)"
        for index, row in enumerate(ranked, start=1)
    ]

    answer = f"Budget totals by fund source ({scope_label}; {fy_label}):\n" + "\n".join(lines)
    citations = [
        _sys_cite(
            "S0",
            "Aggregated from published AIP line items by fund source.",
            {
                "type": "aip_line_items",
                "aggregate_type": "totals_by_fund_source",
                "fiscal_year_filter": fiscal_year,
                "bucket_count": len(ranked),
            },
        )
    ]
    return _response(
        question=question,
        answer=answer,
        citations=citations,
        route_family="aggregate_sql",
        extra_meta={"aggregation": "totals_by_fund_source", "fiscal_year_filter": fiscal_year},
    )


def _answer_compare_years(
    *,
    supabase: Any,
    question: str,
    targets: list[dict[str, str]],
    year_a: int,
    year_b: int,
) -> dict[str, Any] | None:
    aips_a = _fetch_aips(supabase=supabase, fiscal_year=year_a, targets=targets)
    aips_b = _fetch_aips(supabase=supabase, fiscal_year=year_b, targets=targets)
    if not aips_a or not aips_b:
        return None

    total_a = _sum_line_item_totals(supabase=supabase, aip_ids=[str(row.get("id")) for row in aips_a if row.get("id")])
    total_b = _sum_line_item_totals(supabase=supabase, aip_ids=[str(row.get("id")) for row in aips_b if row.get("id")])
    if total_a is None or total_b is None:
        return None

    diff = total_a - total_b
    if diff > 0:
        trend = f"FY {year_a} is higher than FY {year_b} by {_php(diff)}."
    elif diff < 0:
        trend = f"FY {year_a} is lower than FY {year_b} by {_php(abs(diff))}."
    else:
        trend = f"FY {year_a} and FY {year_b} are equal."

    scope_label = _scope_label(targets)
    answer = (
        f"Comparison for {scope_label}: FY {year_a} total is {_php(total_a)}; "
        f"FY {year_b} total is {_php(total_b)}. {trend}"
    )

    return _response(
        question=question,
        answer=answer,
        citations=[
            _sys_cite(
                "S0",
                "Computed from published AIP line-item totals for both fiscal years.",
                {
                    "type": "aip_line_items",
                    "aggregate_type": "compare_years",
                    "year_a": year_a,
                    "year_b": year_b,
                },
            )
        ],
        route_family="aggregate_sql",
        extra_meta={"aggregation": "compare_years", "year_a": year_a, "year_b": year_b},
    )


def _answer_line_item(
    *,
    supabase: Any,
    question: str,
    normalized: str,
    targets: list[dict[str, str]],
    fiscal_year: int | None,
) -> dict[str, Any] | None:
    ref_match = REF_RE.search(question)
    if not ref_match:
        return _response(
            question=question,
            answer="Please provide the exact line-item reference code (for example: 2025-001-001-001).",
            citations=[_sys_cite("S0", "Line-item lookup requires a specific reference code.", {"route": "row_sql"})],
            route_family="row_sql",
            status="clarification",
            reason="clarification_needed",
        )

    ref_code = ref_match.group(0).upper()
    aips = _fetch_aips(supabase=supabase, fiscal_year=fiscal_year, targets=targets)
    if not aips:
        return None
    aip_ids = [str(row.get("id")) for row in aips if row.get("id")]

    query = (
        supabase.table("aip_line_items")
        .select(
            "id,aip_id,fiscal_year,barangay_id,aip_ref_code,program_project_title,implementing_agency,"
            "start_date,end_date,fund_source,total,expected_output,page_no,row_no,table_no"
        )
        .in_("aip_id", aip_ids)
        .ilike("aip_ref_code", ref_code)
    )
    rows = list((query.execute().data or []))

    if not rows:
        query = (
            supabase.table("aip_line_items")
            .select(
                "id,aip_id,fiscal_year,barangay_id,aip_ref_code,program_project_title,implementing_agency,"
                "start_date,end_date,fund_source,total,expected_output,page_no,row_no,table_no"
            )
            .in_("aip_id", aip_ids)
            .ilike("aip_ref_code", f"%{ref_code}%")
        )
        rows = list((query.execute().data or []))

    if not rows:
        return None

    rows.sort(
        key=lambda row: (int(row.get("fiscal_year") or 0), _num(row.get("total")) or 0.0),
        reverse=True,
    )
    row = rows[0]

    title = str(row.get("program_project_title") or "the selected line item").strip()
    fields = _extract_fact_fields(normalized)
    clauses: list[str] = []

    for field in fields:
        if field == "amount":
            clauses.append(f"total allocation: {_php(_num(row.get('total')))}")
        elif field == "schedule":
            clauses.append(f"schedule: {_format_schedule(row.get('start_date'), row.get('end_date'))}")
        elif field == "fund_source":
            clauses.append(f"fund source: {str(row.get('fund_source') or 'N/A').strip() or 'N/A'}")
        elif field == "implementing_agency":
            clauses.append(f"implementing agency: {str(row.get('implementing_agency') or 'N/A').strip() or 'N/A'}")
        elif field == "expected_output":
            clauses.append(f"expected output: {str(row.get('expected_output') or 'N/A').strip() or 'N/A'}")

    answer = f"For {title} (Ref {str(row.get('aip_ref_code') or ref_code)}), " + "; ".join(clauses) + "."

    citation = {
        "source_id": "L1",
        "aip_id": row.get("aip_id"),
        "fiscal_year": row.get("fiscal_year"),
        "scope_type": "barangay",
        "scope_id": row.get("barangay_id"),
        "scope_name": title,
        "snippet": (
            f"{title} - Fund: {str(row.get('fund_source') or 'N/A').strip() or 'N/A'} - "
            f"Schedule: {_format_schedule(row.get('start_date'), row.get('end_date'))} - "
            f"Total: {_php(_num(row.get('total')))}"
        ),
        "insufficient": False,
        "metadata": {
            "type": "aip_line_item",
            "line_item_id": row.get("id"),
            "aip_ref_code": row.get("aip_ref_code"),
            "page_no": row.get("page_no"),
            "row_no": row.get("row_no"),
            "table_no": row.get("table_no"),
        },
    }

    return _response(
        question=question,
        answer=answer,
        citations=[citation],
        route_family="row_sql",
        extra_meta={"aip_ref_code": str(row.get("aip_ref_code") or ref_code)},
    )

def _answer_metadata(
    *,
    supabase: Any,
    question: str,
    intent: str,
    targets: list[dict[str, str]],
    fiscal_year: int | None,
) -> dict[str, Any]:
    apply_year_filter = intent != "years"
    aips = _fetch_aips(
        supabase=supabase,
        fiscal_year=fiscal_year if apply_year_filter else None,
        targets=targets,
    )
    scope_label = _scope_label(targets)

    if intent == "years":
        years = sorted({int(row.get("fiscal_year")) for row in aips if _int(row.get("fiscal_year")) is not None})
        if not years:
            answer = f"No published fiscal years are available for {scope_label}."
            value_count = 0
        else:
            items = [f"{index}. FY {year}" for index, year in enumerate(years, start=1)]
            answer = f"Available fiscal years ({scope_label}):\n" + "\n".join(items)
            value_count = len(years)

        return _response(
            question=question,
            answer=answer,
            citations=[
                _sys_cite(
                    "S0",
                    "Computed from published AIP metadata.",
                    {"type": "metadata_sql", "metadata_intent": "years", "value_count": value_count},
                )
            ],
            route_family="metadata_sql",
            extra_meta={"metadata_intent": "years"},
        )

    aip_ids = [str(row.get("id")) for row in aips if row.get("id")]
    values: list[str] = []
    title = "Metadata"

    if intent == "sectors":
        rows = list((supabase.table("aip_line_items").select("sector_code,sector_name").in_("aip_id", aip_ids).execute().data) or [])
        for row in rows:
            code = str(row.get("sector_code") or "").strip()
            name = str(row.get("sector_name") or "").strip()
            if code and name:
                values.append(f"{name} ({code})")
            elif name:
                values.append(name)
            elif code:
                values.append(code)
        title = "Sectors"
    elif intent == "fund_sources":
        rows = list((supabase.table("aip_line_items").select("fund_source").in_("aip_id", aip_ids).execute().data) or [])
        values = [str(row.get("fund_source") or "").strip() or "Unspecified" for row in rows]
        title = "Fund sources"
    elif intent == "project_categories":
        rows = list((supabase.table("projects").select("category,aip_id").in_("aip_id", aip_ids).execute().data) or [])
        for row in rows:
            raw = str(row.get("category") or "").strip()
            if not raw:
                continue
            values.append(" ".join(part.capitalize() for part in raw.split("_")))
        title = "Project categories"
    elif intent == "agencies":
        rows = list((supabase.table("aip_line_items").select("implementing_agency").in_("aip_id", aip_ids).execute().data) or [])
        values = [str(row.get("implementing_agency") or "").strip() for row in rows if str(row.get("implementing_agency") or "").strip()]
        title = "Implementing agencies"
    else:
        barangay_ids = sorted({str(row.get("barangay_id") or "").strip() for row in aips if str(row.get("barangay_id") or "").strip()})
        city_ids = sorted({str(row.get("city_id") or "").strip() for row in aips if str(row.get("city_id") or "").strip()})
        municipality_ids = sorted(
            {str(row.get("municipality_id") or "").strip() for row in aips if str(row.get("municipality_id") or "").strip()}
        )
        barangay_map = _fetch_name_map(supabase=supabase, table="barangays", ids=barangay_ids)
        city_map = _fetch_name_map(supabase=supabase, table="cities", ids=city_ids)
        municipality_map = _fetch_name_map(supabase=supabase, table="municipalities", ids=municipality_ids)

        for scope_id in barangay_ids:
            name = barangay_map.get(scope_id)
            if name:
                values.append(name if name.lower().startswith("barangay ") else f"Barangay {name}")
        for scope_id in city_ids:
            name = city_map.get(scope_id)
            if name:
                values.append(name if "city" in name.lower() else f"City {name}")
        for scope_id in municipality_ids:
            name = municipality_map.get(scope_id)
            if name:
                values.append(name if "municipality" in name.lower() else f"Municipality {name}")
        title = "Available scopes"

    unique_values = sorted({value for value in values if value})
    if unique_values:
        fiscal_label = f"; FY {fiscal_year}" if apply_year_filter and fiscal_year is not None else ""
        list_lines = [f"{index}. {value}" for index, value in enumerate(unique_values, start=1)]
        answer = f"{title} ({scope_label}{fiscal_label}):\n" + "\n".join(list_lines)
    else:
        fiscal_label = f" for FY {fiscal_year}" if apply_year_filter and fiscal_year is not None else ""
        answer = f"No {title.lower()} were found for {scope_label}{fiscal_label}."

    return _response(
        question=question,
        answer=answer,
        citations=[
            _sys_cite(
                "S0",
                "Computed from structured published AIP SQL tables.",
                {
                    "type": "metadata_sql",
                    "metadata_intent": intent,
                    "fiscal_year_filter": fiscal_year if apply_year_filter else None,
                    "value_count": len(unique_values),
                },
            )
        ],
        route_family="metadata_sql",
        extra_meta={"metadata_intent": intent, "fiscal_year_filter": fiscal_year if apply_year_filter else None},
    )


def maybe_answer_with_sql(
    *,
    supabase_url: str,
    supabase_service_key: str,
    question: str,
    retrieval_scope: dict[str, Any] | None,
    retrieval_filters: dict[str, Any] | None,
) -> dict[str, Any] | None:
    normalized = _norm(question)
    if not normalized:
        return None
    exhaustive = detect_exhaustive_intent(question)

    from supabase.client import create_client

    supabase = create_client(supabase_url, supabase_service_key)
    targets = _targets(retrieval_scope)

    explicit_years = _years(question)
    fiscal_year_filter = _int((retrieval_filters or {}).get("fiscal_year"))
    fiscal_year = fiscal_year_filter if fiscal_year_filter is not None else (explicit_years[0] if explicit_years else None)

    metadata_intent = _detect_metadata(normalized)
    if metadata_intent is not None:
        try:
            return _answer_metadata(
                supabase=supabase,
                question=question,
                intent=metadata_intent,
                targets=targets,
                fiscal_year=fiscal_year,
            )
        except Exception:
            return None

    if _is_compare_years(normalized):
        if len(explicit_years) < 2:
            return _response(
                question=question,
                answer="Please provide two fiscal years to compare (for example: FY 2025 vs FY 2026).",
                citations=[_sys_cite("S0", "Comparison query needs two fiscal years.", {"route": "aggregate_sql"})],
                route_family="aggregate_sql",
                status="clarification",
                reason="clarification_needed",
            )
        try:
            result = _answer_compare_years(
                supabase=supabase,
                question=question,
                targets=targets,
                year_a=explicit_years[0],
                year_b=explicit_years[1],
            )
            if result is not None:
                return result
        except Exception:
            return None

    if _is_totals(normalized):
        try:
            result = _answer_totals(
                supabase=supabase,
                question=question,
                targets=targets,
                fiscal_year=fiscal_year,
            )
            if result is not None:
                return result
        except Exception:
            return None

    aggregation_intent = _detect_aggregation(normalized)
    if aggregation_intent is not None:
        try:
            if aggregation_intent == "filtered_project_list":
                return _answer_filtered_project_list(
                    supabase=supabase,
                    question=question,
                    normalized=normalized,
                    targets=targets,
                    fiscal_year=fiscal_year,
                    exhaustive_signal=exhaustive["exhaustive_signal"],
                )
            if aggregation_intent == "top_projects":
                return _answer_top_projects(
                    supabase=supabase,
                    question=question,
                    targets=targets,
                    fiscal_year=fiscal_year,
                    limit=_parse_top_limit(normalized),
                )
            if aggregation_intent == "totals_by_sector":
                return _answer_totals_by_sector(
                    supabase=supabase,
                    question=question,
                    targets=targets,
                    fiscal_year=fiscal_year,
                )
            if aggregation_intent == "totals_by_fund_source":
                return _answer_totals_by_fund_source(
                    supabase=supabase,
                    question=question,
                    targets=targets,
                    fiscal_year=fiscal_year,
                )
        except Exception:
            return None

    if _is_line_item_query(question, normalized):
        try:
            return _answer_line_item(
                supabase=supabase,
                question=question,
                normalized=normalized,
                targets=targets,
                fiscal_year=fiscal_year,
            )
        except Exception:
            return None

    return None
