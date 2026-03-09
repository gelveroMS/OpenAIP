from __future__ import annotations

import hashlib
import re
from typing import Any

YEAR_PATTERN = re.compile(r"\b(20\d{2})\b")
MULTI_YEAR_CUE_PATTERN = re.compile(
    r"\b(compare|comparison|trend|across|between|vs|versus|from\s+20\d{2}\s+to\s+20\d{2})\b"
)
DOC_TYPE_PATTERN = re.compile(r"\b(baip|aip)\b", re.IGNORECASE)
TOKEN_PATTERN = re.compile(r"[a-z0-9]{2,}")

THEME_TAG_HINTS: dict[str, tuple[str, ...]] = {
    "health": ("health", "medical", "clinic", "nutrition"),
    "disaster": ("disaster", "drrm", "calamity"),
    "emergency response": ("emergency", "rescue", "response"),
    "peace and order": ("peace and order", "tanod", "security"),
    "senior citizens": ("senior citizen", "elderly"),
    "pwd": ("pwd", "person with disability", "persons with disability"),
    "gad": ("gad", "gender and development", "gender"),
    "infrastructure": ("infrastructure", "road", "bridge", "drainage", "canal"),
    "livelihood": ("livelihood", "employment", "income"),
    "environment": ("environment", "climate", "tree", "greening"),
    "sanitation": ("sanitation", "hygiene", "sanitary", "toilet"),
    "training": ("training", "capacity building", "workshop"),
    "seminar": ("seminar", "orientation"),
    "procurement": ("procurement", "purchase", "acquisition"),
    "construction": ("construction", "rehabilitation", "repair"),
    "assistance": ("assistance", "aid", "subsidy", "support"),
    "maintenance": ("maintenance", "upkeep"),
    "operations": ("operations", "operating", "administrative"),
}


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


def _normalize_text(text: str) -> str:
    return " ".join((text or "").lower().split())


def _content_hash(text: str) -> str:
    normalized = _normalize_text(text)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _token_set(text: str) -> set[str]:
    return set(TOKEN_PATTERN.findall(_normalize_text(text)))


def _overlap_score(question: str, content: str) -> float:
    q_tokens = _token_set(question)
    c_tokens = _token_set(content)
    if not q_tokens or not c_tokens:
        return 0.0
    union = q_tokens | c_tokens
    if not union:
        return 0.0
    return float(len(q_tokens & c_tokens)) / float(len(union))


def _normalize_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_tag_list(value: Any) -> list[str]:
    if value is None:
        return []
    items: list[str] = []
    if isinstance(value, list):
        candidates = value
    elif isinstance(value, tuple):
        candidates = list(value)
    elif isinstance(value, str):
        candidates = [part.strip() for part in value.split(",")]
    else:
        candidates = [value]

    for item in candidates:
        normalized = _normalize_string(item)
        if not normalized:
            continue
        cleaned = " ".join(normalized.lower().split())
        if cleaned:
            items.append(cleaned)
    return sorted(set(items))


def _derive_theme_tags(question: str) -> list[str]:
    normalized = _normalize_text(question)
    if not normalized:
        return []
    tags: list[str] = []
    for tag, keywords in THEME_TAG_HINTS.items():
        if any(keyword in normalized for keyword in keywords):
            tags.append(tag)
    return sorted(set(tags))


