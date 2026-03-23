from openaip_pipeline.services.validation.rules_engine import list_rule_ids, load_rules


def test_rules_engine_barangay() -> None:
    payload = load_rules("barangay")
    assert payload["version"] == "v1.0.0"
    assert list_rule_ids("barangay") == ["R001", "R002", "R003", "R004", "R005", "R006"]


def test_rules_engine_city() -> None:
    payload = load_rules("city")
    assert payload["version"] == "v1.0.0"
    assert list_rule_ids("city") == ["R001", "R002", "R003", "R004", "R005", "R006", "R007", "R008"]
