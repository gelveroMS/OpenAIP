from __future__ import annotations

import json
import os
import re
import hashlib
from typing import Any

from openaip_pipeline.core.resources import read_text
from openaip_pipeline.services.rag.retriever import retrieve_docs

SOURCE_TAG_PATTERN = re.compile(r"\[(S\d+)\]")
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


def _diversity_selection_enabled() -> bool:
    value = os.getenv("RAG_DIVERSITY_SELECTION_ENABLED", "true").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _normalize_content(text: str) -> str:
    return " ".join((text or "").lower().split())


def _content_hash(text: str) -> str:
    return hashlib.sha256(_normalize_content(text).encode("utf-8")).hexdigest()


def _doc_similarity_score(doc: Any) -> float:
    metadata = getattr(doc, "metadata", {}) or {}
    return _safe_float(metadata.get("similarity")) or 0.0


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
    result["retrieval_meta"] = metadata
    result["context_count"] = selected_count
    return result


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

    resolved_scope = retrieval_scope or {"mode": "global", "targets": []}

    supabase = create_client(supabase_url, supabase_service_key)
    docs = retrieve_docs(
        supabase=supabase,
        embeddings_model=embeddings_model,
        question=question,
        k=max(1, min(top_k, 12)),
        min_similarity=0.0,
        retrieval_scope=resolved_scope,
    )

    strong_docs = [
        doc
        for doc in docs
        if (_safe_float((getattr(doc, "metadata", {}) or {}).get("similarity")) or 0.0) >= min_similarity
    ]
    diversity_enabled = _diversity_selection_enabled()
    if not strong_docs:
        if docs and _partial_mode_enabled():
            return _attach_selection_meta(
                _build_partial_evidence(
                    question=question,
                    reason="partial_evidence",
                    docs=docs,
                    top_k=top_k,
                    min_similarity=min_similarity,
                    retrieval_scope=resolved_scope,
                ),
                retrieved_count=len(docs),
                strong_count=0,
                selected_count=min(3, len(docs)),
                diversity_selection_enabled=diversity_enabled,
            )
        return _attach_selection_meta(
            _build_refusal(
                question=question,
                reason="insufficient_evidence",
                docs=docs,
                top_k=top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
                verifier_passed=False,
            ),
            retrieved_count=len(docs),
            strong_count=0,
            selected_count=min(3, len(docs)),
            diversity_selection_enabled=diversity_enabled,
        )

    selected_docs = (
        _select_diverse_docs(strong_docs, max_docs=6, min_docs=4)
        if diversity_enabled
        else strong_docs[: min(6, len(strong_docs))]
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
    generation_response = llm.invoke(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": generation_user_prompt},
        ]
    )
    parsed_generation = _extract_json(str(getattr(generation_response, "content", "")) or "")
    if not parsed_generation:
        return _attach_selection_meta(
            _build_refusal(
                question=question,
                reason="validation_failed",
                docs=selected_docs,
                top_k=top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
                verifier_passed=False,
            ),
            retrieved_count=len(docs),
            strong_count=len(strong_docs),
            selected_count=len(selected_docs),
            diversity_selection_enabled=diversity_enabled,
        )

    answer_text = str(parsed_generation.get("answer") or "").strip()
    if not answer_text:
        return _attach_selection_meta(
            _build_refusal(
                question=question,
                reason="validation_failed",
                docs=selected_docs,
                top_k=top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
                verifier_passed=False,
            ),
            retrieved_count=len(docs),
            strong_count=len(strong_docs),
            selected_count=len(selected_docs),
            diversity_selection_enabled=diversity_enabled,
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
        return _attach_selection_meta(
            _build_refusal(
                question=question,
                reason="validation_failed",
                docs=selected_docs,
                top_k=top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
                verifier_passed=False,
            ),
            retrieved_count=len(docs),
            strong_count=len(strong_docs),
            selected_count=len(selected_docs),
            diversity_selection_enabled=diversity_enabled,
        )

    if any(source_id not in source_map for source_id in used_source_ids):
        return _attach_selection_meta(
            _build_refusal(
                question=question,
                reason="verifier_failed",
                docs=selected_docs,
                top_k=top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
                verifier_passed=False,
            ),
            retrieved_count=len(docs),
            strong_count=len(strong_docs),
            selected_count=len(selected_docs),
            diversity_selection_enabled=diversity_enabled,
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
    verifier_response = llm.invoke(
        [
            {"role": "system", "content": verifier_prompt},
            {"role": "user", "content": verifier_user_prompt},
        ]
    )
    parsed_verifier = _extract_json(str(getattr(verifier_response, "content", "")) or "")
    verifier_passed = bool(parsed_verifier and parsed_verifier.get("supported") is True)
    if not verifier_passed:
        if _partial_mode_enabled():
            return _attach_selection_meta(
                _build_partial_evidence(
                    question=question,
                    reason="partial_evidence",
                    docs=selected_docs,
                    top_k=top_k,
                    min_similarity=min_similarity,
                    retrieval_scope=resolved_scope,
                ),
                retrieved_count=len(docs),
                strong_count=len(strong_docs),
                selected_count=len(selected_docs),
                diversity_selection_enabled=diversity_enabled,
            )
        return _attach_selection_meta(
            _build_refusal(
                question=question,
                reason="verifier_failed",
                docs=selected_docs,
                top_k=top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
                verifier_passed=False,
            ),
            retrieved_count=len(docs),
            strong_count=len(strong_docs),
            selected_count=len(selected_docs),
            diversity_selection_enabled=diversity_enabled,
        )

    citations: list[dict[str, Any]] = []
    for source_id in used_source_ids:
        index, doc = source_map[source_id]
        citations.append(_build_citation(index, doc, insufficient=False))

    if not citations:
        return _attach_selection_meta(
            _build_refusal(
                question=question,
                reason="validation_failed",
                docs=selected_docs,
                top_k=top_k,
                min_similarity=min_similarity,
                retrieval_scope=resolved_scope,
                verifier_passed=False,
            ),
            retrieved_count=len(docs),
            strong_count=len(strong_docs),
            selected_count=len(selected_docs),
            diversity_selection_enabled=diversity_enabled,
        )

    return _attach_selection_meta(
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
        retrieved_count=len(docs),
        strong_count=len(strong_docs),
        selected_count=len(selected_docs),
        diversity_selection_enabled=diversity_enabled,
    )
