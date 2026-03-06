from __future__ import annotations

from openaip_pipeline.services.rag.rag import _select_diverse_docs


class _FakeDoc:
    def __init__(
        self,
        *,
        chunk_id: str,
        similarity: float,
        section: str,
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
            "metadata": {"section": section},
        }


def test_reduces_redundant_repeated_chunks() -> None:
    docs = [
        _FakeDoc(
            chunk_id="c1",
            similarity=0.91,
            section="s1",
            content="Drainage rehabilitation project with major canal clearing.",
        ),
        _FakeDoc(
            chunk_id="c2",
            similarity=0.90,
            section="s1",
            content="Drainage rehabilitation project with major canal clearing.",
        ),
        _FakeDoc(
            chunk_id="c3",
            similarity=0.89,
            section="s1",
            content="Drainage rehabilitation project with major canal clearing.",
        ),
        _FakeDoc(
            chunk_id="c4",
            similarity=0.83,
            section="s2",
            content="Health center renovation project and service upgrades.",
        ),
    ]

    selected = _select_diverse_docs(docs, max_docs=6, min_docs=4)
    assert len(selected) <= 6
    # Near-duplicate entries should be reduced to a single representative.
    assert any(doc.metadata["chunk_id"] == "c1" for doc in selected)
    assert sum(1 for doc in selected if "canal clearing" in doc.page_content) == 1


def test_caps_context_to_six_and_preserves_top_chunk() -> None:
    docs = [
        _FakeDoc(
            chunk_id=f"c{index}",
            similarity=0.99 - (index * 0.02),
            section=f"section-{index % 4}",
            content=f"Content block {index} with distinct wording {index * 7}.",
        )
        for index in range(12)
    ]

    selected = _select_diverse_docs(docs, max_docs=6, min_docs=4)
    assert 4 <= len(selected) <= 6
    assert selected[0].metadata["chunk_id"] == "c0"


def test_prefers_diverse_sections_when_relevance_is_close() -> None:
    docs = [
        _FakeDoc(
            chunk_id="c1",
            similarity=0.92,
            section="infrastructure",
            content="Infrastructure section item one with road concreting details.",
        ),
        _FakeDoc(
            chunk_id="c2",
            similarity=0.91,
            section="infrastructure",
            content="Infrastructure section item two with road widening details.",
        ),
        _FakeDoc(
            chunk_id="c3",
            similarity=0.90,
            section="infrastructure",
            content="Infrastructure section item three with bridge repair details.",
        ),
        _FakeDoc(
            chunk_id="c4",
            similarity=0.89,
            section="health",
            content="Health section item with barangay clinic and medicine support.",
        ),
        _FakeDoc(
            chunk_id="c5",
            similarity=0.88,
            section="governance",
            content="Governance section item with barangay service digitization.",
        ),
    ]

    selected = _select_diverse_docs(docs, max_docs=4, min_docs=4)
    sections = {doc.metadata["metadata"]["section"] for doc in selected}
    assert "health" in sections
