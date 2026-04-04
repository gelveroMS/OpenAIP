import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminDashboardView from "@/features/admin/dashboard/views/admin-dashboard-view";

const mockUseAdminDashboard = vi.fn();
const mockSetUsageRange = vi.fn();

vi.mock("@/features/admin/dashboard/hooks/useAdminDashboard", () => ({
  useAdminDashboard: (...args: unknown[]) => mockUseAdminDashboard(...args),
}));

vi.mock("@/features/admin/dashboard/components/ChatbotUsageLineChart", () => ({
  default: (props: {
    usageYear: string;
    usageMonth: string;
    yearOptions: number[];
    onUsageYearChange: (value: string) => void;
    onUsageMonthChange: (value: string) => void;
  }) => (
    <div>
      <div data-testid="usage-year">{props.usageYear}</div>
      <div data-testid="usage-month">{props.usageMonth}</div>
      <div data-testid="usage-years">{props.yearOptions.join(",")}</div>
      <button type="button" onClick={() => props.onUsageMonthChange("02")}>
        Select February
      </button>
      <button type="button" onClick={() => props.onUsageYearChange("2025")}>
        Select Year 2025
      </button>
    </div>
  ),
}));

describe("Admin dashboard usage time filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAdminDashboard.mockReturnValue({
      filters: {
        dateFrom: null,
        dateTo: null,
        lguScope: "all",
        lguId: null,
        aipStatus: "all",
      },
      setFilters: vi.fn(),
      setUsageRange: mockSetUsageRange,
      usageRange: { usageFrom: null, usageTo: null },
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
        usageMetrics: {
          errorRateTrend: [],
          chatbotUsageTrend: [
            { label: "Jan 1", value: 10, dateKey: "2024-01-01" },
            { label: "Jan 1", value: 10, dateKey: "2025-01-01" },
          ],
          avgDailyRequests: 10,
          totalRequests: 20,
          errorRate: 0,
          deltaLabels: {
            avgDailyRequests: "",
            totalRequests: "",
            errorRate: "",
          },
          periodDays: 2,
        },
        recentActivity: [],
        lguOptions: [],
      },
      loading: false,
      error: null,
      createDefaultFilters: vi.fn(),
    });
  });

  it("defaults to all-year/all-month and auto-selects current year when month is chosen", () => {
    const currentYear = new Date().getFullYear();
    const februaryEnd = new Date(currentYear, 2, 0);
    const februaryLastDay = `${februaryEnd.getFullYear()}-${String(
      februaryEnd.getMonth() + 1
    ).padStart(2, "0")}-${String(februaryEnd.getDate()).padStart(2, "0")}`;

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

    expect(screen.getByTestId("usage-year")).toHaveTextContent("all");
    expect(screen.getByTestId("usage-month")).toHaveTextContent("all");

    fireEvent.click(screen.getByRole("button", { name: "Select February" }));

    expect(mockSetUsageRange).toHaveBeenCalledWith({
      usageFrom: `${currentYear}-02-01`,
      usageTo: februaryLastDay,
    });
  });

  it("applies full-year usage range when a year is selected with all months", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Select Year 2025" }));

    expect(mockSetUsageRange).toHaveBeenCalledWith({
      usageFrom: "2025-01-01",
      usageTo: "2025-12-31",
    });
  });
});
