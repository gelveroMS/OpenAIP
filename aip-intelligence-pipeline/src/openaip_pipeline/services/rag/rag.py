from __future__ import annotations

import json
import logging
import os
import re
import hashlib
import time
from typing import Any

from openaip_pipeline.core.resources import read_text
from openaip_pipeline.services.rag.multi_query import (
    build_multi_query_variants,
    multi_query_reason_code,
    merge_multi_query_candidates,
    should_retry_multi_query,
)
from openaip_pipeline.services.rag.retriever import retrieve_dense_docs_bundle

logger = logging.getLogger(__name__)

SOURCE_TAG_PATTERN = re.compile(r"\[(S\d+)\]")
YEAR_PATTERN = re.compile(r"\b(20\d{2})\b")
MAX_SNIPPET_LENGTH = 360
MAX_RESPONSE_SENTENCES = 2
MAX_RETRIEVAL_QUERY_PREVIEW = 240
INSUFFICIENT_CONTEXT_RESPONSE = "Insufficient context."


def _source_id(index: int, doc: Any) -> str:
    return f"S{index}"


def _original_source_id(doc: Any) -> str | None:
    metadata = getattr(doc, "metadata", {}) or {}
    source = metadata.get("source_id")
    if isinstance(source, str) and source.strip():
        return source.strip()
    return None


def _truncate(text: str, limit: int = MAX_SNIPPET_LENGTH) -> str:
    normalized = " ".join((text or "").split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3].rstrip() + "..."


def _preview(text: str, *, limit: int = 200) -> str:
    return _truncate(text, limit=limit)


def _format_context(docs: list[Any]) -> str:
    sections: list[str] = []
    for index, doc in enumerate(docs, start=1):
        metadata = getattr(doc, "metadata", {}) or {}
        normalized_source_id = _source_id(index, doc)
        original_source_id = _original_source_id(doc)
        sections.append(
            "\n".join(
                [
                    normalized_source_id,
                    f"scope={metadata.get('scope_type')}:{metadata.get('scope_name')}",
                    f"aip_id={metadata.get('aip_id')} fiscal_year={metadata.get('fiscal_year')} similarity={metadata.get('similarity')}",
                    f"original_source_id={original_source_id}",
                    f"content={getattr(doc, 'page_content', '')}",
                ]
            )
        )
    return "\n\n---\n\n".join(sections)


def _format_source_list(docs: list[Any]) -> str:
    lines: list[str] = []
    for index, doc in enumerate(docs, start=1):
        metadata = getattr(doc, "metadata", {}) or {}
        original_source_id = _original_source_id(doc)
        lines.append(
            f"[{_source_id(index, doc)}] original_source_id={original_source_id} "
            f"scope={metadata.get('scope_type')}:{metadata.get('scope_name')} "
            f"aip_id={metadata.get('aip_id')} fy={metadata.get('fiscal_year')}"
        )
    return "\n".join(lines)


def build_retrieval_query(*, question: str, entities: dict[str, Any] | None) -> str:
    query = str(question or "").strip()
    parsed_entities = entities if isinstance(entities, dict) else {}
    hints: list[str] = []

    def _append_hint(label: str, value: Any) -> None:
        if value is None:
            return
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                return
            hints.append(f"{label}: {normalized}")
            return
        if isinstance(value, (int, float)):
            hints.append(f"{label}: {value}")

    _append_hint("barangay", parsed_entities.get("barangay"))
    _append_hint("city", parsed_entities.get("city"))
    _append_hint("scope_type", parsed_entities.get("scope_type"))
    _append_hint("scope_name", parsed_entities.get("scope_name"))
    _append_hint("fiscal year", parsed_entities.get("fiscal_year"))
    _append_hint("topic", parsed_entities.get("topic"))
    _append_hint("project type", parsed_entities.get("project_type"))
    _append_hint("sector", parsed_entities.get("sector"))
    _append_hint("budget term", parsed_entities.get("budget_term"))

    if not hints:
        return query
    return f"{query}\n\nStructured hints: {' | '.join(hints)}"


def _safe_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


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


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _rag_trace_enabled() -> bool:
    explicit = os.getenv("RAG_TRACE_ENABLED")
    if explicit is not None:
        return explicit.strip().lower() in {"1", "true", "yes", "on"}
    inherited = os.getenv("PIPELINE_TRACE_ENABLED", "false")
    return inherited.strip().lower() in {"1", "true", "yes", "on"}


def _trace_log(event: str, **fields: Any) -> None:
    if not _rag_trace_enabled():
        return
    payload: dict[str, Any] = {"trace": "rag", "event": event}
    payload.update(fields)
    logger.info(json.dumps(payload, separators=(",", ":"), sort_keys=True, default=str))


def _int_env(name: str, default: int, *, minimum: int = 1, maximum: int = 200) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return max(minimum, min(parsed, maximum))


def _evidence_gate_enabled() -> bool:
    return _bool_env("RAG_EVIDENCE_GATE_ENABLED", False)


def _selective_multi_query_enabled() -> bool:
    return _bool_env("RAG_SELECTIVE_MULTI_QUERY_ENABLED", False)


def _gate_min_final_docs() -> int:
    return _int_env("RAG_GATE_MIN_FINAL_DOCS", 2, minimum=1, maximum=6)


