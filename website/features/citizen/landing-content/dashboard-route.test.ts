import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LandingContentResult } from "@/lib/domain/landing-content";
import { GET } from "@/app/api/citizen/dashboard/route";

const mockGetLandingContent = vi.fn();

vi.mock("@/lib/repos/landing-content", () => ({
  getLandingContentRepoServer: () => ({
    getLandingContent: mockGetLandingContent,
  }),
}));

function buildResult(overrides?: Partial<LandingContentResult>): LandingContentResult {
  return {
    vm: {
      hero: {
        title: "title",
        subtitle: "subtitle",
        ctaLabel: "cta",
        ctaHrefOrAction: { type: "href", value: "/aips" },
      },
      manifesto: {
        eyebrow: "eyebrow",
        lines: ["line"],
        subtext: "subtext",
      },
      lguOverview: {
        lguName: "City of Cabuyao",
        scopeLabel: "City",
        fiscalYearLabel: "FY 2026",
        totalBudget: 1,
        projectCount: 1,
        aipStatus: "Published",
        citizenCount: 1,
        map: {
          center: { lat: 1, lng: 1 },
          zoom: 13,
          selectedFiscalYear: 2026,
          markers: [],
        },
      },
      distribution: {
        total: 1,
        sectors: [],
      },
      healthHighlights: {
        heading: "h",
        description: "d",
        primaryKpiLabel: "k1",
        primaryKpiValue: 1,
        secondaryKpiLabel: "k2",
        secondaryKpiValue: 1,
        projects: [],
      },
      infraHighlights: {
        heading: "h",
        description: "d",
        primaryKpiLabel: "k1",
        primaryKpiValue: 1,
        secondaryKpiLabel: "k2",
        secondaryKpiValue: 1,
        projects: [],
      },
      feedback: {
        months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
        series: [],
        categorySummary: [
          { key: "commend", label: "Commend", count: 0, percentage: 0 },
          { key: "suggestion", label: "Suggestion", count: 0, percentage: 0 },
          { key: "concern", label: "Concern", count: 0, percentage: 0 },
          { key: "question", label: "Question", count: 0, percentage: 0 },
        ],
        responseRate: 0,
        avgResponseTimeDays: 0,
      },
      chatPreview: {
        pillLabel: "pill",
        title: "title",
        subtitle: "subtitle",
        assistantName: "assistant",
        assistantStatus: "online",
        userPrompt: "prompt",
        assistantIntro: "intro",
        assistantBullets: [],
        suggestedPrompts: [],
        ctaLabel: "cta",
      },
      finalCta: {
        title: "title",
        subtitle: "subtitle",
        ctaLabel: "cta",
      },
    },
    meta: {
      hasData: true,
      availableFiscalYears: [2026],
      selection: {
        requestedScopeType: null,
        requestedScopeId: null,
        requestedFiscalYear: null,
        resolvedScopeType: "city",
        resolvedScopeId: "scope-city",
        resolvedScopePsgc: "043404",
        resolvedFiscalYear: 2026,
        fallbackApplied: false,
      },
    },
    ...overrides,
  };
}

describe("citizen dashboard API route", () => {
  beforeEach(() => {
    mockGetLandingContent.mockReset();
    mockGetLandingContent.mockResolvedValue(buildResult());
  });

  it("returns default payload", async () => {
    const response = await GET(new Request("http://localhost/api/citizen/dashboard"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.has_data).toBe(true);
    expect(payload.vm.feedback.categorySummary).toHaveLength(4);
    expect(mockGetLandingContent).toHaveBeenCalledWith({
      scopeType: null,
      scopeId: null,
      fiscalYear: null,
    });
  });

  it("passes valid scope query values", async () => {
    await GET(
      new Request(
        "http://localhost/api/citizen/dashboard?scope_type=barangay&scope_id=scope-1&fiscal_year=2025"
      )
    );

    expect(mockGetLandingContent).toHaveBeenCalledWith({
      scopeType: "barangay",
      scopeId: "scope-1",
      fiscalYear: 2025,
    });
  });

  it("normalizes invalid query values", async () => {
    await GET(
      new Request(
        "http://localhost/api/citizen/dashboard?scope_type=province&scope_id=&fiscal_year=bad"
      )
    );

    expect(mockGetLandingContent).toHaveBeenCalledWith({
      scopeType: null,
      scopeId: null,
      fiscalYear: null,
    });
  });

  it("returns 200 with no-data state", async () => {
    mockGetLandingContent.mockResolvedValueOnce(
      buildResult({
        meta: {
          hasData: false,
          availableFiscalYears: [],
          selection: {
            requestedScopeType: "barangay",
            requestedScopeId: "scope-1",
            requestedFiscalYear: 2024,
            resolvedScopeType: "barangay",
            resolvedScopeId: "scope-1",
            resolvedScopePsgc: "043404009",
            resolvedFiscalYear: 2024,
            fallbackApplied: false,
          },
        },
      })
    );

    const response = await GET(new Request("http://localhost/api/citizen/dashboard?fiscal_year=2024"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.has_data).toBe(false);
  });

  it("returns 500 for operational failures", async () => {
    mockGetLandingContent.mockRejectedValueOnce(new Error("boom"));

    const response = await GET(new Request("http://localhost/api/citizen/dashboard"));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.errors).toEqual(["boom"]);
  });
});
