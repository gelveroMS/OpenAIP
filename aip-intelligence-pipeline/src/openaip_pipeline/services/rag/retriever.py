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
THEME_BOOST_WEIGHT = 0.06
SECTOR_BOOST_WEIGHT = 0.04
DOCUMENT_TYPE_BOOST = 0.02
OFFICE_NAME_BOOST = 0.02
LEXICAL_OVERLAP_WEIGHT = 0.03

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


def _resolve_retrieval_policy(
    retrieval_filters: dict[str, Any] | None,
    *,
    question: str,
    retrieval_scope: dict[str, Any] | None,
) -> dict[str, Any]:
    filters = dict(retrieval_filters or {})
    hard_filters: dict[str, Any] = {}
    soft_preferences: dict[str, Any] = {}

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
        hard_filters["fiscal_year"] = fiscal_year

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
        hard_filters["scope_type"] = scope_type
    if scope_name:
        hard_filters["scope_name"] = scope_name

    document_type = _normalize_string(filters.get("document_type"))
    if not document_type:
        match = DOC_TYPE_PATTERN.search(question or "")
        if match:
            document_type = match.group(1).upper()
    if document_type:
        soft_preferences["document_type"] = document_type.upper()

    office_name = _normalize_string(filters.get("office_name"))
    if office_name:
        soft_preferences["office_name"] = office_name

    theme_tags = _normalize_tag_list(filters.get("theme_tags"))
    if not theme_tags:
        theme_tags = _derive_theme_tags(question)
    if theme_tags:
        soft_preferences["theme_tags"] = theme_tags

    sector_tags = _normalize_tag_list(filters.get("sector_tags"))
    if sector_tags:
        soft_preferences["sector_tags"] = sector_tags

    return {
        "hard_filters": hard_filters,
        "soft_preferences": soft_preferences,
    }


def _row_tag_set(row: dict[str, Any]) -> set[str]:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    row_theme = _normalize_tag_list(row.get("theme_tags"))
    row_sector = _normalize_tag_list(row.get("sector_tags"))
    md_theme = _normalize_tag_list((metadata or {}).get("theme_tags"))
    md_sector = _normalize_tag_list((metadata or {}).get("sector_tags"))
    return set([*row_theme, *row_sector, *md_theme, *md_sector])


def _row_matches_filters(row: dict[str, Any], hard_filters: dict[str, Any]) -> bool:
    if not hard_filters:
        return True

    fiscal_year = hard_filters.get("fiscal_year")
    if isinstance(fiscal_year, int):
        if int(row.get("fiscal_year") or -1) != fiscal_year:
            return False

    scope_type = _normalize_string(hard_filters.get("scope_type"))
    if scope_type:
        if _normalize_text(str(row.get("scope_type") or "")) != _normalize_text(scope_type):
            return False

    scope_name = _normalize_string(hard_filters.get("scope_name"))
    if scope_name:
        if _normalize_text(str(row.get("scope_name") or "")) != _normalize_text(scope_name):
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


def _rerank_rows(
    rows: list[dict[str, Any]],
    *,
    question: str,
    soft_preferences: dict[str, Any],
    limit: int,
) -> list[dict[str, Any]]:
    theme_preferences = set(_normalize_tag_list(soft_preferences.get("theme_tags")))
    sector_preferences = set(_normalize_tag_list(soft_preferences.get("sector_tags")))
    preferred_document_type = _normalize_string(soft_preferences.get("document_type"))
    preferred_office_name = _normalize_string(soft_preferences.get("office_name"))

    scored_rows: list[dict[str, Any]] = []
    for row in rows:
        content = str(row.get("content") or "")
        semantic = float(row.get("similarity") or 0.0)
        lexical_overlap = _overlap_score(question, content)
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        row_theme_tags = set(_normalize_tag_list(row.get("theme_tags"))) | set(
            _normalize_tag_list((metadata or {}).get("theme_tags"))
        )
        row_sector_tags = set(_normalize_tag_list(row.get("sector_tags"))) | set(
            _normalize_tag_list((metadata or {}).get("sector_tags"))
        )

        theme_overlap = (
            float(len(theme_preferences & row_theme_tags)) / float(max(1, len(theme_preferences)))
            if theme_preferences
            else 0.0
        )
        sector_overlap = (
            float(len(sector_preferences & row_sector_tags)) / float(max(1, len(sector_preferences)))
            if sector_preferences
            else 0.0
        )

        row_doc_type = _normalize_string(row.get("document_type")) or _normalize_string((metadata or {}).get("document_type"))
        row_office_name = _normalize_string(row.get("office_name")) or _normalize_string((metadata or {}).get("office_name"))
        document_boost = (
            DOCUMENT_TYPE_BOOST
            if preferred_document_type
            and row_doc_type
            and _normalize_text(row_doc_type) == _normalize_text(preferred_document_type)
            else 0.0
        )
        office_boost = (
            OFFICE_NAME_BOOST
            if preferred_office_name
            and row_office_name
            and _normalize_text(row_office_name) == _normalize_text(preferred_office_name)
            else 0.0
        )
        theme_boost = THEME_BOOST_WEIGHT * theme_overlap
        sector_boost = SECTOR_BOOST_WEIGHT * sector_overlap
        lexical_boost = LEXICAL_OVERLAP_WEIGHT * lexical_overlap
        soft_boost_total = theme_boost + sector_boost + document_boost + office_boost + lexical_boost
        rerank_score = semantic + soft_boost_total
        copied = dict(row)
        copied["semantic_score"] = semantic
        copied["theme_boost"] = theme_boost
        copied["sector_boost"] = sector_boost
        copied["document_boost"] = document_boost
        copied["office_boost"] = office_boost
        copied["lexical_boost"] = lexical_boost
        copied["soft_boost_total"] = soft_boost_total
        copied["rank_score"] = rerank_score
        scored_rows.append(copied)

    scored_rows.sort(
        key=lambda row: (
            -(float(row.get("rank_score") or 0.0)),
            -(float(row.get("similarity") or 0.0)),
            str(row.get("chunk_id") or ""),
        )
    )
    return scored_rows[: max(1, limit)]


