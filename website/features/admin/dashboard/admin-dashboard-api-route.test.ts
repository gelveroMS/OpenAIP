import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminDashboardSnapshot } from "@/lib/repos/admin-dashboard/types";

const mockGetActorContext = vi.fn();
const mockParseAdminDashboardFilters = vi.fn();
const mockLoadAdminDashboardSnapshot = vi.fn();

vi.mock("@/lib/domain/get-actor-context", () => ({
  getActorContext: () => mockGetActorContext(),
}));

vi.mock("@/lib/repos/admin-dashboard/snapshot.server", () => ({
  parseAdminDashboardFilters: (...args: unknown[]) => mockParseAdminDashboardFilters(...args),
  loadAdminDashboardSnapshot: (...args: unknown[]) => mockLoadAdminDashboardSnapshot(...args),
}));

const mockSnapshot: AdminDashboardSnapshot = {
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

describe("GET /api/admin/dashboard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockGetActorContext.mockResolvedValue({ role: "admin", userId: "admin-1" });
    mockParseAdminDashboardFilters.mockReturnValue({
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
      lguScope: "city",
      lguId: "city-1",
      aipStatus: "under_review",
    });
    mockLoadAdminDashboardSnapshot.mockResolvedValue(mockSnapshot);
  });

  it("returns 401 when actor is missing or non-admin", async () => {
    mockGetActorContext.mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/admin/dashboard/route");
    const response = await GET(new Request("http://localhost/api/admin/dashboard"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ message: "Unauthorized." });
    expect(mockLoadAdminDashboardSnapshot).not.toHaveBeenCalled();
  });

  it("returns dashboard snapshot payload for admin with no-store header", async () => {
    const { GET } = await import("@/app/api/admin/dashboard/route");
    const response = await GET(
      new Request(
        "http://localhost/api/admin/dashboard?from=2026-03-01&to=2026-03-31&lguScope=city&lguId=city-1&status=under_review"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toEqual({
      summary: expect.any(Object),
      distribution: expect.any(Array),
      reviewBacklog: expect.any(Object),
      usageMetrics: expect.any(Object),
      recentActivity: expect.any(Array),
      lguOptions: expect.any(Array),
    });

    expect(mockParseAdminDashboardFilters).toHaveBeenCalledWith(expect.any(URLSearchParams));
    expect(mockLoadAdminDashboardSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: "2026-03-01",
        dateTo: "2026-03-31",
        lguScope: "city",
        lguId: "city-1",
        aipStatus: "under_review",
      })
    );
  });
});
