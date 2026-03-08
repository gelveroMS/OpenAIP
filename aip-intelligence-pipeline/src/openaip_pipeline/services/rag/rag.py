from __future__ import annotations

import json
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
from openaip_pipeline.services.rag.retriever import (
    fuse_docs_rrf,
    retrieve_dense_docs,
    retrieve_keyword_docs,
)

SOURCE_TAG_PATTERN = re.compile(r"\[(S\d+)\]")
YEAR_PATTERN = re.compile(r"\b(20\d{2})\b")
MAX_SNIPPET_LENGTH = 360


def _source_id(index: int, doc: Any) -> str:
    metadata = getattr(doc, "metadata", {}) or {}
    source = metadata.get("source_id")
    if isinstance(source, str) and source.strip():
        return source.strip()
    return f"S{index}"


def _truncate(text: str, limit: int = MAX_SNIPPET_LENGTH) -> str:
    normalized = " ".join((text or "").split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3].rstrip() + "..."


def _format_context(docs: list[Any]) -> str:
    sections: list[str] = []
    for index, doc in enumerate(docs, start=1):
        metadata = getattr(doc, "metadata", {}) or {}
        sections.append(
            "\n".join(
                [
                    f"{_source_id(index, doc)}",
                    f"scope={metadata.get('scope_type')}:{metadata.get('scope_name')}",
                    f"aip_id={metadata.get('aip_id')} fiscal_year={metadata.get('fiscal_year')} similarity={metadata.get('similarity')}",
                    f"content={getattr(doc, 'page_content', '')}",
                ]
            )
        )
    return "\n\n---\n\n".join(sections)


def _format_source_list(docs: list[Any]) -> str:
    lines: list[str] = []
    for index, doc in enumerate(docs, start=1):
        metadata = getattr(doc, "metadata", {}) or {}
        lines.append(
            f"[{_source_id(index, doc)}] scope={metadata.get('scope_type')}:{metadata.get('scope_name')} "
            f"aip_id={metadata.get('aip_id')} fy={metadata.get('fiscal_year')}"
        )
    return "\n".join(lines)


def _safe_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int, *, minimum: int = 1, maximum: int = 200) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return max(minimum, min(parsed, maximum))


def _float_env(name: str, default: float, *, minimum: float = 0.0, maximum: float = 1.0) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        parsed = float(value)
    except ValueError:
        return default
    if parsed < minimum:
        return minimum
    if parsed > maximum:
        return maximum
    return parsed


def _hybrid_retrieval_enabled() -> bool:
    return _bool_env("RAG_HYBRID_RETRIEVAL_ENABLED", False)


def _keyword_retrieval_enabled() -> bool:
    return _bool_env("RAG_KEYWORD_RETRIEVAL_ENABLED", False)


def _rrf_fusion_enabled() -> bool:
    return _bool_env("RAG_RRF_FUSION_ENABLED", False)


def _evidence_gate_enabled() -> bool:
    return _bool_env("RAG_EVIDENCE_GATE_ENABLED", False)


def _selective_multi_query_enabled() -> bool:
    return _bool_env("RAG_SELECTIVE_MULTI_QUERY_ENABLED", False)


def _borderline_partial_enabled() -> bool:
    return _bool_env("RAG_BORDERLINE_PARTIAL_ENABLED", False)


def _hybrid_dense_k() -> int:
    return _int_env("RAG_HYBRID_DENSE_K", 20, minimum=1, maximum=60)


def _hybrid_keyword_k() -> int:
    return _int_env("RAG_HYBRID_KEYWORD_K", 20, minimum=1, maximum=60)


def _rrf_k() -> int:
    return _int_env("RAG_RRF_K", 60, minimum=1, maximum=200)


def _gate_min_final_docs() -> int:
    return _int_env("RAG_GATE_MIN_FINAL_DOCS", 2, minimum=1, maximum=6)


