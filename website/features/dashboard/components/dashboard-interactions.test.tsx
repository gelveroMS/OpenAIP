import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { DashboardHeader } from "./dashboard-header-widgets";
import { TopFundedProjectsSection } from "./dashboard-projects-overview";
import { BudgetBreakdownSection } from "./dashboard-budget-allocation";
import { AipsByYearTable } from "./dashboard-aip-publication-status";
import { RecentActivityFeed, RecentProjectUpdatesCard } from "./dashboard-activity-updates";
import type { DashboardQueryState } from "@/features/dashboard/types/dashboard-types";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string | URL;
    children: ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : String(href)} {...props}>
      {children}
    </a>
  ),
}));

const requestSubmitMock = vi.fn();

beforeAll(() => {
  Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", {
    configurable: true,
    writable: true,
    value: requestSubmitMock,
  });
});

beforeEach(() => {
  requestSubmitMock.mockReset();
  window.history.replaceState({}, "", "/barangay");
});

afterAll(() => {
  vi.restoreAllMocks();
});

const queryState: DashboardQueryState = {
  q: "drainage",
  tableQ: "center",
  tableCategory: "health",
  tableSector: "3000",
  kpiMode: "summary",
};

describe("DashboardHeader interactions", () => {
  it("auto-submits when fiscal year changes and syncs latest top-filter URL params", () => {
    window.history.replaceState(
      {},
      "",
      "/barangay?tableQ=url-filter&category=infrastructure&sector=8000"
    );

    render(
      <DashboardHeader
        title="Welcome to OpenAIP"
        q={queryState.q}
        tableQ="stale-search"
        tableCategory="health"
        tableSector="3000"
        selectedFiscalYear={2026}
        availableFiscalYears={[2026, 2025]}
        kpiMode={queryState.kpiMode}
      />
    );

    fireEvent.change(screen.getByLabelText("Select Year"), {
      target: { value: "2025" },
    });

    expect(requestSubmitMock).toHaveBeenCalledTimes(1);
    expect((document.querySelector('input[name="tableQ"]') as HTMLInputElement).value).toBe(
      "url-filter"
    );
    expect((document.querySelector('input[name="category"]') as HTMLInputElement).value).toBe(
      "infrastructure"
    );
    expect((document.querySelector('input[name="sector"]') as HTMLInputElement).value).toBe(
      "8000"
    );
  });

  it("submits global search on Enter and blur", () => {
    render(
      <DashboardHeader
        title="Welcome to OpenAIP"
        q={queryState.q}
        selectedFiscalYear={2026}
        availableFiscalYears={[2026]}
      />
    );

    const searchInput = screen.getByLabelText("Global search");
    fireEvent.keyDown(searchInput, { key: "Enter" });
    fireEvent.change(searchInput, { target: { value: "new query" } });
    fireEvent.blur(searchInput);

    expect(requestSubmitMock).toHaveBeenCalledTimes(2);
  });
});