def _gate_require_year_match() -> bool:
    return _bool_env("RAG_GATE_REQUIRE_YEAR_MATCH", True)


def _selective_multi_query_max_variants() -> int:
    return _int_env("RAG_SELECTIVE_MULTI_QUERY_MAX_VARIANTS", 3, minimum=1, maximum=3)


def _diversity_selection_enabled() -> bool:
    value = os.getenv("RAG_DIVERSITY_SELECTION_ENABLED", "true").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _normalize_retrieval_mode(mode: str | None) -> str:
    normalized = (mode or "qa").strip().lower()
    if normalized == "overview":
        return "overview"
    return "qa"


def _effective_top_k(*, top_k: int, retrieval_mode: str) -> int:
    mode = _normalize_retrieval_mode(retrieval_mode)
    if mode == "overview":
        return max(3, min(top_k, 8))
    return max(3, min(top_k, 5))


def _active_rag_flags() -> dict[str, bool]:
    return {
        "RAG_EVIDENCE_GATE_ENABLED": _evidence_gate_enabled(),
        "RAG_SELECTIVE_MULTI_QUERY_ENABLED": _selective_multi_query_enabled(),
        "RAG_DIVERSITY_SELECTION_ENABLED": _diversity_selection_enabled(),
    }


def _rag_calibration_snapshot() -> dict[str, int | float | bool]:
    return {
        "RAG_GATE_MIN_FINAL_DOCS": _gate_min_final_docs(),
        "RAG_GATE_REQUIRE_YEAR_MATCH": _gate_require_year_match(),
        "RAG_SELECTIVE_MULTI_QUERY_MAX_VARIANTS": _selective_multi_query_max_variants(),
    }


def _evidence_gate_reason_code(reason: str) -> str:
    normalized = (reason or "").strip().lower()
    if normalized == "sufficient_final_evidence":
        return "allow_strong_evidence"
    if normalized in {"insufficient_final_candidates", "weak_topic_overlap"}:
        return "clarify_partial_evidence"
    if normalized == "no_final_candidates":
        return "refuse_no_evidence"
    if normalized == "explicit_year_not_found":
        return "refuse_misaligned_evidence"
    return "retry_low_confidence"


def _normalize_content(text: str) -> str:
    return " ".join((text or "").lower().split())


def _content_hash(text: str) -> str:
    return hashlib.sha256(_normalize_content(text).encode("utf-8")).hexdigest()


def _doc_similarity_score(doc: Any) -> float:
    metadata = getattr(doc, "metadata", {}) or {}
    return _safe_float(metadata.get("similarity")) or 0.0


def _doc_meets_min_similarity(doc: Any, *, min_similarity: float) -> bool:
    metadata = getattr(doc, "metadata", {}) or {}
    similarity = _safe_float(metadata.get("similarity"))
    score = similarity if similarity is not None else _doc_similarity_score(doc)
    return score >= min_similarity


def run_dense_retrieval(
    *,
    supabase: Any,
    embeddings_model: str,
    question: str,
    retrieval_scope: dict[str, Any] | None,
    retrieval_mode: str,
    retrieval_filters: dict[str, Any] | None,
    top_k: int,
    min_similarity: float,
) -> dict[str, Any]:
    resolved_mode = _normalize_retrieval_mode(retrieval_mode)
    effective_top_k = _effective_top_k(top_k=top_k, retrieval_mode=resolved_mode)
    dense_k = max(1, min(effective_top_k, 12))

    retrieval_bundle = retrieve_dense_docs_bundle(
        supabase=supabase,
        embeddings_model=embeddings_model,
        question=question,
        k=dense_k,
        min_similarity=0.0,
        retrieval_scope=retrieval_scope,
        retrieval_mode=resolved_mode,
        retrieval_filters=retrieval_filters,
    )
    dense_docs = list(retrieval_bundle.get("docs") or [])
    retrieval_diagnostics = dict(retrieval_bundle.get("diagnostics") or {})
    strong_docs = [doc for doc in dense_docs if _doc_meets_min_similarity(doc, min_similarity=min_similarity)]
    candidate_counts = dict(retrieval_diagnostics.get("candidate_counts") or {})
    candidate_counts["strong"] = len(strong_docs)

    return {
        "dense_docs": dense_docs,
        "docs": dense_docs,
        "strong_docs": strong_docs,
        "retrieval_mode": resolved_mode,
        "effective_top_k": effective_top_k,
        "retrieval_filters": retrieval_filters or {},
        "hard_filters_applied": dict(retrieval_diagnostics.get("hard_filters_applied") or {}),
        "soft_preferences": dict(retrieval_diagnostics.get("soft_preferences") or {}),
        "theme_boost_usage": dict(retrieval_diagnostics.get("theme_boost_usage") or {}),
        "candidate_counts": candidate_counts,
    }


def _doc_section_key(doc: Any) -> str:
    metadata = getattr(doc, "metadata", {}) or {}
    nested = metadata.get("metadata")
    nested_metadata = nested if isinstance(nested, dict) else {}
    section = str(nested_metadata.get("section") or nested_metadata.get("section_name") or "").strip().lower()
    page_no = str(nested_metadata.get("page_no") or metadata.get("page_no") or "").strip()
    scope_key = f"{metadata.get('scope_type')}:{metadata.get('scope_id')}"
    if section:
        return f"{scope_key}:section:{section}"
    if page_no:
        return f"{scope_key}:page:{page_no}"
    return f"{scope_key}:chunk:{metadata.get('chunk_id')}"


