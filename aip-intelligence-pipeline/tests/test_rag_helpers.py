from openaip_pipeline.services.rag.rag import (
    _extract_json,
    _extract_source_ids,
    build_retrieval_query,
)


def test_extract_source_ids_dedupes_and_orders():
    answer = "Budget is concentrated on health [S2] and infra [S1]. Health remains highest [S2]."
    assert _extract_source_ids(answer) == ["S2", "S1"]


def test_extract_json_accepts_wrapped_payload():
    text = "Model output:\n```json\n{\"answer\":\"ok\",\"used_source_ids\":[\"S1\"]}\n```"
    parsed = _extract_json(text)
    assert parsed is not None
    assert parsed["answer"] == "ok"


def test_build_retrieval_query_appends_broad_hint_without_entities() -> None:
    question = "What projects are in FY 2025?"
    query = build_retrieval_query(question=question, entities={})
    assert question in query
    assert "Structured hints:" in query
    assert "retrieve broad AIP project matches" in query


def test_build_retrieval_query_appends_structured_hints() -> None:
    query = build_retrieval_query(
        question="Show projects",
        entities={
            "barangay": "Mamatid",
            "fiscal_year": 2025,
            "sector": "Health",
            "topic": "drainage",
        },
    )

    assert "Structured hints:" in query
    assert "barangay: Mamatid" in query
    assert "fiscal year: 2025" in query
    assert "sector: Health" in query
    assert "retrieve broad AIP project matches" in query