describe("Top funded filters interactions", () => {
  const replaceStateSpy = vi.spyOn(window.history, "replaceState");

  afterEach(() => {
    replaceStateSpy.mockReset();
    vi.useRealTimers();
  });

  function makeProject(input: {
    id: string;
    description: string;
    category: "health" | "infrastructure" | "other";
    sectorCode: string;
    total: number | null;
    aipRefCode?: string;
    healthProgramName?: string | null;
  }) {
    return {
      id: input.id,
      aipId: "aip-2026",
      aipRefCode: input.aipRefCode ?? `${input.sectorCode}-01`,
      programProjectDescription: input.description,
      category: input.category,
      sectorCode: input.sectorCode,
      total: input.total,
      personalServices: null,
      maintenanceAndOtherOperatingExpenses: null,
      capitalOutlay: null,
      errors: null,
      isHumanEdited: false,
      editedAt: null,
      healthProgramName: input.healthProgramName ?? null,
    };
  }

  const projects = [
    makeProject({
      id: "p-road",
      description: "Road Repair Program",
      category: "infrastructure",
      sectorCode: "8000",
      total: 900000,
      aipRefCode: "8000-01",
    }),
    makeProject({
      id: "p-health",
      description: "Health Center Upgrade",
      category: "health",
      sectorCode: "3000",
      total: 650000,
      aipRefCode: "3000-01",
      healthProgramName: "Primary Care",
    }),
    makeProject({
      id: "p-other",
      description: "General Admin Improvements",
      category: "other",
      sectorCode: "1000",
      total: null,
      aipRefCode: "1000-01",
    }),
  ];

  it("filters live while typing without Enter and without form-submit refresh", () => {
    vi.useFakeTimers();

    render(
      <TopFundedProjectsSection
        queryState={{ ...queryState, tableQ: "", tableCategory: "all", tableSector: "all" }}
        sectors={[
          { code: "3000", label: "Social Services" },
          { code: "8000", label: "Economic Services" },
          { code: "1000", label: "General Services" },
        ]}
        projects={projects}
      />
    );

    expect(screen.getByText("Road Repair Program")).toBeInTheDocument();
    expect(screen.getByText("Health Center Upgrade")).toBeInTheDocument();

    act(() => {
      fireEvent.change(screen.getByPlaceholderText("Search projects..."), {
        target: { value: "road" },
      });
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText("Road Repair Program")).toBeInTheDocument();
    expect(screen.queryByText("Health Center Upgrade")).toBeNull();
    expect(requestSubmitMock).toHaveBeenCalledTimes(0);
    expect(replaceStateSpy).toHaveBeenCalled();
  });

  it("filters instantly on category and type changes", () => {
    vi.useFakeTimers();

    render(
      <TopFundedProjectsSection
        queryState={{ ...queryState, tableQ: "", tableCategory: "all", tableSector: "all" }}
        sectors={[
          { code: "3000", label: "Social Services" },
          { code: "8000", label: "Economic Services" },
          { code: "1000", label: "General Services" },
        ]}
        projects={projects}
      />
    );

    fireEvent.change(screen.getByDisplayValue("All Categories"), {
      target: { value: "health" },
    });
    expect(screen.getByText("Health Center Upgrade")).toBeInTheDocument();
    expect(screen.queryByText("Road Repair Program")).toBeNull();

    fireEvent.change(screen.getByDisplayValue("All Types"), {
      target: { value: "8000" },
    });
    expect(screen.queryByText("Health Center Upgrade")).toBeNull();
    expect(screen.queryByText("Road Repair Program")).toBeNull();
  });

  it("keeps unrelated URL params and clears default top-filter keys", () => {
    vi.useFakeTimers();
    window.history.replaceState(
      {},
      "",
      "/barangay?year=2026&q=global&tableQ=road&category=health&sector=3000"
    );

    render(
      <TopFundedProjectsSection
        queryState={{
          ...queryState,
          tableQ: "road",
          tableCategory: "health",
          tableSector: "3000",
        }}
        sectors={[
          { code: "3000", label: "Social Services" },
          { code: "8000", label: "Economic Services" },
          { code: "1000", label: "General Services" },
        ]}
        projects={projects}
      />
    );

    replaceStateSpy.mockClear();

    fireEvent.change(screen.getByPlaceholderText("Search projects..."), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByDisplayValue("Health"), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByDisplayValue("Social Services"), {
      target: { value: "all" },
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const latestUrl = String(replaceStateSpy.mock.calls.at(-1)?.[2] ?? "");
    expect(latestUrl).toContain("year=2026");
    expect(latestUrl).toContain("q=global");
    expect(latestUrl).not.toContain("tableQ=");
    expect(latestUrl).not.toContain("category=");
    expect(latestUrl).not.toContain("sector=");
  });
});

describe("Dashboard links and actions", () => {
  it("renders project update logs with mapped action tags", () => {
    render(
      <RecentProjectUpdatesCard
        logs={[
          {
            id: "log-1",
            action: "project_info_updated",
            entityId: "project-1",
            projectRefCode: "3000-01",
            title: "Project information updated",
            body: "Updated health project information for 3000-01.",
            actorName: "Maria Santos",
            createdAt: "2026-02-27T08:00:00.000Z",
          },
          {
            id: "log-2",
            action: "project_updated",
            entityId: "project-2",
            projectRefCode: "8000-01",
            title: "Drainage progress update",
            body: "Posted update with latest progress and implementation details.",
            actorName: "Juan Dela Cruz",
            createdAt: "2026-02-27T09:00:00.000Z",
          },
        ]}
      />
    );

    expect(screen.getByText("Drainage progress update")).toBeInTheDocument();
    expect(screen.getByText("Project information updated")).toBeInTheDocument();
    expect(screen.getByText("Post Update")).toBeInTheDocument();
    expect(screen.getByText("Add Information")).toBeInTheDocument();
  });

  it("shows empty state when project update logs are unavailable", () => {
    render(<RecentProjectUpdatesCard logs={[]} />);

    expect(
      screen.getByText("No add-information or project-update logs yet.")
    ).toBeInTheDocument();
  });

  it("keeps only View AIP Details in budget breakdown", () => {
    render(
      <BudgetBreakdownSection
        totalBudget="PHP 1,000,000"
        detailsHref="/barangay/aips/aip-1"
        items={[
          {
            sectorCode: "3000",
            label: "Social Services",
            amount: 1000000,
            percentage: 100,
          },
        ]}
      />
    );

    expect(screen.getByRole("link", { name: "View AIP Details" })).toHaveAttribute(
      "href",
      "/barangay/aips/aip-1"
    );
    expect(screen.queryByRole("link", { name: "View All Projects" })).toBeNull();
  });

  it("routes AIPs-by-year row View action to scope-specific AIP details", () => {
    render(
      <AipsByYearTable
        rows={[
          {
            id: "aip-2026",
            fiscalYear: 2026,
            status: "draft",
            statusUpdatedAt: "2026-02-27T08:00:00.000Z",
            submittedAt: null,
            publishedAt: null,
            createdAt: "2026-02-27T08:00:00.000Z",
            uploadedBy: "Officer",
            uploadedDate: "2026-02-27T08:00:00.000Z",
          },
        ]}
        basePath="/barangay"
      />
    );

    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "/barangay/aips/aip-2026"
    );
  });

  it("routes recent activity audit CTA to provided audit page", () => {
    render(
      <RecentActivityFeed
        logs={[
          {
            id: "activity-1",
            actorId: "user-1",
            actorRole: "barangay_official",
            action: "project_updated",
            entityType: "projects",
            entityId: "project-1",
            scope: {
              scope_type: "barangay",
              barangay_id: "barangay-1",
              city_id: null,
              municipality_id: null,
            },
            metadata: {
              actor_name: "Maria Santos",
              details: "Posted update for road concreting project.",
            },
            createdAt: "2026-02-27T08:00:00.000Z",
          },
        ]}
        auditHref="/barangay/audit"
      />
    );

    expect(screen.getByText("Project Update")).toBeInTheDocument();
    expect(screen.getByText("Posted update for road concreting project.")).toBeInTheDocument();
    expect(screen.getByText(/Maria Santos/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Audit and Accountability" })).toHaveAttribute(
      "href",
      "/barangay/audit"
    );
  });

  it("shows empty state when recent activity logs are unavailable", () => {
    render(<RecentActivityFeed logs={[]} auditHref="/barangay/audit" />);

    expect(screen.getByText("No official activity logs yet.")).toBeInTheDocument();
  });
});
