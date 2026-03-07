import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BarangayDashboardPage } from "./barangay-dashboard-page";
import type { DashboardData, DashboardQueryState, DashboardViewModel } from "@/features/dashboard/types/dashboard-types";
import type { ActivityLogRow } from "@/lib/repos/audit/repo";

const { citizenEngagementPulseColumnMock } = vi.hoisted(() => ({
  citizenEngagementPulseColumnMock: vi.fn(),
}));

vi.mock("@/features/dashboard/components/dashboard-header-widgets", () => ({
  DashboardHeader: ({ title }: { title: string }) => <div>{title}</div>,
  DateCard: () => <div>Date Card</div>,
  WorkingOnCard: () => <div>You&apos;re Working On</div>,
}));

vi.mock("@/features/dashboard/components/dashboard-budget-allocation", () => ({
  BudgetBreakdownSection: () => <div>Budget Breakdown</div>,
}));

vi.mock("@/features/dashboard/components/dashboard-projects-overview", () => ({
  TopFundedProjectsSection: () => <div>Top Funded Projects</div>,
}));

vi.mock("@/features/dashboard/components/dashboard-aip-publication-status", () => ({
  AipCoverageCard: () => <div>AIP Coverage</div>,
  AipsByYearTable: () => <div>AIPs by Year</div>,
}));

vi.mock("@/features/dashboard/components/dashboard-feedback-insights", () => ({
  CitizenEngagementPulseColumn: (props: unknown) => {
    citizenEngagementPulseColumnMock(props);
    return <div>Citizen Engagement Pulse</div>;
  },
}));

vi.mock("@/features/dashboard/components/dashboard-activity-updates", () => ({
  RecentActivityFeed: () => <div>Recent Activity</div>,
  RecentProjectUpdatesCard: () => <div>Recent Project Updates</div>,
}));

vi.mock("@/features/dashboard/actions/barangay-dashboard-actions", () => ({
  createBarangayDraftAipAction: vi.fn(async () => undefined),
  replyBarangayFeedbackAction: vi.fn(async () => undefined),
}));

function buildData(): DashboardData {
  return {
    scope: "barangay",
    scopeId: "barangay-1",
    selectedFiscalYear: 2026,
    selectedAip: null,
    availableFiscalYears: [2026],
    allAips: [],
    projects: [],
    sectors: [],
    latestRuns: [],
    reviews: [],
    feedback: [],
    projectUpdateLogs: [],
  };
}

function buildVm(): DashboardViewModel {
  return {
    projects: [],
    budgetBySector: [
      { sectorCode: "general", label: "General", amount: 0, percentage: 0 },
      { sectorCode: "social", label: "Social", amount: 0, percentage: 0 },
      { sectorCode: "economic", label: "Economic", amount: 0, percentage: 0 },
      { sectorCode: "other", label: "Other", amount: 0, percentage: 0 },
    ],
    totalBudget: 0,
    missingTotalCount: 0,
    topFundedFiltered: [],
    citizenFeedbackCount: 0,
    awaitingReplyCount: 0,
    feedbackCategorySummary: [
      { key: "commend", label: "Commend", count: 0, percentage: 0 },
      { key: "suggestion", label: "Suggestion", count: 3, percentage: 60 },
      { key: "concern", label: "Concern", count: 1, percentage: 20 },
      { key: "question", label: "Question", count: 1, percentage: 20 },
    ],
    feedbackTargets: [],
    statusDistribution: [],
    pendingReviewAging: [],
    oldestPendingDays: null,
    failedPipelineStages: 0,
    newThisWeek: 0,
    lguNotesPosted: 0,
    flaggedProjects: 0,
    workingOnItems: [],
    recentCitizenFeedback: [],
  };
}

const queryState: DashboardQueryState = {
  q: "",
  tableQ: "",
  tableCategory: "all",
  tableSector: "all",
  kpiMode: "summary",
};

describe("BarangayDashboardPage", () => {
  beforeEach(() => {
    citizenEngagementPulseColumnMock.mockClear();
  });

  it("keeps dashboard sections visible and shows the no-AIP KPI placeholder", () => {
    const vm = buildVm();
    render(
      <BarangayDashboardPage
        data={buildData()}
        vm={vm}
        queryState={queryState}
        recentActivityLogs={[] as ActivityLogRow[]}
      />
    );

    expect(screen.getByText("Budget Breakdown")).toBeInTheDocument();
    expect(screen.getByText("Top Funded Projects")).toBeInTheDocument();
    expect(screen.getByText("AIP Coverage")).toBeInTheDocument();
    expect(screen.getByText("No AIP")).toBeInTheDocument();
    expect(screen.queryByText("No AIP for 2026")).toBeNull();
    expect(citizenEngagementPulseColumnMock).toHaveBeenCalled();
    expect(citizenEngagementPulseColumnMock.mock.calls[0]?.[0]).toMatchObject({
      feedbackCategorySummary: vm.feedbackCategorySummary,
    });
  });
});
