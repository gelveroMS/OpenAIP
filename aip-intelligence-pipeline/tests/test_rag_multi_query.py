from __future__ import annotations

import types
import sys

from openaip_pipeline.services.rag.multi_query import (
    build_multi_query_variants,
    merge_multi_query_candidates,
    should_retry_multi_query,
)
from openaip_pipeline.services.rag.rag import answer_with_rag


class _FakeDoc:
    def __init__(
        self,
        *,
        chunk_id: str,
        similarity: float,
        content: str,
        channels: list[str] | None = None,
    ) -> None:
        self.page_content = content
        self.metadata = {
            "source_id": chunk_id,
            "chunk_id": chunk_id,
            "aip_id": "aip-1",
            "fiscal_year": 2025,
            "scope_type": "barangay",
            "scope_id": "brgy-1",
            "scope_name": "Mamatid",
            "similarity": similarity,
            "retrieval_channels": channels or ["dense"],
            "metadata": {"section": "s1"},
        }


def test_build_multi_query_variants_bounded_and_distinct() -> None:
    variants = build_multi_query_variants(
        question="Show top projects in 2025 and explain them with citations.",
        max_variants=3,
    )
    assert len(variants) <= 3
    assert len(set(value.lower() for value in variants)) == len(variants)
    assert all("show top projects in 2025 and explain them with citations" != value.lower() for value in variants)


def test_should_retry_multi_query_only_for_retryable_cases() -> None:
    assert should_retry_multi_query(gate_decision="clarify", gate_reason="insufficient_final_candidates")[0] is True
    assert should_retry_multi_query(gate_decision="clarify", gate_reason="weak_topic_overlap")[0] is True
    assert should_retry_multi_query(gate_decision="refuse", gate_reason="explicit_year_not_found")[0] is False
    assert should_retry_multi_query(gate_decision="allow", gate_reason="sufficient_final_evidence")[0] is False


def test_merge_multi_query_candidates_dedupes_by_chunk_id() -> None:
    base_docs = [
        _FakeDoc(chunk_id="c1", similarity=0.8, content="Drainage"),
        _FakeDoc(chunk_id="c2", similarity=0.7, content="Daycare"),
    ]
    variant_docs = [
        _FakeDoc(chunk_id="c1", similarity=0.85, content="Drainage"),
        _FakeDoc(chunk_id="c3", similarity=0.75, content="Road widening"),
    ]
    merged = merge_multi_query_candidates(
        base_docs=base_docs,
        variant_docs=variant_docs,
        max_candidates=10,
    )
    chunk_ids = [str(doc.metadata.get("chunk_id")) for doc in merged]
    assert chunk_ids.count("c1") == 1
    assert "c3" in chunk_ids


def test_answer_with_rag_triggers_selective_multi_query(monkeypatch) -> None:
    monkeypatch.setenv("RAG_HYBRID_RETRIEVAL_ENABLED", "true")
    monkeypatch.setenv("RAG_EVIDENCE_GATE_ENABLED", "true")
    monkeypatch.setenv("RAG_SELECTIVE_MULTI_QUERY_ENABLED", "true")
    monkeypatch.setenv("RAG_GATE_MIN_FINAL_DOCS", "2")
    monkeypatch.setenv("RAG_SELECTIVE_MULTI_QUERY_MAX_VARIANTS", "2")

    fake_supabase_client_module = types.SimpleNamespace(create_client=lambda *_args, **_kwargs: object())
    monkeypatch.setitem(sys.modules, "supabase.client", fake_supabase_client_module)
    monkeypatch.setitem(
        sys.modules,
        "langchain_openai",
        types.SimpleNamespace(
            ChatOpenAI=type(
                "FakeChatOpenAI",
                (),
                {"__init__": lambda self, *args, **kwargs: None, "invoke": lambda self, _messages: None},
            )
        ),
    )

    calls: list[str] = []
    base_docs = [_FakeDoc(chunk_id="base-1", similarity=0.72, content="One weak chunk.", channels=["dense"])]

    def fake_run_hybrid_retrieval(**kwargs):
        question = str(kwargs.get("question") or "")
        calls.append(question)
        if question == "Explain the drainage project with citations.":
            docs = base_docs
        else:
            docs = [_FakeDoc(chunk_id=f"variant-{len(calls)}", similarity=0.71, content="Another weak chunk.")]
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
        lambda docs, **_kwargs: docs[:6],
    )

    result = answer_with_rag(
        supabase_url="https://example.test",
        supabase_service_key="service-key",
        openai_api_key="openai-key",
        embeddings_model="text-embedding-3-large",
        chat_model="gpt-5.2",
        question="Explain the drainage project with citations.",
        retrieval_scope={"mode": "global", "targets": []},
        top_k=8,
        min_similarity=0.3,
    )

    assert len(calls) > 1
    assert result["retrieval_meta"]["multi_query_triggered"] is True
    assert result["retrieval_meta"]["multi_query_variant_count"] >= 1
    assert result["retrieval_meta"]["multi_query_reason_code"] == "retry_low_confidence"
    if result["retrieval_meta"]["evidence_gate_decision"] != "allow":
        assert result["retrieval_meta"]["generation_skipped_by_gate"] is True