def _gate_require_year_match() -> bool:
    return _bool_env("RAG_GATE_REQUIRE_YEAR_MATCH", True)


def _selective_multi_query_max_variants() -> int:
    return _int_env("RAG_SELECTIVE_MULTI_QUERY_MAX_VARIANTS", 3, minimum=1, maximum=3)


def _borderline_explicit_match_min() -> float:
    return _float_env("RAG_BORDERLINE_EXPLICIT_MATCH_MIN", 0.08, minimum=0.01, maximum=0.5)


def _diversity_selection_enabled() -> bool:
    value = os.getenv("RAG_DIVERSITY_SELECTION_ENABLED", "true").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _active_rag_flags() -> dict[str, bool]:
    return {
        "RAG_HYBRID_RETRIEVAL_ENABLED": _hybrid_retrieval_enabled(),
        "RAG_KEYWORD_RETRIEVAL_ENABLED": _keyword_retrieval_enabled(),
        "RAG_RRF_FUSION_ENABLED": _rrf_fusion_enabled(),
        "RAG_EVIDENCE_GATE_ENABLED": _evidence_gate_enabled(),
        "RAG_BORDERLINE_PARTIAL_ENABLED": _borderline_partial_enabled(),
        "RAG_SELECTIVE_MULTI_QUERY_ENABLED": _selective_multi_query_enabled(),
        "RAG_DIVERSITY_SELECTION_ENABLED": _diversity_selection_enabled(),
    }


