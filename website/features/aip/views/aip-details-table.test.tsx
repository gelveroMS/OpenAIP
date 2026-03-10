import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AipDetailsTableView } from "./aip-details-table";
import type { AipProjectRow } from "../types";

const mockPush = vi.fn();
let lastTableCardProps: { showCommentingNote?: boolean; canComment?: boolean } | null =
  null;

const mockRows: AipProjectRow[] = [
  {
    id: "project-001",
    aipId: "aip-001",
    aipRefCode: "1000-001",
    programProjectDescription: "City project",
    implementingAgency: "City Engineering Office",
    startDate: "2026-01-01",
    completionDate: "2026-12-31",
    expectedOutput: "Completed facility",
    sourceOfFunds: "General Fund",
    personalServices: 1000,
    maintenanceAndOtherOperatingExpenses: 2000,
    financialExpenses: null,
    capitalOutlay: 3000,
    total: 6000,
    climateChangeAdaptation: "200",
    climateChangeMitigation: "100",
    ccTopologyCode: "A214-04",
    prmNcrLguRmObjectiveResultsIndicator: "Indicator-001",
    category: "infrastructure",
    errors: null,
    projectRefCode: "1000-001",
    kind: "infrastructure",
    sector: "General Sector",
    amount: 6000,
    reviewStatus: "unreviewed",
    aipDescription: "City project",
  },
];

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("../actions/aip-projects.actions", () => ({
  listAipProjectsAction: vi.fn(async () => mockRows),
}));

vi.mock("../components/aip-details-table-card", () => ({
  AipDetailsTableCard: ({
    rows,
    onRowClick,
    showCommentingNote,
    canComment,
  }: {
    rows: AipProjectRow[];
    onRowClick: (row: AipProjectRow) => void;
    showCommentingNote?: boolean;
    canComment?: boolean;
  }) => (
    <>
      {(() => {
        lastTableCardProps = { showCommentingNote, canComment };
        return null;
      })()}
      <button type="button" onClick={() => onRowClick(rows[0])}>
        Open Row
      </button>
    </>
  ),
}));

vi.mock("../components/budget-allocation-table", () => ({
  BudgetAllocationTable: () => <div data-testid="budget-table" />,
  buildBudgetAllocationWithOptions: () => ({
    rows: [],
    totalBudget: 0,
    totalProjects: 0,
    coveredPercentage: 0,
  }),
}));

describe("AipDetailsTableView", () => {
  it("hides commenting note for published barangay AIPs", async () => {
    lastTableCardProps = null;

    render(
      <AipDetailsTableView
        aipId="aip-001"
        year={2026}
        aipStatus="published"
        scope="barangay"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open Row" })).toBeInTheDocument();
    });

    expect(lastTableCardProps).toEqual({
      canComment: false,
      showCommentingNote: false,
    });
  });

  it("routes city rows to dedicated city project pages", async () => {
    lastTableCardProps = null;

    render(
      <AipDetailsTableView
        aipId="aip-001"
        year={2026}
        aipStatus="draft"
        scope="city"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open Row" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Row" }));

    expect(mockPush).toHaveBeenCalledWith("/city/aips/aip-001/project-001");
  });
});
