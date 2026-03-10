import { describe, expect, it } from "vitest";
import {
  buildProjectTotalsByAipId,
  parseAipTotalInvestmentProgram,
  resolveAipDisplayTotalsByAipId,
  sumAipDisplayTotals,
} from "@/lib/repos/_shared/aip-totals";

describe("aip display total resolver", () => {
  it("parses numeric and comma-delimited totals safely", () => {
    expect(parseAipTotalInvestmentProgram(1250.5)).toBe(1250.5);
    expect(parseAipTotalInvestmentProgram("1,250.50")).toBe(1250.5);
    expect(parseAipTotalInvestmentProgram("PHP 1,250.50")).toBe(1250.5);
    expect(parseAipTotalInvestmentProgram("bad-value")).toBeNull();
  });

  it("uses file totals first and falls back to project totals", () => {
    const fallbackTotalsByAipId = buildProjectTotalsByAipId([
      { aip_id: "aip-1", total: 1000 },
      { aip_id: "aip-2", total: 500 },
    ]);
    const fileTotalsByAipId = new Map<string, number>([["aip-1", 1200]]);

    const displayTotalsByAipId = resolveAipDisplayTotalsByAipId({
      aipIds: ["aip-1", "aip-2"],
      fileTotalsByAipId,
      fallbackTotalsByAipId,
    });

    expect(displayTotalsByAipId.get("aip-1")).toBe(1200);
    expect(displayTotalsByAipId.get("aip-2")).toBe(500);
  });

  it("uses project totals when they exceed file totals", () => {
    const fallbackTotalsByAipId = buildProjectTotalsByAipId([
      { aip_id: "aip-1", total: 1600 },
    ]);
    const fileTotalsByAipId = new Map<string, number>([["aip-1", 1200]]);

    const displayTotalsByAipId = resolveAipDisplayTotalsByAipId({
      aipIds: ["aip-1"],
      fileTotalsByAipId,
      fallbackTotalsByAipId,
    });

    expect(displayTotalsByAipId.get("aip-1")).toBe(1600);
  });

  it("sums resolved totals for aggregate display", () => {
    const total = sumAipDisplayTotals({
      aipIds: ["aip-1", "aip-2", "aip-3"],
      displayTotalsByAipId: new Map<string, number>([
        ["aip-1", 100],
        ["aip-2", 200],
      ]),
    });

    expect(total).toBe(300);
  });
});