def _token_set(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]{2,}", (text or "").lower()))


def _text_overlap(a: str, b: str) -> float:
    tokens_a = _token_set(a)
    tokens_b = _token_set(b)
    if not tokens_a or not tokens_b:
        return 0.0
    union = tokens_a | tokens_b
    if not union:
        return 0.0
    return len(tokens_a & tokens_b) / len(union)


def _dedupe_exact_docs(docs: list[Any]) -> list[Any]:
    seen_keys: set[str] = set()
    selected: list[Any] = []
    ranked = sorted(docs, key=_doc_similarity_score, reverse=True)
    for doc in ranked:
        metadata = getattr(doc, "metadata", {}) or {}
        chunk_id = str(metadata.get("chunk_id") or "").strip()
        key = f"chunk:{chunk_id}" if chunk_id else f"text:{_content_hash(str(getattr(doc, 'page_content', '') or ''))}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        selected.append(doc)
    return selected


def _suppress_near_duplicates(docs: list[Any], *, max_overlap: float = 0.92) -> list[Any]:
    selected: list[Any] = []
    ranked = sorted(docs, key=_doc_similarity_score, reverse=True)
    for doc in ranked:
        content = str(getattr(doc, "page_content", "") or "")
        if any(_text_overlap(content, str(getattr(existing, "page_content", "") or "")) >= max_overlap for existing in selected):
            continue
        selected.append(doc)
    return selected


def _select_diverse_docs(
    docs: list[Any],
    *,
    max_docs: int = 6,
    min_docs: int = 4,
) -> list[Any]:
    if not docs:
        return []

    candidate_docs = _suppress_near_duplicates(_dedupe_exact_docs(docs))
    if len(candidate_docs) <= max_docs:
        return candidate_docs

    ranked = sorted(candidate_docs, key=_doc_similarity_score, reverse=True)
    selected: list[Any] = [ranked[0]]
    remaining = ranked[1:]
    target_count = min(max_docs, len(ranked))

    while remaining and len(selected) < target_count:
        best_index = 0
        best_score = float("-inf")
        for index, candidate in enumerate(remaining):
            relevance = _doc_similarity_score(candidate)
            max_content_overlap = max(
                (
                    _text_overlap(
                        str(getattr(candidate, "page_content", "") or ""),
                        str(getattr(existing, "page_content", "") or ""),
                    )
                    for existing in selected
                ),
                default=0.0,
            )
            section_penalty = 0.0
            candidate_section = _doc_section_key(candidate)
            if any(_doc_section_key(existing) == candidate_section for existing in selected):
                section_penalty = 0.15

            mmr_score = relevance - (0.35 * max_content_overlap) - section_penalty
            if mmr_score > best_score:
                best_score = mmr_score
                best_index = index

        selected.append(remaining.pop(best_index))
        if len(selected) >= min_docs and len(selected) >= max_docs:
            break

    return selected[:max_docs]


def _build_citation(index: int, doc: Any, *, insufficient: bool = False) -> dict[str, Any]:
    metadata = getattr(doc, "metadata", {}) or {}
    original_source_id = _original_source_id(doc)
    return {
        "source_id": _source_id(index, doc),
        "original_source_id": original_source_id,
        "chunk_id": metadata.get("chunk_id"),
        "chunk_type": metadata.get("chunk_type"),
        "document_type": metadata.get("document_type"),
        "aip_id": metadata.get("aip_id"),
        "project_ref_code": metadata.get("project_ref_code"),
        "source_page": metadata.get("source_page"),
        "fiscal_year": metadata.get("fiscal_year"),
        "scope_type": metadata.get("scope_type") or "unknown",
        "scope_id": metadata.get("scope_id"),
        "scope_name": metadata.get("scope_name"),
        "similarity": _safe_float(metadata.get("similarity")),
        "snippet": _truncate(getattr(doc, "page_content", "")),
        "insufficient": insufficient,
        "metadata": metadata.get("metadata") or {},
    }


def _build_source_map(docs: list[Any]) -> dict[str, tuple[int, Any]]:
    out: dict[str, tuple[int, Any]] = {}
    for index, doc in enumerate(docs, start=1):
        out[_source_id(index, doc)] = (index, doc)
    return out


