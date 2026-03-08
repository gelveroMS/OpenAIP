import { describe, expect, it } from "vitest";
import type { AipProjectRow } from "@/features/aip/types";
import { buildBudgetAllocationWithOptions } from "./budget-allocation-table";

function makeRow(input: {
  id: string;
  sector: AipProjectRow["sector"];
  amount: number;
}): AipProjectRow {
  return {
    id: input.id,
    aipId: "aip-1",
    aipRefCode: `${input.id}-ref`,
    programProjectDescription: `${input.id} description`,
    implementingAgency: null,
    startDate: null,
    completionDate: null,
    expectedOutput: null,
    sourceOfFunds: null,
    personalServices: null,
    maintenanceAndOtherOperatingExpenses: null,
    financialExpenses: null,
    capitalOutlay: null,
    total: input.amount,
    climateChangeAdaptation: null,
    climateChangeMitigation: null,
    ccTopologyCode: null,
    prmNcrLguRmObjectiveResultsIndicator: null,
    category: "other",
    errors: null,
    projectRefCode: `${input.id}-ref`,
    kind: "other",
    sector: input.sector,
    amount: input.amount,
    reviewStatus: "unreviewed",
    aipDescription: `${input.id} description`,
  };
}

describe("buildBudgetAllocationWithOptions", () => {
  it("uses provided display total as denominator", () => {
    const result = buildBudgetAllocationWithOptions(
      [
        makeRow({ id: "p1", sector: "General Sector", amount: 300 }),
        makeRow({ id: "p2", sector: "Social Sector", amount: 200 }),
      ],
      { displayTotalBudget: 1000 }
    );

    expect(result.totalBudget).toBe(1000);
    expect(result.coveredPercentage).toBe(50);
    expect(result.rows.find((row) => row.category === "General Sector")?.percentage).toBe(30);
    expect(result.rows.find((row) => row.category === "Social Sector")?.percentage).toBe(20);
  });

  it("falls back to project-summed denominator when display total is missing", () => {
    const result = buildBudgetAllocationWithOptions([
      makeRow({ id: "p1", sector: "General Sector", amount: 300 }),
      makeRow({ id: "p2", sector: "Social Sector", amount: 200 }),
    ]);

    expect(result.totalBudget).toBe(500);
    expect(result.coveredPercentage).toBe(100);
    expect(result.rows.find((row) => row.category === "General Sector")?.percentage).toBe(60);
    expect(result.rows.find((row) => row.category === "Social Sector")?.percentage).toBe(40);
  });

  it("uses project-summed denominator when display total is lower", () => {
    const result = buildBudgetAllocationWithOptions(
      [
        makeRow({ id: "p1", sector: "General Sector", amount: 300 }),
        makeRow({ id: "p2", sector: "Social Sector", amount: 200 }),
      ],
      { displayTotalBudget: 400 }
    );

    expect(result.totalBudget).toBe(500);
    expect(result.coveredPercentage).toBe(100);
    expect(result.rows.find((row) => row.category === "General Sector")?.percentage).toBe(60);
    expect(result.rows.find((row) => row.category === "Social Sector")?.percentage).toBe(40);
  });

  it("keeps explicit zero display total as denominator", () => {
    const result = buildBudgetAllocationWithOptions(
      [
        makeRow({ id: "p1", sector: "General Sector", amount: 300 }),
        makeRow({ id: "p2", sector: "Social Sector", amount: 200 }),
      ],
      { displayTotalBudget: 0 }
    );

    expect(result.totalBudget).toBe(0);
    expect(result.coveredPercentage).toBe(0);
    expect(result.rows.every((row) => row.percentage === 0)).toBe(true);
  });
});
