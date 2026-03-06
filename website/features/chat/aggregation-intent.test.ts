import { describe, expect, it } from "vitest";
import { detectAggregationIntent } from "@/lib/chat/aggregation-intent";

describe("aggregation intent detection", () => {
  it("detects sector totals aggregation", () => {
    const result = detectAggregationIntent("Show budget totals by sector for FY 2026");
    expect(result.intent).toBe("totals_by_sector");
  });

  it("does not classify sector enumeration question as aggregation", () => {
    const result = detectAggregationIntent("What sectors exist in the AIP?");
    expect(result.intent).toBe("none");
  });

  it("detects fund-source aggregation for comparison query", () => {
    const result = detectAggregationIntent("How much is funded by loans vs general fund in FY 2026?");
    expect(result.intent).toBe("totals_by_fund_source");
  });

  it("does not classify fund-source enumeration question as aggregation", () => {
    const result = detectAggregationIntent("List fund sources for Barangay Mamatid.");
    expect(result.intent).toBe("none");
  });
});