def _normalize_retrieval_filters(
    retrieval_filters: dict[str, Any] | None,
    *,
    question: str,
    retrieval_scope: dict[str, Any] | None,
) -> dict[str, Any]:
    filters = dict(retrieval_filters or {})
    normalized: dict[str, Any] = {}

    publication_status = _normalize_string(filters.get("publication_status")) or "published"
    normalized["publication_status"] = publication_status.lower()

    fiscal_year_raw = filters.get("fiscal_year")
    fiscal_year: int | None = None
    if isinstance(fiscal_year_raw, int):
        fiscal_year = fiscal_year_raw
    elif isinstance(fiscal_year_raw, str) and fiscal_year_raw.strip().isdigit():
        fiscal_year = int(fiscal_year_raw.strip())

    if fiscal_year is None:
        years = sorted({int(match) for match in YEAR_PATTERN.findall(question or "")})
        multi_year = len(years) > 1 or bool(MULTI_YEAR_CUE_PATTERN.search(_normalize_text(question)))
        if len(years) == 1 and not multi_year:
            fiscal_year = years[0]

    if fiscal_year is not None:
        normalized["fiscal_year"] = fiscal_year

    scope_type = (_normalize_string(filters.get("scope_type")) or "").lower()
    scope_name = _normalize_string(filters.get("scope_name"))
    if not scope_type or not scope_name:
        scope = retrieval_scope or {}
        targets = scope.get("targets") if isinstance(scope.get("targets"), list) else []
        if len(targets) == 1 and isinstance(targets[0], dict):
            if not scope_type:
                scope_type = (_normalize_string(targets[0].get("scope_type")) or "").lower()
            if not scope_name:
                scope_name = _normalize_string(targets[0].get("scope_name"))

    if scope_type:
        normalized["scope_type"] = scope_type
    if scope_name:
        normalized["scope_name"] = scope_name

    document_type = _normalize_string(filters.get("document_type"))
    if not document_type:
        match = DOC_TYPE_PATTERN.search(question or "")
        if match:
            document_type = match.group(1).upper()
    if document_type:
        normalized["document_type"] = document_type.upper()

    office_name = _normalize_string(filters.get("office_name"))
    if office_name:
        normalized["office_name"] = office_name

    theme_tags = _normalize_tag_list(filters.get("theme_tags"))
    if not theme_tags:
        theme_tags = _derive_theme_tags(question)
    if theme_tags:
        normalized["theme_tags"] = theme_tags

    sector_tags = _normalize_tag_list(filters.get("sector_tags"))
    if sector_tags:
        normalized["sector_tags"] = sector_tags

    return normalized


def _row_tag_set(row: dict[str, Any]) -> set[str]:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    row_theme = _normalize_tag_list(row.get("theme_tags"))
    row_sector = _normalize_tag_list(row.get("sector_tags"))
    md_theme = _normalize_tag_list((metadata or {}).get("theme_tags"))
    md_sector = _normalize_tag_list((metadata or {}).get("sector_tags"))
    return set([*row_theme, *row_sector, *md_theme, *md_sector])


def _row_matches_filters(row: dict[str, Any], filters: dict[str, Any]) -> bool:
    if not filters:
        return True

    fiscal_year = filters.get("fiscal_year")
    if isinstance(fiscal_year, int):
        if int(row.get("fiscal_year") or -1) != fiscal_year:
            return False

    scope_type = _normalize_string(filters.get("scope_type"))
    if scope_type:
        if _normalize_text(str(row.get("scope_type") or "")) != _normalize_text(scope_type):
            return False

    scope_name = _normalize_string(filters.get("scope_name"))
    if scope_name:
        if _normalize_text(str(row.get("scope_name") or "")) != _normalize_text(scope_name):
            return False

    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}

    document_type = _normalize_string(filters.get("document_type"))
    if document_type:
        row_doc_type = _normalize_string(row.get("document_type")) or _normalize_string((metadata or {}).get("document_type"))
        if _normalize_text(row_doc_type or "") != _normalize_text(document_type):
            return False

    publication_status = _normalize_string(filters.get("publication_status"))
    if publication_status:
        row_status = (
            _normalize_string(row.get("publication_status"))
            or _normalize_string((metadata or {}).get("publication_status"))
            or "published"
        )
        if _normalize_text(row_status) != _normalize_text(publication_status):
            return False

    office_name = _normalize_string(filters.get("office_name"))
    if office_name:
        row_office = _normalize_string(row.get("office_name")) or _normalize_string((metadata or {}).get("office_name"))
        if _normalize_text(row_office or "") != _normalize_text(office_name):
            return False

    theme_tags = set(_normalize_tag_list(filters.get("theme_tags")))
    if theme_tags:
        if not (theme_tags & _row_tag_set(row)):
            return False

    sector_tags = set(_normalize_tag_list(filters.get("sector_tags")))
    if sector_tags:
        if not (sector_tags & _row_tag_set(row)):
            return False

    return True


