import { describe, expect, it } from "vitest";
import { decideRoute } from "@/lib/chat/router-decision";

describe("router decision", () => {
  it("selects SQL totals for total investment asks", () => {
    const decision = decideRoute({
      text: "What is the total investment program for FY 2026 in Barangay Pulo?",
      intentClassification: null,
    });

    expect(decision.kind).toBe("SQL_TOTAL");
    expect(decision.confidence).toBeGreaterThan(0.9);
  });

  it("selects SQL aggregation for category aggregation asks", () => {
    const decision = decideRoute({
      text: "Show budget totals by fund source for FY 2026 in Barangay Pulo",
      intentClassification: null,
    });

    expect(decision.kind).toBe("SQL_AGG");
  });

  it("selects row lookup for ref-based asks", () => {
    const decision = decideRoute({
      text: "What is allocated for Ref 8000-003-002-006 in FY 2026?",
      intentClassification: null,
    });

    expect(decision.kind).toBe("ROW_LOOKUP");
  });

  it("does not force row lookup for opinionated inflated-budget asks", () => {
    const decision = decideRoute({
      text: "Do you think Pulo's FY 2026 AIP has inflated budgets?",
      intentClassification: null,
    });

    expect(decision.kind).not.toBe("ROW_LOOKUP");
  });

  it("selects SQL metadata for strict metadata enumeration asks", () => {
    const decision = decideRoute({
      text: "What sectors exist in the AIP?",
      intentClassification: null,
    });

    expect(decision.kind).toBe("SQL_METADATA");
  });

  it("selects conversational shortcut when conversational intent has no domain cues", () => {
    const decision = decideRoute({
      text: "hello there",
      intentClassification: {
        intent: "GREETING",
        confidence: 0.95,
        top2_intent: "THANKS",
        top2_confidence: 0.2,
        margin: 0.75,
        method: "semantic",
      },
    });

    expect(decision.kind).toBe("CONVERSATIONAL");
  });

  it("does not let semantic tie-breaker override high-confidence deterministic match", () => {
    const decision = decideRoute({
      text: "What is the total investment program for FY 2026?",
      intentClassification: {
        intent: "LINE_ITEM_LOOKUP",
        confidence: 0.99,
        top2_intent: "TOTAL_AGGREGATION",
        top2_confidence: 0.2,
        margin: 0.79,
        method: "semantic",
      },
    });

    expect(decision.kind).toBe("SQL_TOTAL");
  });
});
