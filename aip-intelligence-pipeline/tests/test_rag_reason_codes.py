from __future__ import annotations

import sys
import types

from openaip_pipeline.services.rag.rag import answer_with_rag


class _FakeDoc:
    def __init__(self, *, chunk_id: str, similarity: float, content: str) -> None:
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
            "retrieval_channels": ["dense"],
            "metadata": {"section": "s1"},
        }


def test_answer_with_rag_emits_reason_codes_and_calibration(monkeypatch) -> None:
    monkeypatch.setenv("RAG_HYBRID_RETRIEVAL_ENABLED", "true")
    monkeypatch.setenv("RAG_EVIDENCE_GATE_ENABLED", "true")
    monkeypatch.setenv("RAG_GATE_MIN_FINAL_DOCS", "2")

    fake_supabase_client_module = types.SimpleNamespace(create_client=lambda *_args, **_kwargs: object())
    monkeypatch.setitem(sys.modules, "supabase.client", fake_supabase_client_module)

    class _ForbiddenChatOpenAI:
        def __init__(self, *args, **kwargs):  # noqa: D401, ANN001, ANN003
            raise AssertionError("Generation should be skipped by evidence gate")

    monkeypatch.setitem(sys.modules, "langchain_openai", types.SimpleNamespace(ChatOpenAI=_ForbiddenChatOpenAI))

    def fake_run_hybrid_retrieval(**_kwargs):
        docs = [_FakeDoc(chunk_id="c1", similarity=0.75, content="Only one weak chunk")]
        return {
            "hybrid_enabled": True,
            "keyword_enabled": False,
            "rrf_enabled": False,
            "dense_docs": docs,
            "keyword_docs": [],
            "fused_docs": docs,
            "strong_docs": docs,
        }

    monkeypatch.setattr("openaip_pipeline.services.rag.rag.run_hybrid_retrieval", fake_run_hybrid_retrieval)
    monkeypatch.setattr("openaip_pipeline.services.rag.rag._select_diverse_docs", lambda docs, **_kwargs: docs)

    result = answer_with_rag(
        supabase_url="https://example.test",
        supabase_service_key="service-key",
        openai_api_key="openai-key",
        embeddings_model="text-embedding-3-large",
        chat_model="gpt-5.2",
        question="Explain this project",
        retrieval_scope={"mode": "global", "targets": []},
        top_k=8,
        min_similarity=0.3,
    )

    meta = result["retrieval_meta"]
    assert meta["evidence_gate_decision"] == "clarify"
    assert meta["evidence_gate_reason_code"] == "clarify_partial_evidence"
    assert isinstance(meta.get("active_rag_flags"), dict)
    assert isinstance(meta.get("rag_calibration"), dict)
    assert isinstance(meta.get("stage_latency_ms"), dict)
    assert "total_ms" in meta["stage_latency_ms"]
