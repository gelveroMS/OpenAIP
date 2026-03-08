from __future__ import annotations

import hashlib
import re
from typing import Any


_CITATION_CUE_PATTERN = re.compile(r"\b(with\s+citations?|cite\s+it|can\s+you\s+cite\s+it)\b", re.IGNORECASE)
_SPLIT_PATTERN = re.compile(r"\b(?:and then|then|and also|plus|and)\b", re.IGNORECASE)
_STOPWORD_PATTERN = re.compile(
    r"\b(?:what|does|the|aip|say|about|explain|summarize|summary|why|with|citations?|please|for|in|of|to)\b",
    re.IGNORECASE,
)


def _normalize_query(text: str) -> str:
    return " ".join((text or "").split()).strip()


def _query_topic(text: str) -> str:
    stripped = _STOPWORD_PATTERN.sub(" ", text)
    stripped = re.sub(r"[^a-z0-9\s-]", " ", stripped, flags=re.IGNORECASE)
    return _normalize_query(stripped)


def build_multi_query_variants(*, question: str, max_variants: int) -> list[str]:
    normalized = _normalize_query(question)
    if not normalized or max_variants <= 0:
        return []

    variants: list[str] = []

    no_citation = _normalize_query(_CITATION_CUE_PATTERN.sub("", normalized))
    if no_citation and no_citation.lower() != normalized.lower():
        variants.append(no_citation)

    parts = [_normalize_query(part) for part in _SPLIT_PATTERN.split(normalized) if _normalize_query(part)]
    if len(parts) > 1:
        for part in parts:
            if part.lower() != normalized.lower():
                variants.append(part)

    topic = _query_topic(normalized)
    if topic and len(topic.split()) >= 2:
        variants.append(f"What does the published AIP say about {topic}?")

    deduped: list[str] = []
    for variant in variants:
        lowered = variant.lower()
        if lowered == normalized.lower():
            continue
        if lowered in {entry.lower() for entry in deduped}:
            continue
        deduped.append(variant)
        if len(deduped) >= max_variants:
            break

    return deduped


def should_retry_multi_query(*, gate_decision: str, gate_reason: str) -> tuple[bool, str]:
    decision = (gate_decision or "").strip().lower()
    reason = (gate_reason or "").strip().lower()

    if decision == "allow":
        return False, "already_allowed"

    if reason in {"explicit_year_not_found", "no_final_candidates"}:
        return False, reason or "non_retryable_reason"

    if decision == "clarify" and reason in {"insufficient_final_candidates", "weak_topic_overlap"}:
        return True, reason

    return False, reason or "non_retryable_reason"


def multi_query_reason_code(reason: str) -> str:
    normalized = (reason or "").strip().lower()
    if normalized in {"insufficient_final_candidates", "weak_topic_overlap", "retryable_low_confidence"}:
        return "retry_low_confidence"
    if normalized == "already_allowed":
        return "allow_strong_evidence"
    if normalized == "not_attempted":
        return "not_attempted"
    if normalized in {"no_final_candidates", "explicit_year_not_found", "non_retryable_reason"}:
        return "refuse_no_evidence"
    if normalized == "no_variants_generated":
        return "clarify_partial_evidence"
    return "retry_low_confidence"


def _doc_key(doc: Any) -> str:
    metadata = getattr(doc, "metadata", {}) or {}
    chunk_id = str(metadata.get("chunk_id") or "").strip()
    if chunk_id:
        return f"chunk:{chunk_id}"
    content = str(getattr(doc, "page_content", "") or "")
    normalized = " ".join(content.lower().split())
    return "text:" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _doc_score(doc: Any) -> float:
    metadata = getattr(doc, "metadata", {}) or {}
    value = metadata.get("hybrid_score")
    if isinstance(value, (int, float)):
        return float(value)
    sim = metadata.get("similarity")
    if isinstance(sim, (int, float)):
        return float(sim)
    return 0.0


def merge_multi_query_candidates(*, base_docs: list[Any], variant_docs: list[Any], max_candidates: int) -> list[Any]:
    merged: dict[str, Any] = {}

    for doc in [*base_docs, *variant_docs]:
        key = _doc_key(doc)
        existing = merged.get(key)
        if existing is None:
            merged[key] = doc
            continue

        if _doc_score(doc) > _doc_score(existing):
            merged[key] = doc

    ranked = sorted(
        merged.values(),
        key=lambda doc: (
            -_doc_score(doc),
            str((getattr(doc, "metadata", {}) or {}).get("chunk_id") or ""),
        ),
    )
    return ranked[: max(1, max_candidates)]
