from __future__ import annotations

import sys
import types

from openaip_pipeline.services.rag.rag import (
    answer_with_rag,
    evaluate_borderline_semantic_evidence,
    evaluate_evidence_gate,
)


class _FakeDoc:
    def __init__(
        self,
        *,
        chunk_id: str,
        similarity: float,
        content: str,
        fiscal_year: int = 2026,
        channels: list[str] | None = None,
    ) -> None:
        self.page_content = content
        self.metadata = {
            "source_id": chunk_id,
            "chunk_id": chunk_id,
            "aip_id": "aip-1",
            "fiscal_year": fiscal_year,
            "scope_type": "barangay",
            "scope_id": "brgy-1",
            "scope_name": "Mamatid",
            "similarity": similarity,
            "retrieval_channels": channels or ["dense"],
            "metadata": {"section": "s1"},
        }


def test_evidence_gate_allows_strong_final_evidence() -> None:
    docs = [
        _FakeDoc(
            chunk_id="c1",
            similarity=0.92,
            content="Health expenditures for FY 2024 and FY 2025 are listed here.",
            fiscal_year=2025,
            channels=["dense", "keyword"],
        ),
        _FakeDoc(
            chunk_id="c2",
            similarity=0.89,
            content="Health sector allocations and line item details.",
            fiscal_year=2025,
            channels=["dense"],
        ),
    ]
    gate = evaluate_evidence_gate(question="What are the health expenditures in 2025?", selected_docs=docs)
    assert gate["decision"] == "allow"


def test_evidence_gate_clarifies_when_final_docs_too_few() -> None:
    docs = [
        _FakeDoc(
            chunk_id="c1",
            similarity=0.81,
            content="Single weakly relevant chunk.",
        )
    ]
    gate = evaluate_evidence_gate(question="Explain this project", selected_docs=docs)
    assert gate["decision"] == "clarify"


def test_evidence_gate_refuses_no_evidence() -> None:
    gate = evaluate_evidence_gate(question="Explain this project", selected_docs=[])
    assert gate["decision"] == "refuse"


def test_evidence_gate_refuses_year_mismatch() -> None:
    docs = [
        _FakeDoc(
            chunk_id="c1",
            similarity=0.9,
            content="FY 2024 only details.",
            fiscal_year=2024,
            channels=["dense", "keyword"],
        ),
        _FakeDoc(
            chunk_id="c2",
            similarity=0.85,
            content="More FY 2024 details.",
            fiscal_year=2024,
            channels=["dense"],
        ),
    ]
    gate = evaluate_evidence_gate(question="What happened in 2025?", selected_docs=docs)
    assert gate["decision"] == "refuse"


def test_borderline_evidence_never_triggers_when_selected_docs_empty() -> None:
    evaluation = evaluate_borderline_semantic_evidence(
        question="What does the AIP say about road maintenance in Pulo?",
        selected_docs=[],
    )
    assert evaluation["is_borderline"] is False
    assert evaluation["reason_code"] == "no_selected_docs"
    assert evaluation["metrics"]["selected_doc_count"] == 0


