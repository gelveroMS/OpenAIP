from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from openaip_pipeline.core.clock import now_utc_iso

ArtifactStage = Literal["extract", "validate", "scale_amounts", "summarize", "categorize"]
SourceRefKind = Literal["table_row", "text_block", "header", "footer", "unknown"]
LguType = Literal["city", "barangay", "municipality", "unknown"]
DocumentType = Literal["AIP", "BAIP", "unknown"]
SignatoryRole = Literal["prepared_by", "attested_by", "reviewed_by", "approved_by", "other"]
ProjectCategory = Literal["health", "infrastructure", "other"]
SectorCode = Literal["1000", "3000", "8000", "9000", "unknown"]

SCHEMA_VERSION = "aip_artifact_v1.1.0"
SCHEMA_VERSION_PATTERN = re.compile(r"^aip_artifact_v1\.\d+\.\d+$")
KNOWN_SECTOR_PREFIXES = ("1000", "3000", "8000", "9000")
AMOUNT_NULL_MARKERS = {"", "n/a", "na", "none", "-", "—", "–"}


def _hash_sha1(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()


def normalize_whitespace(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_identifier(value: Any) -> str | None:
    text = normalize_whitespace(value)
    return text or None


def normalize_description(value: Any) -> str | None:
    text = normalize_whitespace(value)
    return text or None


def normalize_text(value: Any) -> str | None:
    text = normalize_whitespace(value)
    if not text:
        return None
    lowered = text.lower()
    if lowered in {"n/a", "na", "none"}:
        return None
    return text


def to_amount_raw(value: Any) -> str | None:
    text = normalize_whitespace(value)
    return text or None


def parse_amount(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = normalize_whitespace(value)
    if not text:
        return None
    if text.lower() in AMOUNT_NULL_MARKERS:
        return None
    percent_match = re.fullmatch(r"\(?\s*([0-9]+(?:\.[0-9]+)?)\s*%\s*\)?", text)
    if percent_match:
        return float(percent_match.group(1))
    cleaned = (
        text.replace("₱", "")
        .replace("PHP", "")
        .replace("Php", "")
        .replace(",", "")
        .replace(" ", "")
        .strip()
    )
    negative = cleaned.startswith("(") and cleaned.endswith(")")
    if negative:
        cleaned = cleaned[1:-1].strip()
    try:
        parsed = float(cleaned)
    except ValueError:
        return None
    return -parsed if negative else parsed


def normalize_category(value: Any) -> ProjectCategory:
    lowered = normalize_whitespace(value).lower()
    if lowered in {"health", "healthcare"}:
        return "health"
    if lowered == "infrastructure":
        return "infrastructure"
    return "other"


def infer_sector_code(aip_ref_code: Any) -> SectorCode:
    ref_code = normalize_identifier(aip_ref_code) or ""
    for prefix in KNOWN_SECTOR_PREFIXES:
        if ref_code.startswith(prefix):
            return prefix
    return "unknown"


def compute_row_signature(project: dict[str, Any]) -> str:
    amounts = project.get("amounts") if isinstance(project.get("amounts"), dict) else {}
    payload = [
        normalize_identifier(project.get("aip_ref_code")) or "",
        normalize_description(project.get("program_project_description")) or "",
        normalize_identifier(project.get("implementing_agency")) or "",
        to_amount_raw(amounts.get("total_raw")) or "",
    ]
    return _hash_sha1("|".join(payload))


def compute_anchor_hash(
    *,
    evidence_text: Any,
    page: Any,
    row_index: Any,
    table_index: Any,
    kind: Any,
    row_signature: Any,
) -> str:
    payload = [
        normalize_whitespace(evidence_text),
        normalize_whitespace(page),
        normalize_whitespace(row_index),
        normalize_whitespace(table_index),
        normalize_whitespace(kind),
        normalize_whitespace(row_signature),
    ]
    return _hash_sha1("|".join(payload))


class SourceRef(BaseModel):
    model_config = ConfigDict(extra="allow")

    page: int
    kind: SourceRefKind
    table_index: int | None = None
    row_index: int | None = None
    evidence_text: str | None = None
    bbox: list[float] | None = None
    anchor_hash: str | None = None
    row_signature: str | None = None

    @field_validator("page")
    @classmethod
    def _validate_page(cls, value: int) -> int:
        if value == -1 or value >= 1:
            return value
        raise ValueError("source_refs.page must be >= 1 or -1.")

    @field_validator("evidence_text", mode="before")
    @classmethod
    def _normalize_evidence(cls, value: Any) -> str | None:
        text = normalize_whitespace(value)
        return text[:200] if text else None

    @field_validator("bbox")
    @classmethod
    def _validate_bbox(cls, value: list[float] | None) -> list[float] | None:
        if value is None:
            return None
        if len(value) != 4:
            raise ValueError("source_refs.bbox must contain exactly 4 numbers.")
        return value

    @model_validator(mode="after")
    def _derive_hashes(self) -> SourceRef:
        self.row_signature = normalize_identifier(self.row_signature)
        self.anchor_hash = normalize_identifier(self.anchor_hash) or compute_anchor_hash(
            evidence_text=self.evidence_text,
            page=self.page,
            row_index=self.row_index,
            table_index=self.table_index,
            kind=self.kind,
            row_signature=self.row_signature,
        )
        return self


class WarningEntry(BaseModel):
    model_config = ConfigDict(extra="allow")

    code: str
    message: str
    details: dict[str, Any] | None = None
    source_refs: list[SourceRef] = Field(default_factory=list)

    @field_validator("code", "message", mode="before")
    @classmethod
    def _required_text(cls, value: Any) -> str:
        text = normalize_whitespace(value)
        if not text:
            raise ValueError("warning code/message must be non-empty.")
        return text


class LguInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    type: LguType
    confidence: Literal["low", "medium", "high"] | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _normalize_name(cls, value: Any) -> str:
        return normalize_whitespace(value) or "Unknown LGU"


class DocumentSource(BaseModel):
    model_config = ConfigDict(extra="allow")

    document_type: DocumentType
    page_count: int | None = None

    @field_validator("page_count")
    @classmethod
    def _validate_page_count(cls, value: int | None) -> int | None:
        if value is None or value >= 1:
            return value
        raise ValueError("document.source.page_count must be >= 1.")


class SignatoryEntry(BaseModel):
    model_config = ConfigDict(extra="allow")

    role: SignatoryRole
    name_text: str | None = None
    position_text: str | None = None
    office_text: str | None = None
    source_refs: list[SourceRef] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_refs(self) -> SignatoryEntry:
        if not self.source_refs:
            raise ValueError("signatories entries require at least one source_ref.")
        return self


class DocumentMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    lgu: LguInfo
    fiscal_year: int
    signatories: list[SignatoryEntry] | None = None
    source: DocumentSource

    @field_validator("fiscal_year")
    @classmethod
    def _validate_fiscal_year(cls, value: int) -> int:
        if 2000 <= value <= 2100:
            return value
        raise ValueError("fiscal_year must be within 2000..2100.")


class Amounts(BaseModel):
    model_config = ConfigDict(extra="allow")

    personal_services_raw: str | None = None
    mooe_raw: str | None = None
    financial_expenses_raw: str | None = None
    capital_outlay_raw: str | None = None
    total_raw: str | None = None

    personal_services: float | None = None
    maintenance_and_other_operating_expenses: float | None = None
    financial_expenses: float | None = None
    capital_outlay: float | None = None
    total: float | None = None


class ClimateFields(BaseModel):
    model_config = ConfigDict(extra="allow")

    climate_change_adaptation: str | None = None
    climate_change_mitigation: str | None = None
    cc_topology_code: str | None = None
    prm_ncr_lgu_rm_objective_results_indicator: str | None = None


class Classification(BaseModel):
    model_config = ConfigDict(extra="allow")

    sector_code: SectorCode
    category: ProjectCategory


class ProjectArtifact(BaseModel):
    model_config = ConfigDict(extra="allow")

    project_key: str
    aip_ref_code: str | None = None
    program_project_description: str
    implementing_agency: str | None = None
    start_date: str | None = None
    completion_date: str | None = None
    expected_output: str | None = None
    source_of_funds: str | None = None

    amounts: Amounts
    climate: ClimateFields | None = None
    classification: Classification | None = None

    errors: list[str] | None = None
    source_refs: list[SourceRef] = Field(default_factory=list)

    @field_validator("project_key", "program_project_description", mode="before")
    @classmethod
    def _required_text(cls, value: Any) -> str:
        text = normalize_whitespace(value)
        if not text:
            raise ValueError("project_key and program_project_description are required.")
        return text

    @model_validator(mode="after")
    def _validate_source_refs(self) -> ProjectArtifact:
        if not self.source_refs:
            raise ValueError("projects entries require source_refs.")
        return self


class SummaryArtifact(BaseModel):
    model_config = ConfigDict(extra="allow")

    text: str
    source_refs: list[SourceRef] = Field(default_factory=list)
    evidence_project_keys: list[str] | None = None

    @field_validator("text", mode="before")
    @classmethod
    def _normalize_text(cls, value: Any) -> str:
        text = normalize_whitespace(value)
        if not text:
            raise ValueError("summary.text is required.")
        return text

    @model_validator(mode="after")
    def _validate_refs(self) -> SummaryArtifact:
        if not self.source_refs:
            raise ValueError("summary.source_refs requires at least one citation.")
        if self.evidence_project_keys is not None:
            cleaned = [normalize_identifier(item) for item in self.evidence_project_keys]
            self.evidence_project_keys = [item for item in cleaned if item]
        return self


class QualitySignals(BaseModel):
    model_config = ConfigDict(extra="allow")

    missing_provenance_count: int = 0
    missing_total_count: int = 0
    parse_fail_amount_count: int = 0
    missing_lgu_confidence: int = 0
    signatory_incomplete_count: int = 0
    project_key_normalized_changes_count: int = 0


class QualityArtifact(BaseModel):
    model_config = ConfigDict(extra="allow")

    score: int
    signals: QualitySignals

    @field_validator("score")
    @classmethod
    def _clamp_score(cls, value: int) -> int:
        return max(0, min(100, int(value)))


class ArtifactRoot(BaseModel):
    model_config = ConfigDict(extra="allow")

    schema_version: str = SCHEMA_VERSION
    generated_at: str
    stage: ArtifactStage
    aip_id: str
    uploaded_file_id: str | None = None
    document: DocumentMetadata
    projects: list[ProjectArtifact] = Field(default_factory=list)
    summary: SummaryArtifact | None = None
    warnings: list[WarningEntry] = Field(default_factory=list)
    quality: QualityArtifact | None = None

    @field_validator("schema_version")
    @classmethod
    def _validate_schema_version(cls, value: str) -> str:
        if not SCHEMA_VERSION_PATTERN.match(value):
            raise ValueError("schema_version must match aip_artifact_v1.<minor>.<patch>.")
        return value

    @field_validator("generated_at")
    @classmethod
    def _validate_generated_at(cls, value: str) -> str:
        text = normalize_whitespace(value)
        if not text:
            raise ValueError("generated_at is required.")
        return text

    @field_validator("aip_id", mode="before")
    @classmethod
    def _validate_aip_id(cls, value: Any) -> str:
        text = normalize_whitespace(value)
        if not text:
            raise ValueError("aip_id is required.")
        return text

    @model_validator(mode="after")
    def _validate_stage_requirements(self) -> ArtifactRoot:
        if self.stage == "summarize" and self.summary is None:
            raise ValueError("summary is required for summarize stage.")
        if self.stage == "categorize":
            for project in self.projects:
                if project.classification is None:
                    raise ValueError("classification is required for categorize stage.")
        return self


def normalize_source_refs(value: Any, *, default_kind: SourceRefKind = "unknown") -> list[dict[str, Any]]:
    refs_in = value if isinstance(value, list) else []
    refs_out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for ref in refs_in:
        if not isinstance(ref, dict):
            continue
        page = ref.get("page", -1)
        kind = ref.get("kind", default_kind)
        try:
            parsed_page = int(page)
        except (TypeError, ValueError):
            parsed_page = -1
        parsed_kind = normalize_whitespace(kind).lower() if kind is not None else str(default_kind)
        if parsed_kind not in {"table_row", "text_block", "header", "footer", "unknown"}:
            parsed_kind = "unknown"
        row_signature = normalize_identifier(ref.get("row_signature"))
        evidence_text = normalize_whitespace(ref.get("evidence_text")) or None
        normalized = {
            "page": parsed_page,
            "kind": parsed_kind,
            "table_index": ref.get("table_index"),
            "row_index": ref.get("row_index"),
            "evidence_text": evidence_text[:200] if evidence_text else None,
            "bbox": ref.get("bbox"),
            "row_signature": row_signature,
            "anchor_hash": normalize_identifier(ref.get("anchor_hash"))
            or compute_anchor_hash(
                evidence_text=evidence_text,
                page=parsed_page,
                row_index=ref.get("row_index"),
                table_index=ref.get("table_index"),
                kind=parsed_kind,
                row_signature=row_signature,
            ),
        }
        key = json.dumps(normalized, sort_keys=True, ensure_ascii=False)
        if key in seen:
            continue
        seen.add(key)
        refs_out.append(normalized)
    refs_out.sort(key=lambda item: (item.get("page", -1), item.get("table_index") or -1, item.get("row_index") or -1))
    return refs_out


def make_source_ref(
    *,
    page: int,
    kind: SourceRefKind,
    table_index: int | None = None,
    row_index: int | None = None,
    evidence_text: str | None = None,
    bbox: list[float] | None = None,
    row_signature: str | None = None,
) -> dict[str, Any]:
    evidence = normalize_whitespace(evidence_text) or None
    row_sig = normalize_identifier(row_signature)
    return {
        "page": page,
        "kind": kind,
        "table_index": table_index,
        "row_index": row_index,
        "evidence_text": evidence[:200] if evidence else None,
        "bbox": bbox,
        "row_signature": row_sig,
        "anchor_hash": compute_anchor_hash(
            evidence_text=evidence,
            page=page,
            row_index=row_index,
            table_index=table_index,
            kind=kind,
            row_signature=row_sig,
        ),
    }


def enrich_project_source_refs(project: dict[str, Any]) -> dict[str, Any]:
    row_signature = compute_row_signature(project)
    refs = normalize_source_refs(project.get("source_refs"), default_kind="table_row")
    enriched: list[dict[str, Any]] = []
    for ref in refs:
        row_sig = normalize_identifier(ref.get("row_signature")) or row_signature
        enriched.append(
            {
                **ref,
                "row_signature": row_sig,
                "anchor_hash": compute_anchor_hash(
                    evidence_text=ref.get("evidence_text"),
                    page=ref.get("page"),
                    row_index=ref.get("row_index"),
                    table_index=ref.get("table_index"),
                    kind=ref.get("kind"),
                    row_signature=row_sig,
                ),
            }
        )
    project["source_refs"] = enriched
    return project


def build_project_key(project: dict[str, Any]) -> str:
    ref_code = normalize_identifier(project.get("aip_ref_code"))
    if ref_code:
        return ref_code
    amounts = project.get("amounts") if isinstance(project.get("amounts"), dict) else {}
    key_payload = {
        "program_project_description": normalize_description(project.get("program_project_description")),
        "implementing_agency": normalize_identifier(project.get("implementing_agency")),
        "start_date": normalize_identifier(project.get("start_date")),
        "completion_date": normalize_identifier(project.get("completion_date")),
        "expected_output": normalize_description(project.get("expected_output")),
        "source_of_funds": normalize_description(project.get("source_of_funds")),
        "amounts_raw": {
            "personal_services_raw": to_amount_raw(amounts.get("personal_services_raw")),
            "mooe_raw": to_amount_raw(amounts.get("mooe_raw")),
            "financial_expenses_raw": to_amount_raw(amounts.get("financial_expenses_raw")),
            "capital_outlay_raw": to_amount_raw(amounts.get("capital_outlay_raw")),
            "total_raw": to_amount_raw(amounts.get("total_raw")),
        },
    }
    digest = _hash_sha1(json.dumps(key_payload, sort_keys=True, ensure_ascii=False))
    return f"hash:{digest[:16]}"


def ensure_project_has_provenance(
    project: dict[str, Any],
    *,
    missing_message: str = "missing provenance: page unknown",
) -> dict[str, Any]:
    refs = normalize_source_refs(project.get("source_refs"), default_kind="table_row")
    if not refs:
        refs = [make_source_ref(page=-1, kind="unknown", evidence_text=missing_message)]
        existing_errors = project.get("errors")
        if existing_errors is None:
            project["errors"] = [f"R_PROVENANCE {missing_message}"]
        elif isinstance(existing_errors, list):
            merged = [str(item) for item in existing_errors]
            if not any("R_PROVENANCE" in item for item in merged):
                merged.append(f"R_PROVENANCE {missing_message}")
            project["errors"] = merged
        else:
            project["errors"] = [str(existing_errors), f"R_PROVENANCE {missing_message}"]
    project["source_refs"] = refs
    return enrich_project_source_refs(project)


def _project_display_key(project: dict[str, Any]) -> str | None:
    return normalize_identifier(project.get("project_key")) or normalize_identifier(project.get("aip_ref_code"))


def collect_summary_evidence(
    projects: list[dict[str, Any]],
    summary_text: str | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    if not projects:
        return [{"page": -1, "kind": "unknown"}], []

    normalized_summary = normalize_whitespace(summary_text).lower() if summary_text else ""
    indexed_projects = [project for project in projects if isinstance(project, dict)]
    ranked_totals = sorted(
        [
            project
            for project in indexed_projects
            if isinstance(
                (project.get("amounts") if isinstance(project.get("amounts"), dict) else {}).get("total"),
                (int, float),
            )
        ],
        key=lambda item: float((item.get("amounts") or {}).get("total") or 0),
        reverse=True,
    )
    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()

    def add_project(project: dict[str, Any]) -> None:
        key = _project_display_key(project)
        if not key or key in selected_ids:
            return
        selected_ids.add(key)
        selected.append(project)

    for project in ranked_totals[:3]:
        add_project(project)

    for project in indexed_projects:
        errors = project.get("errors")
        has_errors = isinstance(errors, list) and any(normalize_whitespace(item) for item in errors)
        if has_errors:
            add_project(project)

    if normalized_summary:
        for project in indexed_projects:
            description = normalize_description(project.get("program_project_description")) or ""
            ref_code = normalize_identifier(project.get("aip_ref_code")) or ""
            key = _project_display_key(project) or ""
            if description and len(description) >= 12 and description.lower() in normalized_summary:
                add_project(project)
                continue
            if ref_code and ref_code.lower() in normalized_summary:
                add_project(project)
                continue
            if key and key.lower() in normalized_summary:
                add_project(project)

    if not selected:
        selected = indexed_projects[:3]

    refs: list[dict[str, Any]] = []
    seen: set[str] = set()
    evidence_keys: list[str] = []
    for project in selected:
        evidence_key = _project_display_key(project)
        if evidence_key:
            evidence_keys.append(evidence_key)
        for ref in normalize_source_refs(project.get("source_refs"), default_kind="table_row"):
            page = ref.get("page")
            if not isinstance(page, int) or page < 1:
                continue
            key = json.dumps(ref, sort_keys=True, ensure_ascii=False)
            if key in seen:
                continue
            seen.add(key)
            refs.append(ref)
    refs.sort(key=lambda item: (item.get("page", -1), item.get("table_index") or -1, item.get("row_index") or -1))
    if not refs:
        refs = [{"page": -1, "kind": "unknown"}]
    return refs, evidence_keys


def collect_summary_source_refs(
    projects: list[dict[str, Any]],
    summary_text: str | None = None,
) -> list[dict[str, Any]]:
    refs, _ = collect_summary_evidence(projects, summary_text=summary_text)
    return refs


def compute_quality(
    *,
    projects: list[dict[str, Any]],
    document: dict[str, Any],
    warnings: list[dict[str, Any]] | None = None,
    project_key_normalized_changes_count: int = 0,
) -> dict[str, Any]:
    warnings_list = warnings if isinstance(warnings, list) else []
    missing_provenance_count = 0
    missing_total_count = 0
    parse_fail_amount_count = 0
    for project in projects:
        if not isinstance(project, dict):
            continue
        refs = normalize_source_refs(project.get("source_refs"), default_kind="table_row")
        if not any(isinstance(ref.get("page"), int) and ref.get("page", -1) >= 1 for ref in refs):
            missing_provenance_count += 1
        amounts = project.get("amounts") if isinstance(project.get("amounts"), dict) else {}
        if amounts.get("total") is None:
            missing_total_count += 1
        for raw_key, parsed_key in (
            ("personal_services_raw", "personal_services"),
            ("mooe_raw", "maintenance_and_other_operating_expenses"),
            ("financial_expenses_raw", "financial_expenses"),
            ("capital_outlay_raw", "capital_outlay"),
            ("total_raw", "total"),
        ):
            raw_value = to_amount_raw(amounts.get(raw_key))
            parsed_value = amounts.get(parsed_key)
            if raw_value is not None and parsed_value is None and raw_value.lower() not in AMOUNT_NULL_MARKERS:
                parse_fail_amount_count += 1
    lgu = document.get("lgu") if isinstance(document.get("lgu"), dict) else {}
    missing_lgu_confidence = 0 if normalize_identifier(lgu.get("confidence")) else 1
    signatory_incomplete_count = sum(1 for warning in warnings_list if str(warning.get("code")) == "SIGNATORY_PARSE_FAILED")
    signals = {
        "missing_provenance_count": missing_provenance_count,
        "missing_total_count": missing_total_count,
        "parse_fail_amount_count": parse_fail_amount_count,
        "missing_lgu_confidence": missing_lgu_confidence,
        "signatory_incomplete_count": signatory_incomplete_count,
        "project_key_normalized_changes_count": max(0, int(project_key_normalized_changes_count)),
    }
    score = 100
    score -= missing_provenance_count * 12
    score -= missing_total_count * 6
    score -= parse_fail_amount_count * 2
    score -= missing_lgu_confidence * 8
    score -= signatory_incomplete_count * 4
    score -= signals["project_key_normalized_changes_count"]
    score = max(0, min(100, score))
    return {"score": score, "signals": signals}


def make_stage_root(
    *,
    stage: ArtifactStage,
    aip_id: str,
    uploaded_file_id: str | None,
    document: dict[str, Any],
    projects: list[dict[str, Any]] | None = None,
    totals: list[dict[str, Any]] | None = None,
    summary: dict[str, Any] | None = None,
    warnings: list[dict[str, Any]] | None = None,
    quality: dict[str, Any] | None = None,
    generated_at: str | None = None,
    schema_version: str = SCHEMA_VERSION,
) -> dict[str, Any]:
    payload = {
        "schema_version": schema_version,
        "generated_at": generated_at or now_utc_iso(),
        "stage": stage,
        "aip_id": str(aip_id),
        "uploaded_file_id": str(uploaded_file_id) if uploaded_file_id else None,
        "document": document,
        "projects": projects or [],
        "totals": totals or [],
        "summary": summary,
        "warnings": warnings or [],
        "quality": quality,
    }
    return ArtifactRoot.model_validate(payload).model_dump(mode="python")
