from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from typing import Any

from openaip_pipeline.core.artifact_contract import SCHEMA_VERSION, make_stage_root
from openaip_pipeline.core.clock import now_utc_iso

_MULTIPLIER = Decimal("1000")
_PROJECT_AMOUNT_KEYS: tuple[str, ...] = (
    "personal_services",
    "maintenance_and_other_operating_expenses",
    "financial_expenses",
    "capital_outlay",
    "total",
)
_CLIMATE_KEYS: tuple[str, ...] = (
    "climate_change_adaptation",
    "climate_change_mitigation",
)


class ScaleAmountsResult:
    def __init__(self, *, scaled_obj: dict[str, Any], scaled_json_str: str, scope: str, scaled: bool):
        self.scaled_obj = scaled_obj
        self.scaled_json_str = scaled_json_str
        self.scope = scope
        self.scaled = scaled


def _fallback_document() -> dict[str, Any]:
    year = int(now_utc_iso()[:4])
    return {
        "lgu": {"name": "Unknown LGU", "type": "unknown"},
        "fiscal_year": year,
        "source": {"document_type": "unknown", "page_count": None},
    }


def _to_decimal(value: Any) -> Decimal | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return Decimal(str(value))
        except InvalidOperation:
            return None
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None

    normalized = (
        text.replace("\u20b1", "")
        .replace("PHP", "")
        .replace("php", "")
        .replace(",", "")
        .replace(" ", "")
    )
    if normalized.startswith("(") and normalized.endswith(")"):
        normalized = f"-{normalized[1:-1]}"
    if normalized in {"-", "\u2014", "\u2013"}:
        return None

    try:
        return Decimal(normalized)
    except InvalidOperation:
        return None


def _decimal_to_plain_text(value: Decimal) -> str:
    as_text = format(value, "f")
    if "." in as_text:
        as_text = as_text.rstrip("0").rstrip(".")
    return "0" if as_text in {"-0", ""} else as_text


def _scale_to_float(value: Any) -> float | None:
    dec = _to_decimal(value)
    if dec is None:
        return None
    return float(dec * _MULTIPLIER)


def _scale_to_numeric_text(value: Any) -> str | Any:
    dec = _to_decimal(value)
    if dec is None:
        return value
    return _decimal_to_plain_text(dec * _MULTIPLIER)


def _build_scale_stage_root(payload: dict[str, Any], *, projects: list[dict[str, Any]], totals: list[dict[str, Any]]) -> dict[str, Any]:
    return make_stage_root(
        stage="scale_amounts",
        aip_id=str(payload.get("aip_id") or "unknown-aip"),
        uploaded_file_id=str(payload.get("uploaded_file_id")) if payload.get("uploaded_file_id") else None,
        document=payload.get("document") if isinstance(payload.get("document"), dict) else _fallback_document(),
        projects=projects,
        totals=totals,
        summary=payload.get("summary") if isinstance(payload.get("summary"), dict) else None,
        warnings=payload.get("warnings") if isinstance(payload.get("warnings"), list) else [],
        quality=payload.get("quality") if isinstance(payload.get("quality"), dict) else None,
        generated_at=now_utc_iso(),
        schema_version=str(payload.get("schema_version") or SCHEMA_VERSION),
    )


def _clone_json_dict(value: dict[str, Any]) -> dict[str, Any]:
    # JSON roundtrip ensures we do not mutate caller-owned nested structures.
    return json.loads(json.dumps(value, ensure_ascii=False))


def scale_validated_amounts_json_str(validated_json_str: str, *, scope: str) -> ScaleAmountsResult:
    try:
        parsed = json.loads(validated_json_str)
    except json.JSONDecodeError as error:
        raise ValueError(f"Input is not valid JSON string: {error}") from error
    if not isinstance(parsed, dict):
        raise ValueError("Top-level JSON must be an object/dict.")
    projects = parsed.get("projects")
    if not isinstance(projects, list):
        raise ValueError('Top-level key "projects" must be a list.')

    copied = _clone_json_dict(parsed)
    copied_projects = copied.get("projects")
    if not isinstance(copied_projects, list):
        copied_projects = []
    copied_totals = copied.get("totals")
    if not isinstance(copied_totals, list):
        copied_totals = []

    lowered_scope = (scope or "").strip().lower()
    should_scale = lowered_scope == "city"

    if should_scale:
        for project in copied_projects:
            if not isinstance(project, dict):
                continue
            amounts = project.get("amounts")
            if isinstance(amounts, dict):
                for key in _PROJECT_AMOUNT_KEYS:
                    scaled_amount = _scale_to_float(amounts.get(key))
                    if scaled_amount is not None:
                        amounts[key] = scaled_amount
            climate = project.get("climate")
            if isinstance(climate, dict):
                for key in _CLIMATE_KEYS:
                    climate[key] = _scale_to_numeric_text(climate.get(key))

        for total in copied_totals:
            if not isinstance(total, dict):
                continue
            scaled_total = _scale_to_float(total.get("value"))
            if scaled_total is not None:
                total["value"] = scaled_total

    scaled_obj = _build_scale_stage_root(
        copied,
        projects=[project for project in copied_projects if isinstance(project, dict)],
        totals=[total for total in copied_totals if isinstance(total, dict)],
    )
    return ScaleAmountsResult(
        scaled_obj=scaled_obj,
        scaled_json_str=json.dumps(scaled_obj, ensure_ascii=False, indent=2),
        scope=lowered_scope or "unknown",
        scaled=should_scale,
    )