def _rag_calibration_snapshot() -> dict[str, int | float | bool]:
    return {
        "RAG_HYBRID_DENSE_K": _hybrid_dense_k(),
        "RAG_HYBRID_KEYWORD_K": _hybrid_keyword_k(),
        "RAG_RRF_K": _rrf_k(),
        "RAG_GATE_MIN_FINAL_DOCS": _gate_min_final_docs(),
        "RAG_GATE_REQUIRE_YEAR_MATCH": _gate_require_year_match(),
        "RAG_BORDERLINE_EXPLICIT_MATCH_MIN": _borderline_explicit_match_min(),
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
    hybrid = _safe_float(metadata.get("hybrid_score"))
    if hybrid is not None:
        return hybrid
    return _safe_float(metadata.get("similarity")) or 0.0


def _channels_for_doc(doc: Any) -> set[str]:
    metadata = getattr(doc, "metadata", {}) or {}
    channels = metadata.get("retrieval_channels")
    if isinstance(channels, list):
        return {str(channel).strip().lower() for channel in channels if str(channel).strip()}
    return set()


def _count_channel_contribution(docs: list[Any]) -> tuple[int, int]:
    dense_count = 0
    keyword_count = 0
    for doc in docs:
        channels = _channels_for_doc(doc)
        if "dense" in channels:
            dense_count += 1
        if "keyword" in channels:
            keyword_count += 1
    return dense_count, keyword_count


def _merge_ranked_docs(
    dense_docs: list[Any],
    keyword_docs: list[Any],
    *,
    max_candidates: int,
) -> list[Any]:
    # Fallback merge path used when RRF flag is disabled.
    merged: list[Any] = []
    seen: set[str] = set()

    def key_for(doc: Any) -> str:
        metadata = getattr(doc, "metadata", {}) or {}
        chunk_id = str(metadata.get("chunk_id") or "").strip()
        if chunk_id:
            return f"chunk:{chunk_id}"
        return f"text:{_content_hash(str(getattr(doc, 'page_content', '') or ''))}"

    for doc in [*dense_docs, *keyword_docs]:
        key = key_for(doc)
        if key in seen:
            continue
        seen.add(key)
        metadata = getattr(doc, "metadata", {}) or {}
        if metadata.get("hybrid_score") is None:
            metadata["hybrid_score"] = _doc_similarity_score(doc)
        merged.append(doc)
        if len(merged) >= max_candidates:
            break

    merged.sort(
        key=lambda doc: (
            -_doc_similarity_score(doc),
            str((getattr(doc, "metadata", {}) or {}).get("chunk_id") or ""),
        )
    )
    return merged


def run_hybrid_retrieval(
    *,
    supabase: Any,
    embeddings_model: str,
    question: str,
    retrieval_scope: dict[str, Any] | None,
    top_k: int,
    min_similarity: float,
) -> dict[str, Any]:
    hybrid_enabled = _hybrid_retrieval_enabled()
    keyword_enabled = _keyword_retrieval_enabled()

    dense_k = _hybrid_dense_k() if hybrid_enabled else max(1, min(top_k, 12))
    keyword_k = _hybrid_keyword_k() if hybrid_enabled else 0
    max_candidates = max(1, min(dense_k + max(0, keyword_k), 60))

    dense_docs = retrieve_dense_docs(
        supabase=supabase,
        embeddings_model=embeddings_model,
        question=question,
        k=dense_k,
        min_similarity=0.0,
        retrieval_scope=retrieval_scope,
    )
    keyword_docs: list[Any] = []
    fused_docs: list[Any] = dense_docs[:max_candidates]

    if hybrid_enabled and keyword_enabled:
        keyword_docs = retrieve_keyword_docs(
            supabase=supabase,
            question=question,
            k=keyword_k,
            retrieval_scope=retrieval_scope,
            min_rank=0.0,
        )
        if keyword_docs:
            if _rrf_fusion_enabled():
                fused_docs = fuse_docs_rrf(
                    dense_docs=dense_docs,
                    keyword_docs=keyword_docs,
                    rrf_k=_rrf_k(),
                    max_candidates=max_candidates,
                )
            else:
                fused_docs = _merge_ranked_docs(
                    dense_docs=dense_docs,
                    keyword_docs=keyword_docs,
                    max_candidates=max_candidates,
                )

    # Keep the old dense-threshold behavior when hybrid retrieval is disabled.
    strong_docs = (
        [
            doc
            for doc in fused_docs
            if (_safe_float((getattr(doc, "metadata", {}) or {}).get("similarity")) or 0.0) >= min_similarity
        ]
        if not hybrid_enabled
        else fused_docs
    )

    return {
        "hybrid_enabled": hybrid_enabled,
        "keyword_enabled": keyword_enabled and hybrid_enabled,
        "rrf_enabled": _rrf_fusion_enabled() and hybrid_enabled and keyword_enabled,
        "dense_docs": dense_docs,
        "keyword_docs": keyword_docs,
        "fused_docs": fused_docs,
        "strong_docs": strong_docs,
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
    return {
        "source_id": _source_id(index, doc),
        "chunk_id": metadata.get("chunk_id"),
        "aip_id": metadata.get("aip_id"),
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


def _build_refusal(
    *,
    question: str,
    reason: str,
    docs: list[Any],
    top_k: int,
    min_similarity: float,
    retrieval_scope: dict[str, Any] | None,
    verifier_passed: bool,
) -> dict[str, Any]:
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

    answer = (
        "I can't provide a grounded answer from the available published AIP sources. "
        "Please refine the question or specify an exact scope."
    )
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
            "verifier_passed": verifier_passed,
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
            verifier_passed=False,
        )

    bullet_lines: list[str] = []
    for citation in citations:
        source_id = str(citation.get("source_id") or "S0")
        snippet = str(citation.get("snippet") or "").strip()
        if snippet:
            bullet_lines.append(f"- [{source_id}] {snippet}")

    answer_lines = [
        "I found related published AIP records, but the evidence is limited for a fully grounded answer.",
    ]
    if bullet_lines:
        answer_lines.append("Closest records:")
        answer_lines.extend(bullet_lines)
    answer_lines.append(
        "Please narrow the request (exact fiscal year, scope, or ref code) so I can provide a fully verified answer."
    )

    return {
        "question": question,
        "answer": "\n".join(answer_lines).strip(),
        "refused": False,
        "citations": citations,
        "sources": [citation.get("metadata", {}) for citation in citations],
        "context_count": len(docs),
        "retrieval_meta": {
            "reason": reason,
            "top_k": top_k,
            "min_similarity": min_similarity,
            "context_count": len(docs),
            "verifier_passed": False,
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
    keyword_candidate_count: int | None = None,
    fused_candidate_count: int | None = None,
    dense_final_count: int | None = None,
    keyword_final_count: int | None = None,
    evidence_gate_decision: str | None = None,
    evidence_gate_reason: str | None = None,
    evidence_gate_reason_code: str | None = None,
    generation_skipped_by_gate: bool | None = None,
    multi_query_triggered: bool | None = None,
    multi_query_variant_count: int | None = None,
    multi_query_reason: str | None = None,
    multi_query_reason_code: str | None = None,
    active_rag_flags: dict[str, bool] | None = None,
    rag_calibration: dict[str, int | bool] | None = None,
    stage_latency_ms: dict[str, float] | None = None,
    extra_meta: dict[str, Any] | None = None,
    response_mode_source: str | None = None,
    borderline_detected: bool | None = None,
    borderline_reason_code: str | None = None,
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
    if keyword_candidate_count is not None:
        metadata["keyword_candidate_count"] = keyword_candidate_count
    if fused_candidate_count is not None:
        metadata["fused_candidate_count"] = fused_candidate_count
    if dense_final_count is not None:
        metadata["dense_final_count"] = dense_final_count
        metadata["dense_contributed_to_final"] = dense_final_count > 0
    if keyword_final_count is not None:
        metadata["keyword_final_count"] = keyword_final_count
        metadata["keyword_contributed_to_final"] = keyword_final_count > 0
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
    if borderline_detected is not None:
        metadata["borderline_detected"] = borderline_detected
    if borderline_reason_code is not None:
        metadata["borderline_reason_code"] = borderline_reason_code
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
        int(value)
        for value in [
            (getattr(doc, "metadata", {}) or {}).get("fiscal_year")
            for doc in selected_docs
        ]
        if isinstance(value, int)
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


def evaluate_borderline_semantic_evidence(
    *,
    question: str,
    selected_docs: list[Any],
) -> dict[str, Any]:
    # Hard guard: zero selected docs always resolve to refusal path, never borderline partial.
    if not selected_docs:
        return {
            "is_borderline": False,
            "reason_code": "no_selected_docs",
            "metrics": {
                "selected_doc_count": 0,
                "top_overlap": 0.0,
                "top_similarity": 0.0,
            },
        }

    top_overlap = max(
        (_text_overlap(question, str(getattr(doc, "page_content", "") or "")) for doc in selected_docs),
        default=0.0,
    )
    top_similarity = max((_doc_similarity_score(doc) for doc in selected_docs), default=0.0)
    explicit_match_min = _borderline_explicit_match_min()

    is_related = top_overlap >= 0.02 and top_similarity >= 0.2
    has_explicit_match = top_overlap >= explicit_match_min

    if is_related and not has_explicit_match:
        reason_code = "borderline_no_explicit_match"
        borderline = True
    elif not is_related:
        reason_code = "not_related"
        borderline = False
    else:
        reason_code = "explicit_match_detected"
        borderline = False

    return {
        "is_borderline": borderline,
        "reason_code": reason_code,
        "metrics": {
            "selected_doc_count": len(selected_docs),
            "top_overlap": top_overlap,
            "top_similarity": top_similarity,
            "explicit_match_min": explicit_match_min,
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
    retrieval_scope: dict[str, Any] | None = None,
    top_k: int = 8,
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
    supabase = create_client(supabase_url, supabase_service_key)
    retrieval_started_at = time.perf_counter()
    retrieval_bundle = run_hybrid_retrieval(
        supabase=supabase,
        embeddings_model=embeddings_model,
        question=question,
        retrieval_scope=resolved_scope,
        top_k=top_k,
        min_similarity=min_similarity,
    )
    stage_latency_ms["retrieval_ms"] = round((time.perf_counter() - retrieval_started_at) * 1000.0, 3)

    dense_docs = list(retrieval_bundle.get("dense_docs") or [])
    keyword_docs = list(retrieval_bundle.get("keyword_docs") or [])
    docs = list(retrieval_bundle.get("fused_docs") or [])
    strong_docs = list(retrieval_bundle.get("strong_docs") or [])
    diversity_enabled = _diversity_selection_enabled()

    dense_candidate_count = len(dense_docs)
    keyword_candidate_count = len(keyword_docs)
    fused_candidate_count = len(docs)

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
    borderline_detected = False
    borderline_reason_code = "not_evaluated"
    response_mode_source = "pipeline_refusal"

    def attach(
        result: dict[str, Any],
        *,
        selected_count: int,
        strong_count_override: int | None = None,
        generation_skipped_override: bool | None = None,
        extra_meta: dict[str, Any] | None = None,
        response_mode_source_override: str | None = None,
        borderline_detected_override: bool | None = None,
        borderline_reason_code_override: str | None = None,
    ) -> dict[str, Any]:
        stage_latency_snapshot = dict(stage_latency_ms)
        stage_latency_snapshot["total_ms"] = round((time.perf_counter() - started_at) * 1000.0, 3)
        dense_final_count = 0
        keyword_final_count = 0
        if selected_count > 0 and selected_docs:
            dense_final_count, keyword_final_count = _count_channel_contribution(selected_docs)
        return _attach_selection_meta(
            result,
            retrieved_count=len(effective_docs),
            strong_count=strong_count_override if strong_count_override is not None else len(effective_strong_docs),
            selected_count=selected_count,
            diversity_selection_enabled=diversity_enabled,
            dense_candidate_count=dense_candidate_count,
            keyword_candidate_count=keyword_candidate_count,
            fused_candidate_count=fused_candidate_count,
            dense_final_count=dense_final_count,
            keyword_final_count=keyword_final_count,
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
            extra_meta=extra_meta,
            response_mode_source=(
                response_mode_source_override
                if response_mode_source_override is not None
                else response_mode_source
            ),
            borderline_detected=(
                borderline_detected_override
                if borderline_detected_override is not None
                else borderline_detected
            ),
            borderline_reason_code=(
                borderline_reason_code_override
                if borderline_reason_code_override is not None
                else borderline_reason_code
            ),
        )

    if not effective_strong_docs:
        if docs and _partial_mode_enabled():
            response_mode_source = "pipeline_partial"
            borderline_detected = False
            borderline_reason_code = "partial_mode_initial_fallback"
            return attach(
                _build_partial_evidence(
                    question=question,
                    reason="partial_evidence",
                    docs=docs,
                    top_k=top_k,
                    min_similarity=min_similarity,
                    retrieval_scope=resolved_scope,
                ),
                selected_count=min(3, len(docs)),
                strong_count_override=0,
            )
        response_mode_source = "pipeline_refusal"
        borderline_detected = False
        borderline_reason_code = "no_strong_docs"
        return attach(
            _build_refusal(
                question=question,
                reason="insufficient_evidence",
                docs=docs,
                top_k=top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
                verifier_passed=False,
            ),
            selected_count=min(3, len(docs)),
            strong_count_override=0,
        )

    selection_started_at = time.perf_counter()
    selected_docs = (
        _select_diverse_docs(effective_strong_docs, max_docs=6, min_docs=4)
        if diversity_enabled
        else effective_strong_docs[: min(6, len(effective_strong_docs))]
    )
    stage_latency_ms["selection_ms"] = round((time.perf_counter() - selection_started_at) * 1000.0, 3)

    if _evidence_gate_enabled():
        gate_started_at = time.perf_counter()
        gate = evaluate_evidence_gate(question=question, selected_docs=selected_docs)
        gate_decision = str(gate.get("decision") or "clarify")
        gate_reason = str(gate.get("reason") or "gate_blocked")
        gate_reason_code = _evidence_gate_reason_code(gate_reason)
        gate_metrics = dict(gate.get("metrics") or {})
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
                        variant_bundle = run_hybrid_retrieval(
                            supabase=supabase,
                            embeddings_model=embeddings_model,
                            question=variant,
                            retrieval_scope=resolved_scope,
                            top_k=top_k,
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
                            _select_diverse_docs(effective_strong_docs, max_docs=6, min_docs=4)
                            if diversity_enabled
                            else effective_strong_docs[: min(6, len(effective_strong_docs))]
                        )
                        gate = evaluate_evidence_gate(question=question, selected_docs=selected_docs)
                        gate_decision = str(gate.get("decision") or "clarify")
                        gate_reason = str(gate.get("reason") or "gate_blocked")
                        gate_reason_code = _evidence_gate_reason_code(gate_reason)
                        gate_metrics = dict(gate.get("metrics") or {})
                else:
                    multi_query_reason = "no_variants_generated"
                    multi_query_reason_code_value = multi_query_reason_code(multi_query_reason)
        stage_latency_ms["gate_ms"] = round((time.perf_counter() - gate_started_at) * 1000.0, 3)

        if gate_decision != "allow":
            generation_skipped_by_gate = True
            if gate_decision == "clarify":
                response_mode_source = "pipeline_partial"
                borderline_detected = False
                borderline_reason_code = "gate_clarify"
                return attach(
                    _build_partial_evidence(
                        question=question,
                        reason="partial_evidence",
                        docs=selected_docs,
                        top_k=top_k,
                        min_similarity=min_similarity,
                        retrieval_scope=resolved_scope,
                    ),
                    selected_count=len(selected_docs),
                    generation_skipped_override=True,
                    extra_meta=gate_metrics,
                )
            response_mode_source = "pipeline_refusal"
            borderline_detected = False
            borderline_reason_code = "gate_refuse"
            return attach(
                _build_refusal(
                    question=question,
                    reason="insufficient_evidence",
                    docs=selected_docs,
                    top_k=top_k,
                    min_similarity=min_similarity,
                    retrieval_scope=resolved_scope,
                    verifier_passed=False,
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
        "- If evidence is insufficient, return answer as an explicit refusal and still cite nearest sources."
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
        return attach(
            _build_refusal(
                question=question,
                reason="validation_failed",
                docs=selected_docs,
                top_k=top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
                verifier_passed=False,
            ),
            selected_count=len(selected_docs),
            extra_meta=gate_metrics,
        )

    answer_text = str(parsed_generation.get("answer") or "").strip()
    if not answer_text:
        return attach(
            _build_refusal(
                question=question,
                reason="validation_failed",
                docs=selected_docs,
                top_k=top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
                verifier_passed=False,
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
        return attach(
            _build_refusal(
                question=question,
                reason="validation_failed",
                docs=selected_docs,
                top_k=top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
                verifier_passed=False,
            ),
            selected_count=len(selected_docs),
            extra_meta=gate_metrics,
        )

    if any(source_id not in source_map for source_id in used_source_ids):
        return attach(
            _build_refusal(
                question=question,
                reason="verifier_failed",
                docs=selected_docs,
                top_k=top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
                verifier_passed=False,
            ),
            selected_count=len(selected_docs),
            extra_meta=gate_metrics,
        )

    verifier_prompt = (
        "Validate the answer against the provided context and cited sources.\n"
        "Return strict JSON with keys: supported (boolean), issues (array of strings).\n"
        "Set supported=false if any claim is unsupported or if source tags are misused."
    )
    verifier_user_prompt = (
        f"Question:\n{question}\n\n"
        f"Answer:\n{answer_text}\n\n"
        f"Cited Source IDs:\n{', '.join(used_source_ids)}\n\n"
        f"Allowed Sources:\n{_format_source_list(selected_docs)}\n\n"
        f"Context:\n{_format_context(selected_docs)}"
    )
    verifier_started_at = time.perf_counter()
    verifier_response = llm.invoke(
        [
            {"role": "system", "content": verifier_prompt},
            {"role": "user", "content": verifier_user_prompt},
        ]
    )
    stage_latency_ms["verification_ms"] = round((time.perf_counter() - verifier_started_at) * 1000.0, 3)
    parsed_verifier = _extract_json(str(getattr(verifier_response, "content", "")) or "")
    verifier_passed = bool(parsed_verifier and parsed_verifier.get("supported") is True)
    if not verifier_passed:
        borderline_eval = evaluate_borderline_semantic_evidence(
            question=question,
            selected_docs=selected_docs,
        )
        borderline_detected = bool(borderline_eval.get("is_borderline") is True)
        borderline_reason_code = str(borderline_eval.get("reason_code") or "not_borderline")
        borderline_metrics = dict(borderline_eval.get("metrics") or {})

        if _borderline_partial_enabled() and borderline_detected:
            response_mode_source = "pipeline_partial"
            return attach(
                _build_partial_evidence(
                    question=question,
                    reason="partial_evidence",
                    docs=selected_docs,
                    top_k=top_k,
                    min_similarity=min_similarity,
                    retrieval_scope=resolved_scope,
                ),
                selected_count=len(selected_docs),
                extra_meta={
                    **gate_metrics,
                    **borderline_metrics,
                },
                borderline_detected_override=True,
                borderline_reason_code_override=borderline_reason_code,
                response_mode_source_override="pipeline_partial",
            )

        if _partial_mode_enabled():
            response_mode_source = "pipeline_partial"
            return attach(
                _build_partial_evidence(
                    question=question,
                    reason="partial_evidence",
                    docs=selected_docs,
                    top_k=top_k,
                    min_similarity=min_similarity,
                    retrieval_scope=resolved_scope,
                ),
                selected_count=len(selected_docs),
                extra_meta={
                    **gate_metrics,
                    **borderline_metrics,
                },
            )
        response_mode_source = "pipeline_refusal"
        return attach(
            _build_refusal(
                question=question,
                reason="verifier_failed",
                docs=selected_docs,
                top_k=top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
                verifier_passed=False,
            ),
            selected_count=len(selected_docs),
            extra_meta={
                **gate_metrics,
                **borderline_metrics,
            },
        )

    citations: list[dict[str, Any]] = []
    for source_id in used_source_ids:
        index, doc = source_map[source_id]
        citations.append(_build_citation(index, doc, insufficient=False))

    if not citations:
        return attach(
            _build_refusal(
                question=question,
                reason="validation_failed",
                docs=selected_docs,
                top_k=top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
                verifier_passed=False,
            ),
            selected_count=len(selected_docs),
            extra_meta=gate_metrics,
        )

    return attach(
        {
            "question": question,
            "answer": answer_text,
            "refused": False,
            "citations": citations,
            "sources": [citation.get("metadata", {}) for citation in citations],
            "context_count": len(selected_docs),
            "retrieval_meta": {
                "reason": "ok",
                "top_k": top_k,
                "min_similarity": min_similarity,
                "context_count": len(selected_docs),
                "verifier_passed": True,
                "scope_mode": resolved_scope.get("mode", "global"),
                "scope_targets_count": len(resolved_scope.get("targets") or []),
            },
            "legacy_metadata_filter": metadata_filter or {},
        },
        selected_count=len(selected_docs),
        extra_meta=gate_metrics,
        response_mode_source_override="pipeline_generated",
        borderline_detected_override=False,
        borderline_reason_code_override="explicit_match_detected",
    )
