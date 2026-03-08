from __future__ import annotations

import hashlib
from typing import Any


def _scope_params(retrieval_scope: dict[str, Any] | None) -> tuple[str, list[dict[str, Any]], str | None]:
    scope = retrieval_scope or {"mode": "global", "targets": []}
    scope_mode = str(scope.get("mode") or "global").strip().lower()
    targets = scope.get("targets") if isinstance(scope.get("targets"), list) else []

    own_barangay_id: str | None = None
    if scope_mode == "own_barangay":
        for target in targets:
            if not isinstance(target, dict):
                continue
            if str(target.get("scope_type") or "").lower() == "barangay":
                scope_id = str(target.get("scope_id") or "").strip()
                if scope_id:
                    own_barangay_id = scope_id
                    break
    return scope_mode, targets, own_barangay_id


def _content_hash(text: str) -> str:
    normalized = " ".join((text or "").lower().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _doc_key_from_metadata(metadata: dict[str, Any], page_content: str) -> str:
    chunk_id = str(metadata.get("chunk_id") or "").strip()
    if chunk_id:
        return f"chunk:{chunk_id}"
    return f"text:{_content_hash(page_content)}"


def _to_document(*, row: dict[str, Any], channel: str) -> Any:
    from langchain_core.documents import Document

    similarity = row.get("similarity")
    keyword_score = row.get("keyword_score")
    metadata = {
        "source_id": row.get("source_id"),
        "chunk_id": row.get("chunk_id"),
        "aip_id": row.get("aip_id"),
        "fiscal_year": row.get("fiscal_year"),
        "published_at": row.get("published_at"),
        "scope_type": row.get("scope_type"),
        "scope_id": row.get("scope_id"),
        "scope_name": row.get("scope_name"),
        "similarity": similarity,
        "keyword_score": keyword_score,
        "retrieval_channels": [channel],
        "metadata": row.get("metadata") or {},
    }
    return Document(
        page_content=row.get("content") or "",
        metadata=metadata,
    )


def retrieve_dense_docs(
    *,
    supabase: Any,
    embeddings_model: str,
    question: str,
    k: int = 8,
    min_similarity: float = 0.0,
    retrieval_scope: dict[str, Any] | None = None,
) -> list[Any]:
    from langchain_openai import OpenAIEmbeddings

    embeddings = OpenAIEmbeddings(model=embeddings_model)
    query_vector = embeddings.embed_query(question)
    scope_mode, targets, own_barangay_id = _scope_params(retrieval_scope)

    result = supabase.rpc(
        "match_published_aip_chunks",
        {
            "query_embedding": query_vector,
            "match_count": k,
            "min_similarity": min_similarity,
            "scope_mode": scope_mode,
            "own_barangay_id": own_barangay_id,
            "scope_targets": targets,
        },
    ).execute()
    rows = (result.data or [])[:k]
    docs: list[Any] = []
    for row in rows:
        docs.append(_to_document(row=row, channel="dense"))
    return docs


def retrieve_keyword_docs(
    *,
    supabase: Any,
    question: str,
    k: int = 8,
    retrieval_scope: dict[str, Any] | None = None,
    min_rank: float = 0.0,
) -> list[Any]:
    scope_mode, targets, own_barangay_id = _scope_params(retrieval_scope)
    result = supabase.rpc(
        "match_published_aip_chunks_keyword",
        {
            "query_text": question,
            "match_count": k,
            "min_rank": min_rank,
            "scope_mode": scope_mode,
            "own_barangay_id": own_barangay_id,
            "scope_targets": targets,
        },
    ).execute()
    rows = (result.data or [])[:k]
    docs: list[Any] = []
    for row in rows:
        docs.append(_to_document(row=row, channel="keyword"))
    return docs


def fuse_docs_rrf(
    *,
    dense_docs: list[Any],
    keyword_docs: list[Any],
    rrf_k: int = 60,
    max_candidates: int = 24,
) -> list[Any]:
    from langchain_core.documents import Document

    if not dense_docs and not keyword_docs:
        return []

    bucket: dict[str, dict[str, Any]] = {}

    def absorb(doc: Any, rank: int, channel: str) -> None:
        metadata = dict(getattr(doc, "metadata", {}) or {})
        page_content = str(getattr(doc, "page_content", "") or "")
        key = _doc_key_from_metadata(metadata, page_content)
        score = 1.0 / float(rrf_k + max(1, rank))

        entry = bucket.get(key)
        if entry is None:
            bucket[key] = {
                "doc": doc,
                "rrf_score": score,
                "best_rank": rank,
                "channels": {channel},
                "dense_rank": rank if channel == "dense" else None,
                "keyword_rank": rank if channel == "keyword" else None,
            }
            return

        entry["rrf_score"] += score
        entry["best_rank"] = min(int(entry["best_rank"]), rank)
        entry["channels"].add(channel)
        if channel == "dense":
            current = entry.get("dense_rank")
            entry["dense_rank"] = rank if current is None else min(int(current), rank)
        else:
            current = entry.get("keyword_rank")
            entry["keyword_rank"] = rank if current is None else min(int(current), rank)

    for index, doc in enumerate(dense_docs, start=1):
        absorb(doc, index, "dense")
    for index, doc in enumerate(keyword_docs, start=1):
        absorb(doc, index, "keyword")

    fused: list[Any] = []
    for key, entry in bucket.items():
        source_doc = entry["doc"]
        metadata = dict(getattr(source_doc, "metadata", {}) or {})
        metadata["retrieval_channels"] = sorted(list(entry["channels"]))
        metadata["rrf_score"] = float(entry["rrf_score"])
        metadata["hybrid_score"] = float(entry["rrf_score"])
        metadata["best_rank"] = int(entry["best_rank"])
        metadata["dense_rank"] = entry["dense_rank"]
        metadata["keyword_rank"] = entry["keyword_rank"]
        metadata["fusion_key"] = key
        fused.append(
            Document(
                page_content=str(getattr(source_doc, "page_content", "") or ""),
                metadata=metadata,
            )
        )

    fused.sort(
        key=lambda doc: (
            -(float((getattr(doc, "metadata", {}) or {}).get("hybrid_score") or 0.0)),
            int((getattr(doc, "metadata", {}) or {}).get("best_rank") or 9999),
            str((getattr(doc, "metadata", {}) or {}).get("chunk_id") or ""),
            str((getattr(doc, "metadata", {}) or {}).get("fusion_key") or ""),
        )
    )
    return fused[: max(1, max_candidates)]


def retrieve_docs(
    *,
    supabase: Any,
    embeddings_model: str,
    question: str,
    k: int = 8,
    min_similarity: float = 0.0,
    retrieval_scope: dict[str, Any] | None = None,
) -> list[Any]:
    # Backward-compatible dense retrieval entrypoint.
    docs = retrieve_dense_docs(
        supabase=supabase,
        embeddings_model=embeddings_model,
        question=question,
        k=k,
        min_similarity=min_similarity,
        retrieval_scope=retrieval_scope,
    )
    return docs