def _doc_key_from_metadata(metadata: dict[str, Any], page_content: str) -> str:
    chunk_id = str(metadata.get("chunk_id") or "").strip()
    if chunk_id:
        return f"chunk:{chunk_id}"
    return f"text:{_content_hash(page_content)}"


def _dedupe_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        content = str(row.get("content") or "")
        key = _doc_key_from_metadata(metadata or {}, content)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def _merge_rows(primary: list[dict[str, Any]], secondary: list[dict[str, Any]], *, limit: int) -> list[dict[str, Any]]:
    return _dedupe_rows([*primary, *secondary])[: max(1, limit)]


def _rerank_rows(
    rows: list[dict[str, Any]],
    *,
    question: str,
    filters: dict[str, Any],
    limit: int,
) -> list[dict[str, Any]]:
    preferred_tags = set(_normalize_tag_list(filters.get("theme_tags"))) | set(
        _normalize_tag_list(filters.get("sector_tags"))
    )

    scored_rows: list[dict[str, Any]] = []
    for row in rows:
        content = str(row.get("content") or "")
        semantic = float(row.get("similarity") or 0.0)
        lexical_overlap = _overlap_score(question, content)
        row_tags = _row_tag_set(row)
        tag_overlap = (
            float(len(preferred_tags & row_tags)) / float(max(1, len(preferred_tags)))
            if preferred_tags
            else 0.0
        )
        rerank_score = semantic + (0.08 * tag_overlap) + (0.05 * lexical_overlap)
        copied = dict(row)
        copied["hybrid_score"] = rerank_score
        scored_rows.append(copied)

    scored_rows.sort(
        key=lambda row: (
            -(float(row.get("hybrid_score") or 0.0)),
            -(float(row.get("similarity") or 0.0)),
            str(row.get("chunk_id") or ""),
        )
    )
    return scored_rows[: max(1, limit)]


