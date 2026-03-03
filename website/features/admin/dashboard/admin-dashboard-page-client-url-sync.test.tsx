import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminDashboardFilters,
  AdminDashboardSnapshot,
} from "@/lib/repos/admin-dashboard/types";
import AdminDashboardPageClient from "@/app/admin/(authenticated)/(dashboard)/admin-dashboard-page-client";

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
  }),
}));

vi.mock("@/features/admin/dashboard/views/admin-dashboard-view", () => ({
  default: (props: {
    onFiltersChange?: (filters: AdminDashboardFilters) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        props.onFiltersChange?.({
          dateFrom: "2026-03-01",
          dateTo: "2026-03-14",
          lguScope: "city",
          lguId: "city-1",
          aipStatus: "under_review",
        })
      }
    >
      Sync Filters
    </button>
  ),
}));

const initialFilters: AdminDashboardFilters = {
  dateFrom: "2026-03-01",
  dateTo: "2026-03-14",
  lguScope: "all",
  lguId: null,
  aipStatus: "all",
};

const initialSnapshot: AdminDashboardSnapshot = {
  summary: {
    totalLgus: 0,
    activeUsers: 0,
    flaggedComments: 0,
    reviewBacklog: 0,
    deltaLabels: {
      totalLgus: "",
      activeUsers: "",
      flaggedComments: "",
      reviewBacklog: "",
    },
    elevatedFlags: {
      flaggedComments: false,
      reviewBacklog: false,
    },
  },
  distribution: [],
  reviewBacklog: {
    awaitingCount: 0,
    awaitingOldestDays: 0,
    stuckCount: 0,
    stuckOlderThanDays: 7,
  },
  usageMetrics: {
    errorRateTrend: [],
    chatbotUsageTrend: [],
    avgDailyRequests: 0,
    totalRequests: 0,
    errorRate: 0,
    deltaLabels: {
      avgDailyRequests: "",
      totalRequests: "",
      errorRate: "",
    },
    periodDays: 14,
  },
  recentActivity: [],
  lguOptions: [],
};

describe("AdminDashboardPageClient URL sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates /admin query via history.replaceState without router navigation", () => {
    const replaceStateSpy = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => undefined);

    render(
      <AdminDashboardPageClient
        initialFilters={initialFilters}
        initialSnapshot={initialSnapshot}
      />
    );

    expect(replaceStateSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sync Filters" }));

    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      "",
      "/admin?from=2026-03-01&to=2026-03-14&lguScope=city&lguId=city-1&status=under_review"
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