def _to_document(*, row: dict[str, Any]) -> Any:
    from langchain_core.documents import Document

    similarity = row.get("similarity")
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
        "semantic_score": row.get("semantic_score"),
        "theme_boost": row.get("theme_boost"),
        "soft_boost_total": row.get("soft_boost_total"),
        "rank_score": row.get("rank_score"),
        "metadata": row.get("metadata") or {},
    }
    return Document(
        page_content=row.get("content") or "",
        metadata=metadata,
    )


def retrieve_dense_docs_bundle(
    *,
    supabase: Any,
    embeddings_model: str,
    question: str,
    k: int = 8,
    min_similarity: float = 0.0,
    retrieval_scope: dict[str, Any] | None = None,
    retrieval_mode: str = "qa",
    retrieval_filters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from langchain_openai import OpenAIEmbeddings

    embeddings = OpenAIEmbeddings(model=embeddings_model)
    query_vector = embeddings.embed_query(question)
    scope_mode, targets, own_barangay_id = _scope_params(retrieval_scope)
    retrieval_policy = _resolve_retrieval_policy(
        retrieval_filters,
        question=question,
        retrieval_scope=retrieval_scope,
    )
    hard_filters = dict(retrieval_policy.get("hard_filters") or {})
    soft_preferences = dict(retrieval_policy.get("soft_preferences") or {})
    include_summary_chunks = retrieval_mode == "overview"

    raw_rows: list[dict[str, Any]] = []
    try:
        params = {
            "query_embedding": query_vector,
            "match_count": k,
            "min_similarity": min_similarity,
            "scope_mode": scope_mode,
            "own_barangay_id": own_barangay_id,
            "scope_targets": targets,
            "filter_fiscal_year": hard_filters.get("fiscal_year"),
            "filter_scope_type": hard_filters.get("scope_type"),
            "filter_scope_name": hard_filters.get("scope_name"),
            "filter_document_type": None,
            "filter_publication_status": None,
            "filter_office_name": None,
            "filter_theme_tags": None,
            "filter_sector_tags": None,
            "include_summary_chunks": include_summary_chunks,
        }
        v2_result = supabase.rpc("match_published_aip_project_chunks_v2", params).execute()
        raw_rows = list(v2_result.data or [])
    except Exception:
        raw_rows = []

    filtered_rows = [row for row in raw_rows if _row_matches_filters(row, hard_filters)]
    reranked_rows = _rerank_rows(filtered_rows, question=question, soft_preferences=soft_preferences, limit=k)

    docs: list[Any] = []
    for row in reranked_rows[:k]:
        docs.append(_to_document(row=row))
    theme_boost_count = sum(1 for row in reranked_rows if float(row.get("theme_boost") or 0.0) > 0.0)
    diagnostics = {
        "hard_filters_applied": hard_filters,
        "soft_preferences": soft_preferences,
        "theme_boost_usage": {
            "count": theme_boost_count,
            "ratio": (
                float(theme_boost_count) / float(max(1, len(reranked_rows)))
                if reranked_rows
                else 0.0
            ),
        },
        "candidate_counts": {
            "raw": len(raw_rows),
            "after_hard_filters": len(filtered_rows),
            "reranked": len(reranked_rows),
        },
    }
    return {
        "docs": docs,
        "diagnostics": diagnostics,
    }


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
) -> list[Any]:
    bundle = retrieve_dense_docs_bundle(
        supabase=supabase,
        embeddings_model=embeddings_model,
        question=question,
        k=k,
        min_similarity=min_similarity,
        retrieval_scope=retrieval_scope,
        retrieval_mode=retrieval_mode,
        retrieval_filters=retrieval_filters,
    )
    return list(bundle.get("docs") or [])


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