def _extract_json(text: str) -> dict[str, Any] | None:
    raw = text.strip()
    if not raw:
        return None

    candidates = [raw]
    first_brace = raw.find("{")
    last_brace = raw.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        candidates.append(raw[first_brace : last_brace + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _extract_source_ids(answer_text: str) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for match in SOURCE_TAG_PATTERN.findall(answer_text):
        if match not in seen:
            seen.add(match)
            ordered.append(match)
    return ordered


def _split_answer_sentences(answer_text: str) -> list[str]:
    normalized = " ".join((answer_text or "").split())
    if not normalized:
        return []
    parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+", normalized) if part.strip()]
    return parts if parts else [normalized]


def _answer_violates_constraints(answer_text: str) -> bool:
    if not answer_text:
        return True
    if answer_text.strip() == INSUFFICIENT_CONTEXT_RESPONSE:
        return False

    sentences = _split_answer_sentences(answer_text)
    if len(sentences) > MAX_RESPONSE_SENTENCES:
        return True

    # Each sentence in generated grounded output must carry at least one source tag.
    return any(SOURCE_TAG_PATTERN.search(sentence) is None for sentence in sentences)


def _build_refusal(
    *,
    question: str,
    reason: str,
    docs: list[Any],
    top_k: int,
    min_similarity: float,
    retrieval_scope: dict[str, Any] | None,
) -> dict[str, Any]:
    _trace_log(
        "build_refusal",
        reason=reason,
        context_count=len(docs),
        top_k=top_k,
        min_similarity=min_similarity,
    )
    nearest = docs[: min(3, len(docs))]
    citations = [_build_citation(index, doc, insufficient=True) for index, doc in enumerate(nearest, start=1)]
    if not citations:
        citations = [
            {
                "source_id": "S0",
                "chunk_id": None,
                "aip_id": None,
                "fiscal_year": None,
                "scope_type": "system",
                "scope_id": None,
                "scope_name": "System",
                "similarity": None,
                "snippet": "No published AIP retrieval context was available.",
                "insufficient": True,
                "metadata": {},
            }
        ]

    answer = INSUFFICIENT_CONTEXT_RESPONSE
    return {
        "question": question,
        "answer": answer,
        "refused": True,
        "citations": citations,
        "sources": [citation.get("metadata", {}) for citation in citations],
        "context_count": len(docs),
        "retrieval_meta": {
            "reason": reason,
            "top_k": top_k,
            "min_similarity": min_similarity,
            "context_count": len(docs),
            "scope_mode": (retrieval_scope or {}).get("mode", "global"),
            "scope_targets_count": len((retrieval_scope or {}).get("targets") or []),
        },
    }


def _partial_mode_enabled() -> bool:
    value = os.getenv("RAG_PARTIAL_MODE_ENABLED", "false").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _build_partial_evidence(
    *,
    question: str,
    reason: str,
    docs: list[Any],
    top_k: int,
    min_similarity: float,
    retrieval_scope: dict[str, Any] | None,
) -> dict[str, Any]:
    _trace_log(
        "build_partial_evidence",
        reason=reason,
        context_count=len(docs),
        top_k=top_k,
        min_similarity=min_similarity,
    )
    nearest = docs[: min(3, len(docs))]
    citations = [_build_citation(index, doc, insufficient=True) for index, doc in enumerate(nearest, start=1)]
    if not citations:
        return _build_refusal(
            question=question,
            reason="insufficient_evidence",
            docs=docs,
            top_k=top_k,
            min_similarity=min_similarity,
            retrieval_scope=retrieval_scope,
        )

    return {
        "question": question,
        "answer": INSUFFICIENT_CONTEXT_RESPONSE,
        "refused": False,
        "citations": citations,
        "sources": [citation.get("metadata", {}) for citation in citations],
        "context_count": len(docs),
        "retrieval_meta": {
            "reason": reason,
            "top_k": top_k,
            "min_similarity": min_similarity,
            "context_count": len(docs),
            "scope_mode": (retrieval_scope or {}).get("mode", "global"),
            "scope_targets_count": len((retrieval_scope or {}).get("targets") or []),
        },
    }


def _attach_selection_meta(
    result: dict[str, Any],
    *,
    retrieved_count: int,
    strong_count: int,
    selected_count: int,
    diversity_selection_enabled: bool,
    dense_candidate_count: int | None = None,
    evidence_gate_decision: str | None = None,
    evidence_gate_reason: str | None = None,
    evidence_gate_reason_code: str | None = None,
    generation_skipped_by_gate: bool | None = None,
    multi_query_triggered: bool | None = None,
    multi_query_variant_count: int | None = None,
    multi_query_reason: str | None = None,
    multi_query_reason_code: str | None = None,
    active_rag_flags: dict[str, bool] | None = None,
    rag_calibration: dict[str, int | float | bool] | None = None,
    stage_latency_ms: dict[str, float] | None = None,
    extra_meta: dict[str, Any] | None = None,
    response_mode_source: str | None = None,
) -> dict[str, Any]:
    metadata = dict(result.get("retrieval_meta") or {})
    metadata.update(
        {
            "retrieved_count": retrieved_count,
            "strong_count": strong_count,
            "selected_count": selected_count,
            "diversity_selection_enabled": diversity_selection_enabled,
        }
    )
    if dense_candidate_count is not None:
        metadata["dense_candidate_count"] = dense_candidate_count
    if evidence_gate_decision is not None:
        metadata["evidence_gate_decision"] = evidence_gate_decision
    if evidence_gate_reason is not None:
        metadata["evidence_gate_reason"] = evidence_gate_reason
    if evidence_gate_reason_code is not None:
        metadata["evidence_gate_reason_code"] = evidence_gate_reason_code
    if generation_skipped_by_gate is not None:
        metadata["generation_skipped_by_gate"] = generation_skipped_by_gate
    if multi_query_triggered is not None:
        metadata["multi_query_triggered"] = multi_query_triggered
    if multi_query_variant_count is not None:
        metadata["multi_query_variant_count"] = multi_query_variant_count
    if multi_query_reason is not None:
        metadata["multi_query_reason"] = multi_query_reason
    if multi_query_reason_code is not None:
        metadata["multi_query_reason_code"] = multi_query_reason_code
    if active_rag_flags is not None:
        metadata["active_rag_flags"] = active_rag_flags
    if rag_calibration is not None:
        metadata["rag_calibration"] = rag_calibration
    if stage_latency_ms is not None:
        metadata["stage_latency_ms"] = stage_latency_ms
    if response_mode_source is not None:
        metadata["response_mode_source"] = response_mode_source
    if isinstance(extra_meta, dict):
        metadata.update(extra_meta)
    result["retrieval_meta"] = metadata
    result["context_count"] = selected_count
    return result


def evaluate_evidence_gate(
    *,
    question: str,
    selected_docs: list[Any],
) -> dict[str, Any]:
    if not selected_docs:
        return {
            "decision": "refuse",
            "reason": "no_final_candidates",
            "metrics": {
                "final_candidate_count": 0,
                "year_match_count": 0,
                "year_match_ratio": 0.0,
                "top_overlap": 0.0,
                "top2_concentration": 0.0,
            },
        }

    final_count = len(selected_docs)
    requested_years = sorted({int(match) for match in YEAR_PATTERN.findall(question)})
    fiscal_years = [
        year
        for year in (
            _coerce_year((getattr(doc, "metadata", {}) or {}).get("fiscal_year")) for doc in selected_docs
        )
        if year is not None
    ]
    year_match_count = (
        sum(1 for year in fiscal_years if year in requested_years) if requested_years else final_count
    )
    year_match_ratio = (
        float(year_match_count) / float(max(1, len(fiscal_years)))
        if requested_years and fiscal_years
        else 1.0
    )

    top_score = _doc_similarity_score(selected_docs[0]) if selected_docs else 0.0
    second_score = _doc_similarity_score(selected_docs[1]) if len(selected_docs) > 1 else 0.0
    top2_concentration = (
        float(top_score) / float(second_score + 1e-6) if second_score > 0 else float("inf")
    )
    top_overlap = max(
        (_text_overlap(question, str(getattr(doc, "page_content", "") or "")) for doc in selected_docs),
        default=0.0,
    )

    min_final_docs = _gate_min_final_docs()
    if final_count < min_final_docs:
        return {
            "decision": "clarify",
            "reason": "insufficient_final_candidates",
            "metrics": {
                "final_candidate_count": final_count,
                "year_match_count": year_match_count,
                "year_match_ratio": year_match_ratio,
                "top_overlap": top_overlap,
                "top2_concentration": top2_concentration,
            },
        }

    if requested_years and _gate_require_year_match() and year_match_count == 0:
        return {
            "decision": "refuse",
            "reason": "explicit_year_not_found",
            "metrics": {
                "requested_years": requested_years,
                "final_candidate_count": final_count,
                "year_match_count": year_match_count,
                "year_match_ratio": year_match_ratio,
                "top_overlap": top_overlap,
                "top2_concentration": top2_concentration,
            },
        }

    if top_overlap < 0.02 and final_count <= min_final_docs:
        return {
            "decision": "clarify",
            "reason": "weak_topic_overlap",
            "metrics": {
                "final_candidate_count": final_count,
                "year_match_count": year_match_count,
                "year_match_ratio": year_match_ratio,
                "top_overlap": top_overlap,
                "top2_concentration": top2_concentration,
            },
        }

    return {
        "decision": "allow",
        "reason": "sufficient_final_evidence",
        "metrics": {
            "final_candidate_count": final_count,
            "year_match_count": year_match_count,
            "year_match_ratio": year_match_ratio,
            "top_overlap": top_overlap,
            "top2_concentration": top2_concentration,
        },
    }


def answer_with_rag(
    *,
    supabase_url: str,
    supabase_service_key: str,
    openai_api_key: str,
    embeddings_model: str,
    chat_model: str,
    question: str,
    retrieval_query: str | None = None,
    retrieval_scope: dict[str, Any] | None = None,
    retrieval_mode: str = "qa",
    retrieval_filters: dict[str, Any] | None = None,
    top_k: int = 4,
    min_similarity: float = 0.3,
    metadata_filter: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from langchain_openai import ChatOpenAI
    from supabase.client import create_client

    started_at = time.perf_counter()
    stage_latency_ms: dict[str, float] = {}
    active_rag_flags = _active_rag_flags()
    rag_calibration = _rag_calibration_snapshot()
    resolved_scope = retrieval_scope or {"mode": "global", "targets": []}
    resolved_mode = _normalize_retrieval_mode(retrieval_mode)
    effective_top_k = _effective_top_k(top_k=top_k, retrieval_mode=resolved_mode)
    retrieval_text = (retrieval_query or "").strip() or question
    supabase = create_client(supabase_url, supabase_service_key)
    retrieval_started_at = time.perf_counter()
    retrieval_bundle = run_dense_retrieval(
        supabase=supabase,
        embeddings_model=embeddings_model,
        question=retrieval_text,
        retrieval_scope=resolved_scope,
        retrieval_mode=resolved_mode,
        retrieval_filters=retrieval_filters,
        top_k=effective_top_k,
        min_similarity=min_similarity,
    )
    stage_latency_ms["retrieval_ms"] = round((time.perf_counter() - retrieval_started_at) * 1000.0, 3)

    dense_docs = list(retrieval_bundle.get("dense_docs") or [])
    docs = list(retrieval_bundle.get("docs") or dense_docs)
    strong_docs = list(retrieval_bundle.get("strong_docs") or [])
    effective_top_k = int(retrieval_bundle.get("effective_top_k") or effective_top_k)
    resolved_mode = _normalize_retrieval_mode(str(retrieval_bundle.get("retrieval_mode") or resolved_mode))
    applied_filters = dict(retrieval_bundle.get("retrieval_filters") or retrieval_filters or {})
    hard_filters_applied = dict(retrieval_bundle.get("hard_filters_applied") or {})
    soft_preferences = dict(retrieval_bundle.get("soft_preferences") or {})
    theme_boost_usage = dict(retrieval_bundle.get("theme_boost_usage") or {})
    candidate_counts = dict(retrieval_bundle.get("candidate_counts") or {})
    diversity_enabled = _diversity_selection_enabled()

    dense_candidate_count = len(dense_docs)
    _trace_log(
        "retrieval_completed",
        question_preview=_preview(question),
        retrieval_mode=resolved_mode,
        top_k=effective_top_k,
        min_similarity=min_similarity,
        dense_candidate_count=dense_candidate_count,
        strong_candidate_count=len(strong_docs),
        candidate_counts=candidate_counts,
        hard_filters_applied=hard_filters_applied,
        soft_preferences=soft_preferences,
        theme_boost_usage=theme_boost_usage,
        applied_retrieval_filters=applied_filters,
    )

    gate_decision = "allow"
    gate_reason = "gate_not_evaluated"
    gate_reason_code = "allow_strong_evidence"
    gate_metrics: dict[str, Any] = {}
    generation_skipped_by_gate = False
    multi_query_triggered = False
    multi_query_variant_count = 0
    multi_query_reason = "not_attempted"
    multi_query_reason_code_value = "not_attempted"
    selected_docs: list[Any] = []
    effective_strong_docs = list(strong_docs)
    effective_docs = list(docs)
    response_mode_source = "pipeline_refusal"
    retrieval_context_meta = {
        "retrieval_mode": resolved_mode,
        "applied_retrieval_filters": applied_filters,
        "hard_filters_applied": hard_filters_applied,
        "soft_preferences": soft_preferences,
        "theme_boost_usage": theme_boost_usage,
        "candidate_counts": candidate_counts,
        "retrieval_query_applied": retrieval_text != question,
        "retrieval_query_preview": _preview(retrieval_text, limit=MAX_RETRIEVAL_QUERY_PREVIEW),
    }

    def attach(
        result: dict[str, Any],
        *,
        selected_count: int,
        strong_count_override: int | None = None,
        generation_skipped_override: bool | None = None,
        extra_meta: dict[str, Any] | None = None,
        response_mode_source_override: str | None = None,
    ) -> dict[str, Any]:
        stage_latency_snapshot = dict(stage_latency_ms)
        stage_latency_snapshot["total_ms"] = round((time.perf_counter() - started_at) * 1000.0, 3)
        merged_extra_meta = dict(retrieval_context_meta)
        if isinstance(extra_meta, dict):
            merged_extra_meta.update(extra_meta)
        return _attach_selection_meta(
            result,
            retrieved_count=len(effective_docs),
            strong_count=strong_count_override if strong_count_override is not None else len(effective_strong_docs),
            selected_count=selected_count,
            diversity_selection_enabled=diversity_enabled,
            dense_candidate_count=dense_candidate_count,
            evidence_gate_decision=gate_decision,
            evidence_gate_reason=gate_reason,
            evidence_gate_reason_code=gate_reason_code,
            generation_skipped_by_gate=(
                generation_skipped_override
                if generation_skipped_override is not None
                else generation_skipped_by_gate
            ),
            multi_query_triggered=multi_query_triggered,
            multi_query_variant_count=multi_query_variant_count,
            multi_query_reason=multi_query_reason,
            multi_query_reason_code=multi_query_reason_code_value,
            active_rag_flags=active_rag_flags,
            rag_calibration=rag_calibration,
            stage_latency_ms=stage_latency_snapshot,
            extra_meta=merged_extra_meta,
            response_mode_source=(
                response_mode_source_override
                if response_mode_source_override is not None
                else response_mode_source
            ),
        )

    if not effective_strong_docs:
        _trace_log(
            "no_strong_docs",
            candidate_count=len(docs),
            partial_mode_enabled=_partial_mode_enabled(),
        )
        _trace_log(
            "retrieval_refusal",
            reason="insufficient_evidence",
            hard_filters_applied=hard_filters_applied,
            soft_preferences=soft_preferences,
            theme_boost_usage=theme_boost_usage,
            candidate_counts=candidate_counts,
        )
        if docs and _partial_mode_enabled():
            response_mode_source = "pipeline_partial"
            return attach(
                _build_partial_evidence(
                    question=question,
                    reason="partial_evidence",
                    docs=docs,
                    top_k=effective_top_k,
                    min_similarity=min_similarity,
                    retrieval_scope=resolved_scope,
                ),
                selected_count=min(3, len(docs)),
                strong_count_override=0,
            )
        response_mode_source = "pipeline_refusal"
        return attach(
            _build_refusal(
                question=question,
                reason="insufficient_evidence",
                docs=docs,
                top_k=effective_top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
            ),
            selected_count=min(3, len(docs)),
            strong_count_override=0,
        )

    selection_started_at = time.perf_counter()
    selection_max_docs = 5 if resolved_mode == "qa" else 6
    selection_min_docs = 3 if resolved_mode == "qa" else 4
    selected_docs = (
        _select_diverse_docs(
            effective_strong_docs,
            max_docs=selection_max_docs,
            min_docs=selection_min_docs,
        )
        if diversity_enabled
        else effective_strong_docs[: min(selection_max_docs, len(effective_strong_docs))]
    )
    stage_latency_ms["selection_ms"] = round((time.perf_counter() - selection_started_at) * 1000.0, 3)

    if _evidence_gate_enabled():
        gate_started_at = time.perf_counter()
        gate = evaluate_evidence_gate(question=question, selected_docs=selected_docs)
        gate_decision = str(gate.get("decision") or "clarify")
        gate_reason = str(gate.get("reason") or "gate_blocked")
        gate_reason_code = _evidence_gate_reason_code(gate_reason)
        gate_metrics = dict(gate.get("metrics") or {})
        _trace_log(
            "evidence_gate_evaluated",
            decision=gate_decision,
            reason=gate_reason,
            reason_code=gate_reason_code,
            metrics=gate_metrics,
        )
        if gate_decision != "allow" and _selective_multi_query_enabled():
            should_retry, retry_reason = should_retry_multi_query(
                gate_decision=gate_decision,
                gate_reason=gate_reason,
            )
            if should_retry:
                variants = build_multi_query_variants(
                    question=question,
                    max_variants=_selective_multi_query_max_variants(),
                )
                if variants:
                    multi_query_triggered = True
                    multi_query_variant_count = len(variants)
                    multi_query_reason = retry_reason or "retryable_low_confidence"
                    multi_query_reason_code_value = multi_query_reason_code(multi_query_reason)

                    variant_docs: list[Any] = []
                    for variant in variants:
                        variant_bundle = run_dense_retrieval(
                            supabase=supabase,
                            embeddings_model=embeddings_model,
                            question=variant,
                            retrieval_scope=resolved_scope,
                            retrieval_mode=resolved_mode,
                            retrieval_filters=applied_filters,
                            top_k=effective_top_k,
                            min_similarity=min_similarity,
                        )
                        variant_strong_docs = list(variant_bundle.get("strong_docs") or [])
                        if variant_strong_docs:
                            variant_docs.extend(variant_strong_docs)

                    if variant_docs:
                        max_candidates = max(12, min(60, len(effective_strong_docs) + len(variant_docs)))
                        effective_strong_docs = merge_multi_query_candidates(
                            base_docs=effective_strong_docs,
                            variant_docs=variant_docs,
                            max_candidates=max_candidates,
                        )
                        effective_docs = list(effective_strong_docs)
                        selected_docs = (
                            _select_diverse_docs(
                                effective_strong_docs,
                                max_docs=selection_max_docs,
                                min_docs=selection_min_docs,
                            )
                            if diversity_enabled
                            else effective_strong_docs[: min(selection_max_docs, len(effective_strong_docs))]
                        )
                        gate = evaluate_evidence_gate(question=question, selected_docs=selected_docs)
                        gate_decision = str(gate.get("decision") or "clarify")
                        gate_reason = str(gate.get("reason") or "gate_blocked")
                        gate_reason_code = _evidence_gate_reason_code(gate_reason)
                        gate_metrics = dict(gate.get("metrics") or {})
                        _trace_log(
                            "evidence_gate_re_evaluated_after_multi_query",
                            decision=gate_decision,
                            reason=gate_reason,
                            reason_code=gate_reason_code,
                            metrics=gate_metrics,
                            multi_query_variant_count=multi_query_variant_count,
                        )
                else:
                    multi_query_reason = "no_variants_generated"
                    multi_query_reason_code_value = multi_query_reason_code(multi_query_reason)
        stage_latency_ms["gate_ms"] = round((time.perf_counter() - gate_started_at) * 1000.0, 3)

        if gate_decision != "allow":
            _trace_log(
                "generation_skipped_by_gate",
                decision=gate_decision,
                reason=gate_reason,
                reason_code=gate_reason_code,
            )
            generation_skipped_by_gate = True
            if gate_decision == "clarify":
                response_mode_source = "pipeline_partial"
                return attach(
                    _build_partial_evidence(
                        question=question,
                        reason="partial_evidence",
                        docs=selected_docs,
                        top_k=effective_top_k,
                        min_similarity=min_similarity,
                        retrieval_scope=resolved_scope,
                    ),
                    selected_count=len(selected_docs),
                    generation_skipped_override=True,
                    extra_meta=gate_metrics,
                )
            response_mode_source = "pipeline_refusal"
            _trace_log(
                "retrieval_refusal",
                reason="insufficient_evidence",
                hard_filters_applied=hard_filters_applied,
                soft_preferences=soft_preferences,
                theme_boost_usage=theme_boost_usage,
                candidate_counts=candidate_counts,
            )
            return attach(
                _build_refusal(
                    question=question,
                    reason="insufficient_evidence",
                    docs=selected_docs,
                    top_k=effective_top_k,
                    min_similarity=min_similarity,
                    retrieval_scope=resolved_scope,
                ),
                selected_count=len(selected_docs),
                generation_skipped_override=True,
                extra_meta=gate_metrics,
            )

    llm = ChatOpenAI(model=chat_model, temperature=0, api_key=openai_api_key)
    system_prompt = read_text("prompts/rag/system.txt").strip()

    generation_instruction = (
        "Return strict JSON with keys: answer, used_source_ids.\n"
        "- answer must be plain text with inline source tags like [S1], [S2].\n"
        "- Every factual statement must include at least one valid source tag.\n"
        "- used_source_ids must list unique source IDs actually used in answer.\n"
        f"- If evidence is insufficient, return answer exactly: {INSUFFICIENT_CONTEXT_RESPONSE}"
    )
    generation_user_prompt = (
        f"Question:\n{question}\n\n"
        f"Allowed Sources:\n{_format_source_list(selected_docs)}\n\n"
        f"Context:\n{_format_context(selected_docs)}\n\n"
        f"{generation_instruction}"
    )
    generation_started_at = time.perf_counter()
    generation_response = llm.invoke(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": generation_user_prompt},
        ]
    )
    stage_latency_ms["generation_ms"] = round((time.perf_counter() - generation_started_at) * 1000.0, 3)
    parsed_generation = _extract_json(str(getattr(generation_response, "content", "")) or "")
    if not parsed_generation:
        _trace_log("generation_invalid_json")
        return attach(
            _build_refusal(
                question=question,
                reason="validation_failed",
                docs=selected_docs,
                top_k=effective_top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
            ),
            selected_count=len(selected_docs),
            extra_meta=gate_metrics,
        )

    answer_text = str(parsed_generation.get("answer") or "").strip()
    if not answer_text:
        _trace_log("generation_empty_answer")
        return attach(
            _build_refusal(
                question=question,
                reason="validation_failed",
                docs=selected_docs,
                top_k=effective_top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
            ),
            selected_count=len(selected_docs),
            extra_meta=gate_metrics,
        )

    if _answer_violates_constraints(answer_text):
        _trace_log("generation_constraint_violation", answer_preview=_preview(answer_text))
        return attach(
            _build_refusal(
                question=question,
                reason="validation_failed",
                docs=selected_docs,
                top_k=effective_top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
            ),
            selected_count=len(selected_docs),
            extra_meta=gate_metrics,
        )

    source_map = _build_source_map(selected_docs)
    used_source_ids: list[str] = []
    raw_used = parsed_generation.get("used_source_ids")
    if isinstance(raw_used, list):
        for item in raw_used:
            source = str(item).strip()
            if source and source not in used_source_ids:
                used_source_ids.append(source)

    if not used_source_ids:
        used_source_ids = _extract_source_ids(answer_text)

    if not used_source_ids:
        _trace_log("generation_missing_source_ids")
        return attach(
            _build_refusal(
                question=question,
                reason="validation_failed",
                docs=selected_docs,
                top_k=effective_top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
            ),
            selected_count=len(selected_docs),
            extra_meta=gate_metrics,
        )

    if any(source_id not in source_map for source_id in used_source_ids):
        _trace_log("generation_invalid_source_ids", used_source_ids=used_source_ids)
        return attach(
            _build_refusal(
                question=question,
                reason="validation_failed",
                docs=selected_docs,
                top_k=effective_top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
            ),
            selected_count=len(selected_docs),
            extra_meta=gate_metrics,
        )

    citations: list[dict[str, Any]] = []
    for source_id in used_source_ids:
        index, doc = source_map[source_id]
        citations.append(_build_citation(index, doc, insufficient=False))

    if not citations:
        _trace_log("validation_failed_empty_citations")
        return attach(
            _build_refusal(
                question=question,
                reason="validation_failed",
                docs=selected_docs,
                top_k=effective_top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
            ),
            selected_count=len(selected_docs),
            extra_meta=gate_metrics,
        )

    result = attach(
        {
            "question": question,
            "answer": answer_text,
            "refused": False,
            "citations": citations,
            "sources": [citation.get("metadata", {}) for citation in citations],
            "context_count": len(selected_docs),
            "retrieval_meta": {
                "reason": "ok",
                "top_k": effective_top_k,
                "min_similarity": min_similarity,
                "context_count": len(selected_docs),
                "scope_mode": resolved_scope.get("mode", "global"),
                "scope_targets_count": len(resolved_scope.get("targets") or []),
            },
            "legacy_metadata_filter": metadata_filter or {},
        },
        selected_count=len(selected_docs),
        extra_meta=gate_metrics,
        response_mode_source_override="pipeline_generated",
    )
    _trace_log(
        "answer_generated",
        refused=False,
        citations_count=len(citations),
        context_count=result.get("context_count"),
        evidence_gate_decision=gate_decision,
    )
    return result
