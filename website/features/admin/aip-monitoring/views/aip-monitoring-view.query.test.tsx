import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AipMonitoringView from "./aip-monitoring-view";

const mockUseSearchParams = vi.fn();
const mockGetSeedData = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

vi.mock("@/lib/repos/aip-monitoring", () => ({
  getAipMonitoringRepo: () => ({
    getSeedData: () => mockGetSeedData(),
  }),
}));

vi.mock("../components/AipMonitoringTabs", () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="aip-monitoring-active-tab">{value}</div>
  ),
}));

vi.mock("../components/AipFiltersRow", () => ({
  default: ({ tab, statusFilter }: { tab: string; statusFilter: string }) => (
    <div data-testid="aip-monitoring-status-filter">
      {tab}:{statusFilter}
    </div>
  ),
}));

vi.mock("../components/AipsTable", () => ({
  default: () => <div data-testid="aips-table" />,
}));

vi.mock("../components/CasesTable", () => ({
  default: () => <div data-testid="cases-table" />,
}));

vi.mock("../components/AipDetailsModal", () => ({
  default: () => null,
}));

vi.mock("../components/WorkflowActionModal", () => ({
  default: () => null,
}));

describe("AipMonitoringView query hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSeedData.mockResolvedValue({
      aips: [],
      reviews: [],
      activity: [],
      details: {},
      budgetTotalByAipId: {},
      lguNameByAipId: {},
      reviewerDirectory: {},
    });
  });

  it("forces AIPs tab and applies enum status when status query param is present", async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams("tab=cases&status=published"));

    render(<AipMonitoringView />);

    await waitFor(() => {
      expect(screen.getByTestId("aip-monitoring-active-tab")).toHaveTextContent("aips");
      expect(screen.getByTestId("aip-monitoring-status-filter")).toHaveTextContent(
        "aips:published"
      );
    });
  });

  it("applies tab query when no status override is present", async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams("tab=cases"));

    render(<AipMonitoringView />);

    await waitFor(() => {
      expect(screen.getByTestId("aip-monitoring-active-tab")).toHaveTextContent("cases");
      expect(screen.getByTestId("aip-monitoring-status-filter")).toHaveTextContent("cases:all");
    });
  });
});

