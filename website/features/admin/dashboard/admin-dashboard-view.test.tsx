import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminDashboardView from "@/features/admin/dashboard/views/admin-dashboard-view";

const mockUseAdminDashboard = vi.fn();

vi.mock("@/features/admin/dashboard/hooks/useAdminDashboard", () => ({
  useAdminDashboard: (...args: unknown[]) => mockUseAdminDashboard(...args),
}));

describe("AdminDashboardView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAdminDashboard.mockReturnValue({
      filters: {
        dateFrom: "2026-03-01",
        dateTo: "2026-03-14",
        lguScope: "all",
        lguId: null,
        aipStatus: "all",
      },
      setFilters: vi.fn(),
      setUsageRange: vi.fn(),
      viewModel: {
        kpis: [
          {
            title: "Total LGUs",
            value: "0",
            deltaLabel: "",
            iconClassName: "",
            ctaLabel: "View LGUs",
            path: "/admin/lgu-management",
          },
          {
            title: "Active Users",
            value: "0",
            deltaLabel: "",
            iconClassName: "",
            ctaLabel: "View Accounts",
            path: "/admin/account-administration",
          },
          {
            title: "Flagged Feedback",
            value: "0",
            deltaLabel: "",
            iconClassName: "",
            ctaLabel: "View Content",
            path: "/admin/feedback-moderation",
          },
          {
            title: "Review Backlog",
            value: "0",
            deltaLabel: "",
            iconClassName: "",
            ctaLabel: "View AIPs",
            path: "/admin/aip-monitoring",
          },
        ],
        distribution: [],
        reviewBacklog: null,
        usageMetrics: null,
        recentActivity: [],
        lguOptions: [],
      },
      loading: false,
      error: null,
      createDefaultFilters: vi.fn(() => ({
        dateFrom: "2026-03-01",
        dateTo: "2026-03-14",
        lguScope: "all",
        lguId: null,
        aipStatus: "all",
      })),
    });
  });

  it("removes dashboard filters and error-rate visuals while keeping drill-down actions", () => {
    render(
      <AdminDashboardView
        actions={{
          onOpenLguManagement: vi.fn(),
          onOpenAccounts: vi.fn(),
          onOpenFeedbackModeration: vi.fn(),
          onOpenAipMonitoring: vi.fn(),
          onOpenAuditLogs: vi.fn(),
        }}
      />
    );

    expect(screen.queryByText(/Date From/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reset Filters/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Error Rate Trend/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Error Rate$/i)).not.toBeInTheDocument();

    expect(screen.queryByText(/Recent Activity/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/View Audit/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View LGUs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Accounts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Content" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View AIPs" })).toBeInTheDocument();
  });
});