def _to_document(*, row: dict[str, Any], channel: str) -> Any:
    from langchain_core.documents import Document

    similarity = row.get("similarity")
    keyword_score = row.get("keyword_score")
    metadata = {
        "source_id": row.get("source_id"),
        "chunk_id": row.get("chunk_id"),
        "chunk_type": row.get("chunk_type"),
        "document_type": row.get("document_type"),
        "publication_status": row.get("publication_status"),
        "office_name": row.get("office_name"),
        "project_ref_code": row.get("project_ref_code"),
        "source_page": row.get("source_page"),
        "theme_tags": row.get("theme_tags") or [],
        "sector_tags": row.get("sector_tags") or [],
        "aip_id": row.get("aip_id"),
        "fiscal_year": row.get("fiscal_year"),
        "published_at": row.get("published_at"),
        "scope_type": row.get("scope_type"),
        "scope_id": row.get("scope_id"),
        "scope_name": row.get("scope_name"),
        "similarity": similarity,
        "keyword_score": keyword_score,
        "hybrid_score": row.get("hybrid_score"),
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
    retrieval_mode: str = "qa",
    retrieval_filters: dict[str, Any] | None = None,
    allow_legacy_fallback: bool = True,
) -> list[Any]:
    from langchain_openai import OpenAIEmbeddings

    embeddings = OpenAIEmbeddings(model=embeddings_model)
    query_vector = embeddings.embed_query(question)
    scope_mode, targets, own_barangay_id = _scope_params(retrieval_scope)
    normalized_filters = _normalize_retrieval_filters(
        retrieval_filters,
        question=question,
        retrieval_scope=retrieval_scope,
    )
    include_summary_chunks = retrieval_mode == "overview"

    rows: list[dict[str, Any]] = []
    try:
        params = {
            "query_embedding": query_vector,
            "match_count": k,
            "min_similarity": min_similarity,
            "scope_mode": scope_mode,
            "own_barangay_id": own_barangay_id,
            "scope_targets": targets,
            "filter_fiscal_year": normalized_filters.get("fiscal_year"),
            "filter_scope_type": normalized_filters.get("scope_type"),
            "filter_scope_name": normalized_filters.get("scope_name"),
            "filter_document_type": normalized_filters.get("document_type"),
            "filter_publication_status": normalized_filters.get("publication_status"),
            "filter_office_name": normalized_filters.get("office_name"),
            "filter_theme_tags": normalized_filters.get("theme_tags"),
            "filter_sector_tags": normalized_filters.get("sector_tags"),
            "include_summary_chunks": include_summary_chunks,
        }
        v2_result = supabase.rpc("match_published_aip_project_chunks_v2", params).execute()
        rows = list(v2_result.data or [])
    except Exception:
        rows = []

    rows = [row for row in rows if _row_matches_filters(row, normalized_filters)]
    rows = _rerank_rows(rows, question=question, filters=normalized_filters, limit=k)

    # QA mode falls back to summaries only when evidence is sparse.
    if retrieval_mode == "qa" and len(rows) < min(2, max(1, k)):
        try:
            summary_result = supabase.rpc(
                "match_published_aip_project_chunks_v2",
                {
                    "query_embedding": query_vector,
                    "match_count": k,
                    "min_similarity": min_similarity,
                    "scope_mode": scope_mode,
                    "own_barangay_id": own_barangay_id,
                    "scope_targets": targets,
                    "filter_fiscal_year": normalized_filters.get("fiscal_year"),
                    "filter_scope_type": normalized_filters.get("scope_type"),
                    "filter_scope_name": normalized_filters.get("scope_name"),
                    "filter_document_type": normalized_filters.get("document_type"),
                    "filter_publication_status": normalized_filters.get("publication_status"),
                    "filter_office_name": normalized_filters.get("office_name"),
                    "filter_theme_tags": normalized_filters.get("theme_tags"),
                    "filter_sector_tags": normalized_filters.get("sector_tags"),
                    "include_summary_chunks": True,
                },
            ).execute()
            summary_rows = [row for row in list(summary_result.data or []) if _row_matches_filters(row, normalized_filters)]
            summary_rows = _rerank_rows(summary_rows, question=question, filters=normalized_filters, limit=k)
            rows = _merge_rows(rows, summary_rows, limit=k)
        except Exception:
            pass

    # Dual-read fallback during rollout.
    if allow_legacy_fallback and len(rows) < min(2, max(1, k)):
        try:
            legacy_result = supabase.rpc(
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
            legacy_rows = [row for row in list(legacy_result.data or []) if _row_matches_filters(row, normalized_filters)]
            legacy_rows = _rerank_rows(legacy_rows, question=question, filters=normalized_filters, limit=k)
            rows = _merge_rows(rows, legacy_rows, limit=k)
        except Exception:
            pass

    docs: list[Any] = []
    for row in rows[:k]:
        docs.append(_to_document(row=row, channel="dense"))
    return docs


def retrieve_keyword_docs(
    *,
    supabase: Any,
    question: str,
    k: int = 8,
    retrieval_scope: dict[str, Any] | None = None,
    min_rank: float = 0.0,
    retrieval_filters: dict[str, Any] | None = None,
) -> list[Any]:
    scope_mode, targets, own_barangay_id = _scope_params(retrieval_scope)
    normalized_filters = _normalize_retrieval_filters(
        retrieval_filters,
        question=question,
        retrieval_scope=retrieval_scope,
    )
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
    rows = [row for row in list(result.data or []) if _row_matches_filters(row, normalized_filters)]
    rows = _rerank_rows(rows, question=question, filters=normalized_filters, limit=k)
    docs: list[Any] = []
    for row in rows[:k]:
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
    retrieval_mode: str = "qa",
    retrieval_filters: dict[str, Any] | None = None,
) -> list[Any]:
    docs = retrieve_dense_docs(
        supabase=supabase,
        embeddings_model=embeddings_model,
        question=question,
        k=k,
        min_similarity=min_similarity,
        retrieval_scope=retrieval_scope,
        retrieval_mode=retrieval_mode,
        retrieval_filters=retrieval_filters,
    )
    return docs

