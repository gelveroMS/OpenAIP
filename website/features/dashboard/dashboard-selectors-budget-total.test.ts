import { describe, expect, it } from "vitest";
import { buildDashboardVm } from "@/features/dashboard/utils/dashboard-selectors";
import type { DashboardData } from "@/features/dashboard/types/dashboard-types";

function buildData(input?: { totalInvestmentProgram?: number | null }): DashboardData {
  return {
    scope: "barangay",
    scopeId: "barangay-1",
    selectedFiscalYear: 2026,
    selectedAip: {
      id: "aip-1",
      fiscalYear: 2026,
      totalInvestmentProgram: input?.totalInvestmentProgram ?? null,
      status: "draft",
      statusUpdatedAt: "2026-03-01T00:00:00.000Z",
      submittedAt: null,
      publishedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      uploadedBy: null,
      uploadedDate: null,
    },
    availableFiscalYears: [2026],
    allAips: [],
    projects: [
      {
        id: "project-1",
        aipId: "aip-1",
        aipRefCode: "1000-001",
        programProjectDescription: "Project One",
        category: "infrastructure",
        sectorCode: "1000",
        total: 500,
        personalServices: null,
        maintenanceAndOtherOperatingExpenses: null,
        capitalOutlay: null,
        errors: null,
        isHumanEdited: false,
        editedAt: null,
        healthProgramName: null,
      },
      {
        id: "project-2",
        aipId: "aip-1",
        aipRefCode: "3000-001",
        programProjectDescription: "Project Two",
        category: "health",
        sectorCode: "3000",
        total: 500,
        personalServices: null,
        maintenanceAndOtherOperatingExpenses: null,
        capitalOutlay: null,
        errors: null,
        isHumanEdited: false,
        editedAt: null,
        healthProgramName: null,
      },
    ],
    sectors: [
      { code: "1000", label: "General Services" },
      { code: "3000", label: "Social Services" },
    ],
    latestRuns: [],
    reviews: [],
    feedback: [],
    projectUpdateLogs: [],
  };
}

describe("buildDashboardVm budget source", () => {
  it("uses selected AIP total investment program when available", () => {
    const vm = buildDashboardVm({
      data: buildData({ totalInvestmentProgram: 5000 }),
      query: "",
      tableQuery: "",
      tableCategory: "all",
      tableSector: "all",
    });

    expect(vm.totalBudget).toBe(5000);
  });

  it("falls back to summed project totals when file total is missing", () => {
    const vm = buildDashboardVm({
      data: buildData({ totalInvestmentProgram: null }),
      query: "",
      tableQuery: "",
      tableCategory: "all",
      tableSector: "all",
    });

    expect(vm.totalBudget).toBe(1000);
  });

  it("uses summed project totals when file total is lower", () => {
    const vm = buildDashboardVm({
      data: buildData({ totalInvestmentProgram: 500 }),
      query: "",
      tableQuery: "",
      tableCategory: "all",
      tableSector: "all",
    });

    const general = vm.budgetBySector.find((row) => row.sectorCode === "general");
    const social = vm.budgetBySector.find((row) => row.sectorCode === "social");

    expect(vm.totalBudget).toBe(1000);
    expect(general?.percentage).toBe(50);
    expect(social?.percentage).toBe(50);
  });

  it("computes sector percentages using the resolved display total", () => {
    const vm = buildDashboardVm({
      data: buildData({ totalInvestmentProgram: 2000 }),
      query: "",
      tableQuery: "",
      tableCategory: "all",
      tableSector: "all",
    });

    const general = vm.budgetBySector.find((row) => row.sectorCode === "general");
    const social = vm.budgetBySector.find((row) => row.sectorCode === "social");

    expect(general?.amount).toBe(500);
    expect(social?.amount).toBe(500);
    expect(general?.percentage).toBe(25);
    expect(social?.percentage).toBe(25);
  });

  it("keeps explicit zero file total as denominator", () => {
    const vm = buildDashboardVm({
      data: buildData({ totalInvestmentProgram: 0 }),
      query: "",
      tableQuery: "",
      tableCategory: "all",
      tableSector: "all",
    });

    expect(vm.totalBudget).toBe(0);
    expect(vm.budgetBySector.every((row) => row.percentage === 0)).toBe(true);
  });
});
