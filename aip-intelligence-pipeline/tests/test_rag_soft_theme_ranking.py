from __future__ import annotations

import sys
import types

from openaip_pipeline.services.rag.rag import answer_with_rag
from openaip_pipeline.services.rag.retriever import retrieve_dense_docs_bundle


class _FakeDocument:
    def __init__(self, *, page_content: str, metadata: dict):
        self.page_content = page_content
        self.metadata = metadata


class _FakeOpenAIEmbeddings:
    def __init__(self, *args, **kwargs):  # noqa: D401, ANN001, ANN003
        pass

    def embed_query(self, _text: str) -> list[float]:
        return [0.11, 0.22, 0.33]


class _FakeRPCResult:
    def __init__(self, rows: list[dict]):
        self.data = rows

    def execute(self) -> "_FakeRPCResult":
        return self


class _FakeSupabase:
    def __init__(self, *, rows: list[dict]):
        self._rows = rows
        self.calls: list[dict] = []

    def rpc(self, name: str, params: dict) -> _FakeRPCResult:
        self.calls.append({"name": name, "params": dict(params)})
        return _FakeRPCResult(self._rows)


def _row(
    *,
    chunk_id: str,
    similarity: float,
    content: str,
    fiscal_year: int = 2025,
    scope_type: str = "barangay",
    scope_name: str = "Mamatid",
    theme_tags: list[str] | None = None,
    sector_tags: list[str] | None = None,
) -> dict:
    return {
        "source_id": chunk_id.upper(),
        "chunk_id": chunk_id,
        "content": content,
        "similarity": similarity,
        "chunk_type": "project",
        "document_type": "AIP",
        "publication_status": "published",
        "office_name": "Barangay Office",
        "project_ref_code": "REF-1",
        "source_page": 3,
        "theme_tags": theme_tags or [],
        "sector_tags": sector_tags or [],
        "aip_id": "aip-1",
        "fiscal_year": fiscal_year,
        "published_at": "2026-01-01T00:00:00+00:00",
        "scope_type": scope_type,
        "scope_id": "brgy-1",
        "scope_name": scope_name,
        "metadata": {},
    }