def test_answer_with_rag_zero_selected_docs_always_refuses(monkeypatch) -> None:
    monkeypatch.setenv("RAG_PARTIAL_MODE_ENABLED", "true")
    monkeypatch.setenv("RAG_BORDERLINE_PARTIAL_ENABLED", "true")
    monkeypatch.setenv("RAG_EVIDENCE_GATE_ENABLED", "false")

    fake_supabase_client_module = types.SimpleNamespace(create_client=lambda *_args, **_kwargs: object())
    fake_langchain_openai_module = types.SimpleNamespace(ChatOpenAI=object)
    monkeypatch.setitem(sys.modules, "supabase.client", fake_supabase_client_module)
    monkeypatch.setitem(sys.modules, "langchain_openai", fake_langchain_openai_module)

    monkeypatch.setattr(
        "openaip_pipeline.services.rag.rag.run_hybrid_retrieval",
        lambda **_kwargs: {
            "hybrid_enabled": False,
            "keyword_enabled": False,
            "rrf_enabled": False,
            "dense_docs": [],
            "keyword_docs": [],
            "fused_docs": [],
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

    assert result["refused"] is True
    assert result["retrieval_meta"]["reason"] == "insufficient_evidence"
    assert result["retrieval_meta"]["selected_count"] == 0
    assert result["retrieval_meta"]["response_mode_source"] == "pipeline_refusal"


def test_answer_with_rag_borderline_verifier_fail_downgrades_to_partial_when_enabled(
    monkeypatch,
) -> None:
    monkeypatch.setenv("RAG_BORDERLINE_PARTIAL_ENABLED", "true")
    monkeypatch.setenv("RAG_PARTIAL_MODE_ENABLED", "false")
    monkeypatch.setenv("RAG_EVIDENCE_GATE_ENABLED", "false")
    monkeypatch.setenv("RAG_BORDERLINE_EXPLICIT_MATCH_MIN", "0.20")

    fake_supabase_client_module = types.SimpleNamespace(create_client=lambda *_args, **_kwargs: object())
    monkeypatch.setitem(sys.modules, "supabase.client", fake_supabase_client_module)

    class _FakeChatOpenAI:
        def __init__(self, *args, **kwargs):  # noqa: D401, ANN001, ANN003
            self.calls = 0

        def invoke(self, _messages):  # noqa: ANN001
            self.calls += 1
            if self.calls == 1:
                return types.SimpleNamespace(
                    content='{"answer":"The AIP mentions infrastructure works [c1].","used_source_ids":["c1"]}'
                )
            return types.SimpleNamespace(content='{"supported":false,"issues":["needs explicit match"]}')

    monkeypatch.setitem(sys.modules, "langchain_openai", types.SimpleNamespace(ChatOpenAI=_FakeChatOpenAI))

    docs = [
        _FakeDoc(
            chunk_id="c1",
            similarity=0.76,
            content=(
                "Infrastructure category includes rehabilitation of drainages and canal works "
                "for fiscal year 2026 in Barangay Pulo."
            ),
            fiscal_year=2026,
            channels=["dense"],
        )
    ]

    monkeypatch.setattr(
        "openaip_pipeline.services.rag.rag.run_hybrid_retrieval",
        lambda **_kwargs: {
            "hybrid_enabled": True,
            "keyword_enabled": False,
            "rrf_enabled": False,
            "dense_docs": docs,
            "keyword_docs": [],
            "fused_docs": docs,
            "strong_docs": docs,
        },
    )
    monkeypatch.setattr("openaip_pipeline.services.rag.rag._select_diverse_docs", lambda docs, **_kwargs: docs)

    result = answer_with_rag(
        supabase_url="https://example.test",
        supabase_service_key="service-key",
        openai_api_key="openai-key",
        embeddings_model="text-embedding-3-large",
        chat_model="gpt-5.2",
        question="What does the AIP say about road maintenance projects in Barangay Pulo FY 2026?",
        retrieval_scope={"mode": "global", "targets": []},
        top_k=8,
        min_similarity=0.3,
    )

    assert result["refused"] is False
    assert result["retrieval_meta"]["reason"] == "partial_evidence"
    assert result["retrieval_meta"]["response_mode_source"] == "pipeline_partial"
    assert result["retrieval_meta"]["borderline_detected"] is True
    assert result["retrieval_meta"]["borderline_reason_code"] == "borderline_no_explicit_match"


def test_answer_with_rag_skips_generation_when_gate_blocks(monkeypatch) -> None:
    monkeypatch.setenv("RAG_HYBRID_RETRIEVAL_ENABLED", "true")
    monkeypatch.setenv("RAG_EVIDENCE_GATE_ENABLED", "true")
    monkeypatch.setenv("RAG_GATE_MIN_FINAL_DOCS", "2")

    fake_supabase_client_module = types.SimpleNamespace(create_client=lambda *_args, **_kwargs: object())

    class _ForbiddenChatOpenAI:
        def __init__(self, *args, **kwargs):  # noqa: D401, ANN001, ANN003
            raise AssertionError("Generation should be skipped by evidence gate")

    fake_langchain_openai_module = types.SimpleNamespace(ChatOpenAI=_ForbiddenChatOpenAI)
    monkeypatch.setitem(sys.modules, "supabase.client", fake_supabase_client_module)
    monkeypatch.setitem(sys.modules, "langchain_openai", fake_langchain_openai_module)

    def fake_run_hybrid_retrieval(**_kwargs):
        docs = [
            _FakeDoc(
                chunk_id="c1",
                similarity=0.72,
                content="Only one partial match document.",
                channels=["dense"],
            )
        ]
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
    monkeypatch.setattr(
        "openaip_pipeline.services.rag.rag._select_diverse_docs",
        lambda docs, **_kwargs: docs,
    )

    result = answer_with_rag(
        supabase_url="https://example.test",
        supabase_service_key="service-key",
        openai_api_key="openai-key",
        embeddings_model="text-embedding-3-large",
        chat_model="gpt-5.2",
        question="What does this say?",
        retrieval_scope={"mode": "global", "targets": []},
        top_k=8,
        min_similarity=0.3,
    )

    assert result["retrieval_meta"]["evidence_gate_decision"] == "clarify"
    assert result["retrieval_meta"]["evidence_gate_reason_code"] == "clarify_partial_evidence"
    assert result["retrieval_meta"]["generation_skipped_by_gate"] is True
