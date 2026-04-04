import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AipMonitoringView from "./aip-monitoring-view";

const mockUseSearchParams = vi.fn();
const mockPush = vi.fn();
const mockGetSeedData = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockUseSearchParams(),
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("@/lib/repos/aip-monitoring", () => ({
  getAipMonitoringRepo: () => ({
    getSeedData: () => mockGetSeedData(),
  }),
}));

vi.mock("../components/AipFiltersRow", () => ({
  default: ({ statusFilter }: { statusFilter: string }) => (
    <div data-testid="aip-monitoring-status-filter">{statusFilter}</div>
  ),
}));

vi.mock("../components/AipsTable", () => ({
  default: () => <div data-testid="aips-table" />,
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

  it("applies enum status when status query param is present", async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams("tab=cases&status=published"));

    render(<AipMonitoringView />);

    await waitFor(() => {
      expect(screen.getByTestId("aip-monitoring-status-filter")).toHaveTextContent(
        "published"
      );
      expect(screen.getByTestId("aips-table")).toBeInTheDocument();
    });
  });

  it("defaults to all status when no valid status query param is present", async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams("tab=cases"));

    render(<AipMonitoringView />);

    await waitFor(() => {
      expect(screen.getByTestId("aip-monitoring-status-filter")).toHaveTextContent("all");
      expect(screen.getByTestId("aips-table")).toBeInTheDocument();
    });
  });
});
