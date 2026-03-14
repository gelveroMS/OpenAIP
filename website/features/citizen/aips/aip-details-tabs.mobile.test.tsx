import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AipDetailsTabs from "./components/aip-details-tabs";
import type { AipDetails } from "./types";

const replaceMock = vi.fn();
const searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: (...args: unknown[]) => replaceMock(...args),
  }),
  usePathname: () => "/aips/aip-1",
  useSearchParams: () => searchParams,
}));

vi.mock("./components/aip-overview-document-card", () => ({
  default: () => <div>Overview card</div>,
}));

vi.mock("./components/aip-summary-card", () => ({
  default: () => <div>Summary card</div>,
}));

vi.mock("./components/aip-projects-table", () => ({
  default: () => <div>Projects table</div>,
}));

vi.mock("./components/aip-accountability-card", () => ({
  default: () => <div>Accountability card</div>,
}));

vi.mock("./components/aip-feedback-tab", () => ({
  default: () => <div>Feedback tab</div>,
}));

function buildAipDetails(): AipDetails {
  return {
    id: "aip-1",
    scopeType: "city",
    scopeId: "city-1",
    lguLabel: "City of Cabuyao",
    title: "City of Cabuyao - Annual Investment Plan (AIP) 2026",
    fiscalYear: 2026,
    publishedAt: "2026-01-15T00:00:00.000Z",
    budgetTotal: 999999,
    projectsCount: 15,
    description: "AIP description",
    subtitle: "Annual Investment Plan for Fiscal Year 2026",
    fileName: "AIP_2026.pdf",
    pdfUrl: "https://example.com/aip.pdf",
    summaryText: "Summary",
    detailedDescriptionIntro: "Intro",
    detailedBullets: [],
    detailedClosing: "Closing",
    projectRows: [],
    accountability: {
      uploadedBy: null,
      reviewedBy: null,
      approvedBy: null,
      uploadDate: null,
      approvalDate: null,
    },
    feedbackCount: 0,
  };
}

describe("AipDetailsTabs mobile layout", () => {
  it("renders tabs in a horizontal-scroll container and preserves tab routing behavior", async () => {
    replaceMock.mockReset();
    searchParams.set("tab", "overview");

    render(<AipDetailsTabs aip={buildAipDetails()} />);

    const tabsList = screen.getByRole("tablist");
    expect(tabsList.className).toContain("min-w-max");
    expect(tabsList.parentElement?.className).toContain("overflow-x-auto");

    const accountabilityTab = screen.getByTestId("citizen-aip-tab-accountability");
    fireEvent.mouseDown(accountabilityTab);
    fireEvent.click(accountabilityTab);
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/aips/aip-1?tab=accountability", { scroll: false });
    });
  });
});
