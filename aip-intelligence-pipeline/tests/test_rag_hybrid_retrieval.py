from __future__ import annotations

import sys
import types

from openaip_pipeline.services.rag.rag import run_hybrid_retrieval
from openaip_pipeline.services.rag.retriever import fuse_docs_rrf


class _FakeDocument:
    def __init__(self, *, page_content: str, metadata: dict):
        self.page_content = page_content
        self.metadata = metadata


sys.modules.setdefault(
    "langchain_core.documents",
    types.SimpleNamespace(Document=_FakeDocument),
)


class _FakeDoc:
    def __init__(
        self,
        *,
        chunk_id: str,
        channel: str,
        similarity: float,
        content: str,
    ) -> None:
        self.page_content = content
        self.metadata = {
            "source_id": chunk_id,
            "chunk_id": chunk_id,
            "aip_id": "aip-1",
            "fiscal_year": 2026,
            "scope_type": "barangay",
            "scope_id": "brgy-1",
            "scope_name": "Mamatid",
            "similarity": similarity,
            "retrieval_channels": [channel],
            "metadata": {"section": "s1"},
        }


def _chunk_ids(docs: list[_FakeDoc]) -> list[str]:
    return [str(doc.metadata.get("chunk_id")) for doc in docs]


def test_rrf_merges_duplicate_chunk_ids() -> None:
    dense_docs = [
        _FakeDoc(
            chunk_id="c1",
            channel="dense",
            similarity=0.93,
            content="Drainage rehabilitation details.",
        ),
        _FakeDoc(
            chunk_id="c2",
            channel="dense",
            similarity=0.90,
            content="Health center maintenance details.",
        ),
    ]
    keyword_docs = [
        _FakeDoc(
            chunk_id="c1",
            channel="keyword",
            similarity=0.88,
            content="Drainage rehabilitation details.",
        ),
        _FakeDoc(
            chunk_id="c3",
            channel="keyword",
            similarity=0.87,
            content="Daycare renovation references.",
        ),
    ]

    fused = fuse_docs_rrf(dense_docs=dense_docs, keyword_docs=keyword_docs, rrf_k=60, max_candidates=10)
    assert _chunk_ids(fused).count("c1") == 1
    assert "c3" in _chunk_ids(fused)
    assert "dense" in (fused[0].metadata.get("retrieval_channels") or [])
    assert "keyword" in (fused[0].metadata.get("retrieval_channels") or [])


def test_rrf_deterministic_ordering() -> None:
    dense_docs = [
        _FakeDoc(chunk_id="a", channel="dense", similarity=0.9, content="A"),
        _FakeDoc(chunk_id="b", channel="dense", similarity=0.8, content="B"),
    ]
    keyword_docs = [
        _FakeDoc(chunk_id="b", channel="keyword", similarity=0.9, content="B"),
        _FakeDoc(chunk_id="c", channel="keyword", similarity=0.8, content="C"),
    ]

    first = fuse_docs_rrf(dense_docs=dense_docs, keyword_docs=keyword_docs, rrf_k=60, max_candidates=10)
    second = fuse_docs_rrf(dense_docs=dense_docs, keyword_docs=keyword_docs, rrf_k=60, max_candidates=10)
    assert _chunk_ids(first) == _chunk_ids(second)


def test_run_hybrid_retrieval_calls_dense_and_keyword_with_scope(monkeypatch) -> None:
    monkeypatch.setenv("RAG_HYBRID_RETRIEVAL_ENABLED", "true")
    monkeypatch.setenv("RAG_KEYWORD_RETRIEVAL_ENABLED", "true")
    monkeypatch.setenv("RAG_RRF_FUSION_ENABLED", "true")
    monkeypatch.setenv("RAG_HYBRID_DENSE_K", "20")
    monkeypatch.setenv("RAG_HYBRID_KEYWORD_K", "20")

    calls: list[tuple[str, dict]] = []

    dense_docs = [
        _FakeDoc(
            chunk_id="dense-1",
            channel="dense",
            similarity=0.88,
            content="Paraphrased flood-control activity details.",
        )
    ]
    keyword_docs = [
        _FakeDoc(
            chunk_id="kw-1",
            channel="keyword",
            similarity=0.82,
            content="DRAINAGE REHABILITATION exact phrase hit.",
        )
    ]

    def fake_dense(**kwargs):
        calls.append(("dense", kwargs))
        return dense_docs

    def fake_keyword(**kwargs):
        calls.append(("keyword", kwargs))
        return keyword_docs

    monkeypatch.setattr("openaip_pipeline.services.rag.rag.retrieve_dense_docs", fake_dense)
    monkeypatch.setattr("openaip_pipeline.services.rag.rag.retrieve_keyword_docs", fake_keyword)

    scope = {
        "mode": "named_scopes",
        "targets": [
            {"scope_type": "barangay", "scope_id": "brgy-1", "scope_name": "Mamatid"},
        ],
    }

    bundle = run_hybrid_retrieval(
        supabase=object(),
        embeddings_model="text-embedding-3-large",
        question="What does the AIP say about drainage rehabilitation?",
        retrieval_scope=scope,
        top_k=8,
        min_similarity=0.3,
    )

    assert [name for name, _ in calls] == ["dense", "keyword"]
    assert calls[0][1]["retrieval_scope"] == scope
    assert calls[1][1]["retrieval_scope"] == scope
    assert len(bundle["fused_docs"]) >= 2
    channels = set()
    for doc in bundle["fused_docs"]:
        channels.update(doc.metadata.get("retrieval_channels") or [])
    assert "dense" in channels
    assert "keyword" in channels
