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

  it("detects compare-years intent for this year vs last year phrasing", () => {
    const result = detectAggregationIntent(
      "Compare infrastructure spending this year and last year."
    );
    expect(result.intent).toBe("compare_years");
    expect(result.yearA).toBeTypeOf("number");
    expect(result.yearB).toBeTypeOf("number");
    expect((result.yearA ?? 0) - (result.yearB ?? 0)).toBe(1);
  });

  it("detects compare-years intent for explicit year plus last year", () => {
    const result = detectAggregationIntent("Compare FY 2026 with last year.");
    expect(result.intent).toBe("compare_years");
    expect(result.yearA).toBe(2026);
    expect(result.yearB).toBe(2025);
  });

  it("detects top aggregation for singular project wording", () => {
    const result = detectAggregationIntent("Top project of Pulo");
    expect(result.intent).toBe("top_projects");
    expect(result.limit).toBe(10);
  });

  it("does not classify fund-source enumeration question as aggregation", () => {
    const result = detectAggregationIntent("List fund sources for Barangay Mamatid.");
    expect(result.intent).toBe("none");
  });

  it("detects sector totals aggregation for lowest allocated budget phrasing", () => {
    const result = detectAggregationIntent("sector that have lowest allocated budget");
    expect(result.intent).toBe("totals_by_sector");
  });
});
