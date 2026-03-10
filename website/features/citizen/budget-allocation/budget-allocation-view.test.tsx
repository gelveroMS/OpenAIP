import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CitizenBudgetAllocationView from "./views/budget-allocation-view";

const { chartsGridMock } = vi.hoisted(() => ({
  chartsGridMock: vi.fn(),
}));

vi.mock("@/features/citizen/components/citizen-page-hero", () => ({
  default: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div data-testid="citizen-page-hero">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  ),
}));

vi.mock("@/features/citizen/components/citizen-explainer-card", () => ({
  default: ({ title, body }: { title: string; body?: string }) => (
    <div data-testid="citizen-explainer-card">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  ),
}));

vi.mock("@/features/citizen/budget-allocation/components", () => ({
  FiltersSection: ({
    onYearChange,
    onLguChange,
  }: {
    onYearChange: (year: number) => void;
    onLguChange: (scopeType: "city" | "barangay", scopeId: string) => void;
  }) => (
    <div data-testid="filters-section">
      <button onClick={() => onYearChange(2025)}>Set Year 2025</button>
      <button
        onClick={() => onLguChange("barangay", "33333333-3333-4333-8333-333333333333")}
      >
        Set Brgy
      </button>
    </div>
  ),
  OverviewHeader: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div data-testid="overview-header">
      <p>{title}</p>
      <p>{subtitle}</p>
    </div>
  ),
  ChartsGrid: (props: unknown) => {
    chartsGridMock(props);
    return <div data-testid="charts-grid" />;
  },
  AipDetailsSection: ({
    page,
    totalPages,
    onPageChange,
  }: {
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  }) => (
    <div data-testid="aip-details-section">
      <p>
        Page {page} of {totalPages}
      </p>
      <button onClick={() => onPageChange(page + 1)}>Next Page</button>
    </div>
  ),
}));

describe("CitizenBudgetAllocationView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    chartsGridMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads filters first, then loads summary and paginated projects using resolved selection", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/citizen/budget-allocation/filters")) {
        return new Response(
          JSON.stringify({
            has_data: true,
            years: [2026],
            lgus: [
              {
                scope_type: "city",
                scope_id: "11111111-1111-4111-8111-111111111111",
                label: "City of Alpha",
              },
            ],
            selected: {
              fiscal_year: 2026,
              scope_type: "city",
              scope_id: "11111111-1111-4111-8111-111111111111",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("/api/citizen/budget-allocation/summary")) {
        return new Response(
          JSON.stringify({
            scope: { scope_name: "City of Alpha" },
            totals: { by_sector: [] },
            trend: { years: [], series: [] },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("/api/citizen/budget-allocation/projects")) {
        return new Response(
          JSON.stringify({
            items: [],
            totalPages: 1,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<CitizenBudgetAllocationView />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/citizen/budget-allocation/projects"),
        expect.objectContaining({ cache: "no-store" })
      )
    );

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain("/api/citizen/budget-allocation/filters");
    expect(urls.some((url) => url.includes("/api/citizen/budget-allocation/summary?fiscal_year=2026"))).toBe(true);
    expect(urls.some((url) => url.includes("/api/citizen/budget-allocation/projects?fiscal_year=2026"))).toBe(true);
  });

  it("shows empty published-data state when filters endpoint returns no published AIPs", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/citizen/budget-allocation/filters")) {
        return new Response(
          JSON.stringify({
            has_data: false,
            years: [],
            lgus: [],
            selected: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<CitizenBudgetAllocationView />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "No published AIP budget allocation data is currently available for city or barangay scope."
        )
      ).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/citizen/budget-allocation/filters");
  });

  it("requests next projects page from backend pagination when page changes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/citizen/budget-allocation/filters")) {
        return new Response(
          JSON.stringify({
            has_data: true,
            years: [2026],
            lgus: [
              {
                scope_type: "city",
                scope_id: "11111111-1111-4111-8111-111111111111",
                label: "City of Alpha",
              },
            ],
            selected: {
              fiscal_year: 2026,
              scope_type: "city",
              scope_id: "11111111-1111-4111-8111-111111111111",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("/api/citizen/budget-allocation/summary")) {
        return new Response(
          JSON.stringify({
            scope: { scope_name: "City of Alpha" },
            totals: { by_sector: [] },
            trend: { years: [], series: [] },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("/api/citizen/budget-allocation/projects")) {
        return new Response(
          JSON.stringify({
            items: [],
            totalPages: 3,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<CitizenBudgetAllocationView />);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("page=1"))).toBe(true)
    );

    fireEvent.click(screen.getByRole("button", { name: "Next Page" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("page=2"))).toBe(true)
    );
  });

  it("uses totals.overall_total as chart total budget denominator", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/citizen/budget-allocation/filters")) {
        return new Response(
          JSON.stringify({
            has_data: true,
            years: [2026],
            lgus: [
              {
                scope_type: "city",
                scope_id: "11111111-1111-4111-8111-111111111111",
                label: "City of Alpha",
              },
            ],
            selected: {
              fiscal_year: 2026,
              scope_type: "city",
              scope_id: "11111111-1111-4111-8111-111111111111",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("/api/citizen/budget-allocation/summary")) {
        return new Response(
          JSON.stringify({
            scope: { scope_name: "City of Alpha" },
            totals: {
              overall_total: 1200,
              by_sector: [
                { sector_code: "1000", sector_label: "General Services", total: 300 },
                { sector_code: "3000", sector_label: "Social Services", total: 200 },
              ],
            },
            trend: { years: [], series: [] },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("/api/citizen/budget-allocation/projects")) {
        return new Response(
          JSON.stringify({
            items: [],
            totalPages: 1,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<CitizenBudgetAllocationView />);

    await waitFor(() => {
      const hasResolvedTotal = chartsGridMock.mock.calls.some((call) => {
        const props = call[0] as { totalBudget?: number } | undefined;
        return props?.totalBudget === 1200;
      });
      expect(hasResolvedTotal).toBe(true);
    });
  });
});
