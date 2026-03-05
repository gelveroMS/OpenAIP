from openaip_pipeline.core.resources import read_json, read_text, read_yaml


def test_resource_loading() -> None:
    manifest = read_yaml("manifests/pipeline_versions.yaml")
    assert "default" in manifest
    rules = read_json("rules/barangay.rules.json")
    assert rules["ruleset_id"] == "barangay"
    summary_prompt = read_text("prompts/summarization/system.txt")
    assert "TABLE-GROUNDED summary" in summary_prompt
    assert "Use ONLY information present in the JSON." in summary_prompt
    assert "Do NOT compute or report the overall TOTAL AIP budget amount." in summary_prompt
    assert "4-6 sentences" in summary_prompt
    assert "Maximum 140 words" in summary_prompt
    assert "Return JSON only" in summary_prompt
    assert '"summary": "string"' in summary_prompt
    summary_reduce_prompt = read_text("prompts/summarization/reduce_system.txt")
    assert "combining chunk-level summaries" in summary_reduce_prompt
    assert "4-6 sentences" in summary_reduce_prompt
    assert "Maximum 140 words" in summary_reduce_prompt
    assert "Return JSON only" in summary_reduce_prompt
    assert '"summary": "string"' in summary_reduce_prompt

    barangay_validation_prompt = read_text("prompts/validation/barangay_system.txt")
    assert "R001" in barangay_validation_prompt
    assert "R002" in barangay_validation_prompt
    assert "R003" in barangay_validation_prompt
    assert "R004" in barangay_validation_prompt
    assert "R005" in barangay_validation_prompt
    assert "Output JSON only" in barangay_validation_prompt
    assert "Do NOT require cc_topology_code" in barangay_validation_prompt

    city_validation_prompt = read_text("prompts/validation/city_system.txt")
    assert "R001" in city_validation_prompt
    assert "R002" in city_validation_prompt
    assert "R003" in city_validation_prompt
    assert "R004" in city_validation_prompt
    assert "R005" in city_validation_prompt
    assert "R006" in city_validation_prompt
    assert "R007" in city_validation_prompt
    assert "R008" in city_validation_prompt
    assert "Output JSON only" in city_validation_prompt
    assert "A###-##" in city_validation_prompt

    barangay_extraction_system_prompt = read_text("prompts/extraction/barangay_system.txt")
    assert "Extract ONLY what is explicitly present in the PDF page." in barangay_extraction_system_prompt
    assert "If missing/unreadable, set null. Do not invent values." in barangay_extraction_system_prompt

    barangay_extraction_user_prompt = read_text("prompts/extraction/barangay_user.txt")
    assert "financial_expenses" in barangay_extraction_user_prompt
    assert (
        "PS -> MOOE -> FINANCIAL EXPENSES (FE) -> CAPITAL OUTLAY (CO) -> TOTAL"
        in barangay_extraction_user_prompt
    )
    assert "errors MUST always be null" not in barangay_extraction_user_prompt
    assert "category MUST always be null" not in barangay_extraction_user_prompt
    assert "return an empty projects array" in barangay_extraction_user_prompt

    city_extraction_system_prompt = read_text("prompts/extraction/city_system.txt")
    assert "Extract ONLY what is explicitly present in the PDF page." in city_extraction_system_prompt
    assert "If missing/unreadable, set null. Do not invent values." in city_extraction_system_prompt

    city_extraction_user_prompt = read_text("prompts/extraction/city_user.txt")
    assert "prm_ncr_lgu_rm_objective_results_indicator" in city_extraction_user_prompt
    assert "PS -> MOOE -> CO -> TOTAL -> CCA -> CCM" in city_extraction_user_prompt
    assert "cc_topology_code" in city_extraction_user_prompt
    assert "errors MUST always be null" not in city_extraction_user_prompt
    assert "category MUST always be null" not in city_extraction_user_prompt

    categorization_prompt = read_text("prompts/categorization/system.txt")
    assert "Annual Investment Plan (AIP) project rows" in categorization_prompt
    assert "Return ONLY structured output matching the schema" in categorization_prompt
    assert "infrastructure" in categorization_prompt
    assert "health" in categorization_prompt
    assert "other" in categorization_prompt
    assert "Choose exactly ONE category per item." in categorization_prompt
