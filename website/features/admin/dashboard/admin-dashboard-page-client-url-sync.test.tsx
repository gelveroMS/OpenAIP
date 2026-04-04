import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AipStatusDistributionVM,
  AdminDashboardFilters,
  AdminDashboardSnapshot,
} from "@/lib/repos/admin-dashboard/types";
import type { AdminDashboardActions } from "@/features/admin/dashboard/types/dashboard-actions";
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
    actions: AdminDashboardActions;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          props.actions.onOpenLguManagement?.({
            filters: initialFilters,
          })
        }
      >
        Open LGUs
      </button>
      <button
        type="button"
        onClick={() =>
          props.actions.onOpenAccounts?.({
            filters: initialFilters,
          })
        }
      >
        Open Accounts
      </button>
      <button
        type="button"
        onClick={() =>
          props.actions.onOpenFeedbackModeration?.({
            filters: initialFilters,
          })
        }
      >
        Open Feedback
      </button>
      <button
        type="button"
        onClick={() =>
          props.actions.onOpenAipMonitoring?.({
            filters: initialFilters,
          })
        }
      >
        Open AIPs
      </button>
      <button
        type="button"
        onClick={() =>
          props.actions.onOpenAipMonitoring?.({
            filters: initialFilters,
            status: "published",
          })
        }
      >
        Open Published AIPs
      </button>
      <button
        type="button"
        onClick={() =>
          props.actions.onOpenAuditLogs?.({
            filters: initialFilters,
          })
        }
      >
        Open Audit Logs
      </button>
    </div>
  ),
}));

const initialFilters: AdminDashboardFilters = {
  dateFrom: null,
  dateTo: null,
  lguScope: "all",
  lguId: null,
  aipStatus: "all",
};

const statusDistribution: AipStatusDistributionVM[] = [
  { status: "draft", label: "Draft", count: 1, color: "#000000" },
  { status: "pending_review", label: "Pending Review", count: 1, color: "#111111" },
  { status: "under_review", label: "Under Review", count: 1, color: "#222222" },
  { status: "for_revision", label: "For Revision", count: 1, color: "#333333" },
  { status: "published", label: "Approved", count: 1, color: "#444444" },
];

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
  distribution: statusDistribution,
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

describe("AdminDashboardPageClient navigation query handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("navigates without trailing query delimiters when no filters are set", () => {
    render(
      <AdminDashboardPageClient
        initialFilters={initialFilters}
        initialSnapshot={initialSnapshot}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open LGUs" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Feedback" }));
    fireEvent.click(screen.getByRole("button", { name: "Open AIPs" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Audit Logs" }));

    expect(mockPush).toHaveBeenCalledTimes(5);
    expect(mockPush).toHaveBeenNthCalledWith(1, "/admin/lgu-management");
    expect(mockPush).toHaveBeenNthCalledWith(2, "/admin/account-administration");
    expect(mockPush).toHaveBeenNthCalledWith(3, "/admin/feedback-moderation");
    expect(mockPush).toHaveBeenNthCalledWith(4, "/admin/aip-monitoring");
    expect(mockPush).toHaveBeenNthCalledWith(5, "/admin/audit-logs");
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("includes explicit status when opening AIP monitoring drill-down", () => {
    render(
      <AdminDashboardPageClient
        initialFilters={initialFilters}
        initialSnapshot={initialSnapshot}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Published AIPs" }));

    expect(mockPush).toHaveBeenCalledWith("/admin/aip-monitoring?status=published");
  });
});
