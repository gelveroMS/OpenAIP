from __future__ import annotations

import sys
import types

from openaip_pipeline.services.rag.rag import _build_partial_evidence, answer_with_rag


class _FakeDoc:
    def __init__(self, *, source_id: str, similarity: float, content: str) -> None:
        self.page_content = content
        self.metadata = {
            "source_id": source_id,
            "chunk_id": f"{source_id}-chunk",
            "aip_id": "aip-1",
            "fiscal_year": 2026,
            "scope_type": "barangay",
            "scope_id": "brgy-1",
            "scope_name": "Mamatid",
            "similarity": similarity,
            "metadata": {"page_no": 2},
        }


def test_build_partial_evidence_returns_non_refusal_with_citations() -> None:
    docs = [_FakeDoc(source_id="S1", similarity=0.24, content="Road concreting line item.")]

    result = _build_partial_evidence(
        question="How much was spent on road concreting?",
        reason="partial_evidence",
        docs=docs,
        top_k=8,
        min_similarity=0.3,
        retrieval_scope={"mode": "global", "targets": []},
    )

    assert result["refused"] is False
    assert result["retrieval_meta"]["reason"] == "partial_evidence"
    assert len(result["citations"]) == 1
    assert result["citations"][0]["source_id"] == "S1"


def test_answer_with_rag_returns_partial_evidence_when_enabled(monkeypatch) -> None:
    monkeypatch.setenv("RAG_PARTIAL_MODE_ENABLED", "true")

    fake_supabase_client_module = types.SimpleNamespace(create_client=lambda *_args, **_kwargs: object())
    fake_langchain_openai_module = types.SimpleNamespace(ChatOpenAI=object)
    monkeypatch.setitem(sys.modules, "supabase.client", fake_supabase_client_module)
    monkeypatch.setitem(sys.modules, "langchain_openai", fake_langchain_openai_module)

    docs = [_FakeDoc(source_id="S1", similarity=0.22, content="Limited matching context.")]
    monkeypatch.setattr(
        "openaip_pipeline.services.rag.rag.run_hybrid_retrieval",
        lambda **_kwargs: {
            "hybrid_enabled": False,
            "keyword_enabled": False,
            "rrf_enabled": False,
            "dense_docs": docs,
            "keyword_docs": [],
            "fused_docs": docs,
            "strong_docs": [],
        },
    )

    result = answer_with_rag(
        supabase_url="https://example.test",
        supabase_service_key="service-key",
        openai_api_key="openai-key",
        embeddings_model="text-embedding-3-large",
        chat_model="gpt-5.2",
        question="Explain this budget item",
        retrieval_scope={"mode": "global", "targets": []},
        top_k=8,
        min_similarity=0.3,
    )

    assert result["refused"] is False
    assert result["retrieval_meta"]["reason"] == "partial_evidence"
    assert len(result["citations"]) == 1
