from __future__ import annotations

import sys
import types

from openaip_pipeline.services.rag.rag import answer_with_rag


class _FakeDoc:
    def __init__(self, *, chunk_id: str, similarity: float, content: str) -> None:
        self.page_content = content
        self.metadata = {
            "source_id": chunk_id.upper(),
            "chunk_id": chunk_id,
            "aip_id": "aip-1",
            "fiscal_year": 2025,
            "scope_type": "barangay",
            "scope_id": "brgy-1",
            "scope_name": "Mamatid",
            "similarity": similarity,
            "retrieval_channels": ["dense", "keyword"],
            "metadata": {"section": "s1"},
        }


def test_high_confidence_semantic_path_does_not_trigger_multi_query(monkeypatch) -> None:
    monkeypatch.setenv("RAG_HYBRID_RETRIEVAL_ENABLED", "true")
    monkeypatch.setenv("RAG_EVIDENCE_GATE_ENABLED", "true")
    monkeypatch.setenv("RAG_SELECTIVE_MULTI_QUERY_ENABLED", "true")
    monkeypatch.setenv("RAG_GATE_MIN_FINAL_DOCS", "2")

    fake_supabase_client_module = types.SimpleNamespace(create_client=lambda *_args, **_kwargs: object())
    monkeypatch.setitem(sys.modules, "supabase.client", fake_supabase_client_module)

    class _FakeChatOpenAI:
        def __init__(self, *args, **kwargs):  # noqa: D401, ANN001, ANN003
            self._calls = 0

        def invoke(self, _messages):  # noqa: ANN001
            self._calls += 1
            if self._calls == 1:
                return types.SimpleNamespace(
                    content='{"answer":"Drainage rehabilitation details [S1].","used_source_ids":["S1"]}'
                )
            return types.SimpleNamespace(content='{"supported":true,"issues":[]}')

    fake_langchain_openai_module = types.SimpleNamespace(ChatOpenAI=_FakeChatOpenAI)
    monkeypatch.setitem(sys.modules, "langchain_openai", fake_langchain_openai_module)

    docs = [
        _FakeDoc(
            chunk_id="s1",
            similarity=0.93,
            content="Drainage rehabilitation project details for FY 2025.",
        ),
        _FakeDoc(
            chunk_id="s2",
            similarity=0.9,
            content="Supporting context for the same drainage initiative.",
        ),
    ]

    calls: list[str] = []

    def fake_run_hybrid_retrieval(**kwargs):
        calls.append(str(kwargs.get("question") or ""))
        return {
            "hybrid_enabled": True,
            "keyword_enabled": True,
            "rrf_enabled": True,
            "dense_docs": docs,
            "keyword_docs": [],
            "fused_docs": docs,
            "strong_docs": docs,
        }

    monkeypatch.setattr("openaip_pipeline.services.rag.rag.run_hybrid_retrieval", fake_run_hybrid_retrieval)
    monkeypatch.setattr(
        "openaip_pipeline.services.rag.rag._select_diverse_docs",
        lambda current_docs, **_kwargs: current_docs,
    )

    result = answer_with_rag(
        supabase_url="https://example.test",
        supabase_service_key="service-key",
        openai_api_key="openai-key",
        embeddings_model="text-embedding-3-large",
        chat_model="gpt-5.2",
        question="What does the AIP say about drainage rehabilitation?",
        retrieval_scope={"mode": "global", "targets": []},
        top_k=8,
        min_similarity=0.3,
    )

    assert len(calls) == 1
    assert result["retrieval_meta"]["reason"] == "ok"
    assert result["retrieval_meta"].get("multi_query_triggered") is False
