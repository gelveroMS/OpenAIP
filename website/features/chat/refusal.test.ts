import { describe, expect, it } from "vitest";
import { buildRefusalMessage } from "@/lib/chat/refusal";

describe("refusal helper", () => {
  it("classifies document limitation for contractor/procurement fields", () => {
    const contractor = buildRefusalMessage({
      intent: "unanswerable_field",
      queryText: "Who are the contractors for Road Concreting?",
      docLimitField: "contractor",
    });
    expect(contractor.status).toBe("refusal");
    expect(contractor.reason).toBe("document_limitation");
    expect(contractor.message).toContain("does not list contractors, suppliers, or winning bidders");

    const procurement = buildRefusalMessage({
      intent: "unanswerable_field",
      queryText: "What is the procurement mode for Road Concreting?",
      docLimitField: "procurement_mode",
    });
    expect(procurement.status).toBe("refusal");
    expect(procurement.reason).toBe("document_limitation");
    expect(procurement.message).toContain("procurement mode");
  });

  it("classifies retrieval failure with scope/year context and Ref suggestion", () => {
    const response = buildRefusalMessage({
      intent: "line_item_fact",
      queryText: "How much is allocated for SomeNonexistentProject FY 2026?",
      fiscalYear: 2026,
      scopeLabel: "Barangay Mamatid",
      hadVectorSearch: true,
      foundCandidates: 0,
    });

    expect(response.status).toBe("refusal");
    expect(response.reason).toBe("retrieval_failure");
    expect(response.message).toContain("for Barangay Mamatid");
    expect(response.message).toContain("for FY 2026");
    expect(
      response.suggestions.some((entry) => entry.toLowerCase().includes("ref code"))
    ).toBe(true);
  });

  it("returns clarification for missing fiscal year parameter", () => {
    const response = buildRefusalMessage({
      intent: "totals",
      queryText: "What is the total investment program?",
      missingParam: "fiscal_year",
    });

    expect(response.status).toBe("clarification");
    expect(response.reason).toBe("missing_required_parameter");
    expect(response.message).toContain("Which fiscal year should I use");
  });

  it("classifies inflated-budget opinion ask as unsupported_request", () => {
    const response = buildRefusalMessage({
      intent: "pipeline_fallback",
      queryText: "Do you think Pulo's FY 2026 AIP has inflated budgets?",
    });

    expect(response.status).toBe("refusal");
    expect(response.reason).toBe("unsupported_request");
    expect(response.message).toContain("I can only answer based on published AIP data");
  });
});