def _patch_langchain(monkeypatch) -> None:
    monkeypatch.setitem(
        sys.modules,
        "langchain_openai",
        types.SimpleNamespace(
            OpenAIEmbeddings=_FakeOpenAIEmbeddings,
            ChatOpenAI=object,
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "langchain_core.documents",
        types.SimpleNamespace(Document=_FakeDocument),
    )


def test_exact_theme_match_gets_soft_rank_boost(monkeypatch) -> None:
    _patch_langchain(monkeypatch)
    supabase = _FakeSupabase(
        rows=[
            _row(
                chunk_id="c1",
                similarity=0.81,
                content="Drainage canal rehabilitation details for FY 2025.",
                theme_tags=["drainage"],
            ),
            _row(
                chunk_id="c2",
                similarity=0.81,
                content="Livelihood training details for FY 2025.",
                theme_tags=["livelihood"],
            ),
        ]
    )

    bundle = retrieve_dense_docs_bundle(
        supabase=supabase,
        embeddings_model="text-embedding-3-large",
        question="What does the AIP say about drainage projects?",
        k=5,
        min_similarity=0.0,
        retrieval_scope={"mode": "global", "targets": []},
        retrieval_mode="qa",
        retrieval_filters={"fiscal_year": 2025, "scope_type": "barangay", "scope_name": "Mamatid", "theme_tags": ["drainage"]},
    )

    docs = bundle["docs"]
    diagnostics = bundle["diagnostics"]
    assert docs[0].metadata["chunk_id"] == "c1"
    assert diagnostics["theme_boost_usage"]["count"] == 1
    assert diagnostics["hard_filters_applied"]["scope_name"] == "Mamatid"
    assert diagnostics["soft_preferences"]["theme_tags"] == ["drainage"]
    assert supabase.calls[0]["params"]["filter_theme_tags"] is None


def test_no_exact_theme_tag_still_returns_semantic_match(monkeypatch) -> None:
    _patch_langchain(monkeypatch)
    supabase = _FakeSupabase(
        rows=[
            _row(
                chunk_id="c1",
                similarity=0.92,
                content="Drainage canal and flood control rehabilitation project details.",
                theme_tags=["infrastructure"],
            ),
            _row(
                chunk_id="c2",
                similarity=0.40,
                content="Unrelated administrative supply purchase.",
                theme_tags=["operations"],
            ),
        ]
    )

    bundle = retrieve_dense_docs_bundle(
        supabase=supabase,
        embeddings_model="text-embedding-3-large",
        question="What does the AIP say about drainage rehabilitation?",
        k=5,
        min_similarity=0.0,
        retrieval_scope={"mode": "global", "targets": []},
        retrieval_mode="qa",
        retrieval_filters={"fiscal_year": 2025, "scope_type": "barangay", "scope_name": "Mamatid", "theme_tags": ["drainage"]},
    )

    docs = bundle["docs"]
    diagnostics = bundle["diagnostics"]
    assert docs[0].metadata["chunk_id"] == "c1"
    assert diagnostics["theme_boost_usage"]["count"] == 0
    assert diagnostics["candidate_counts"]["after_hard_filters"] == 2


def test_scope_mismatch_remains_hard_filter(monkeypatch) -> None:
    _patch_langchain(monkeypatch)
    supabase = _FakeSupabase(
        rows=[
            _row(
                chunk_id="c1",
                similarity=0.95,
                content="High-confidence drainage project details.",
                scope_name="Pulo",
                theme_tags=["drainage"],
            )
        ]
    )

    bundle = retrieve_dense_docs_bundle(
        supabase=supabase,
        embeddings_model="text-embedding-3-large",
        question="Drainage projects in Mamatid",
        k=5,
        min_similarity=0.0,
        retrieval_scope={"mode": "global", "targets": []},
        retrieval_mode="qa",
        retrieval_filters={"fiscal_year": 2025, "scope_type": "barangay", "scope_name": "Mamatid", "theme_tags": ["drainage"]},
    )

    diagnostics = bundle["diagnostics"]
    assert bundle["docs"] == []
    assert diagnostics["candidate_counts"]["raw"] == 1
    assert diagnostics["candidate_counts"]["after_hard_filters"] == 0


def test_single_pass_no_evidence_preserves_refusal_and_logs(monkeypatch) -> None:
    _patch_langchain(monkeypatch)
    events: list[tuple[str, dict]] = []

    fake_supabase = _FakeSupabase(rows=[])
    monkeypatch.setitem(
        sys.modules,
        "supabase.client",
        types.SimpleNamespace(create_client=lambda *_args, **_kwargs: fake_supabase),
    )
    monkeypatch.setattr(
        "openaip_pipeline.services.rag.rag._trace_log",
        lambda event, **fields: events.append((event, fields)),
    )

    result = answer_with_rag(
        supabase_url="https://example.test",
        supabase_service_key="service-key",
        openai_api_key="openai-key",
        embeddings_model="text-embedding-3-large",
        chat_model="gpt-5.2",
        question="What are the drainage allocations?",
        retrieval_scope={"mode": "global", "targets": []},
        retrieval_filters={"fiscal_year": 2025, "scope_type": "barangay", "scope_name": "Mamatid", "theme_tags": ["drainage"]},
        top_k=5,
        min_similarity=0.1,
    )

    assert result["refused"] is True
    assert result["retrieval_meta"]["reason"] == "insufficient_evidence"
    assert fake_supabase.calls and len(fake_supabase.calls) == 1
    assert result["retrieval_meta"]["hard_filters_applied"]["scope_name"] == "Mamatid"
    assert "theme_tags" in result["retrieval_meta"]["soft_preferences"]
    assert "candidate_counts" in result["retrieval_meta"]
    assert result["retrieval_meta"]["theme_boost_usage"]["count"] == 0

    retrieval_completed = [fields for event, fields in events if event == "retrieval_completed"]
    retrieval_refusal = [fields for event, fields in events if event == "retrieval_refusal"]
    assert retrieval_completed
    assert retrieval_refusal
    assert retrieval_refusal[0]["reason"] == "insufficient_evidence"
