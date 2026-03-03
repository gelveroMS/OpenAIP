import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminDashboardFilters,
  AdminDashboardSnapshot,
} from "@/lib/repos/admin-dashboard/types";
import { createSupabaseAdminDashboardRepo } from "@/lib/repos/admin-dashboard/repo.supabase";

const filters: AdminDashboardFilters = {
  dateFrom: "2026-03-01",
  dateTo: "2026-03-31",
  lguScope: "all",
  lguId: null,
  aipStatus: "all",
};

const snapshot: AdminDashboardSnapshot = {
  summary: {
    totalLgus: 2,
    activeUsers: 5,
    flaggedComments: 1,
    reviewBacklog: 3,
    deltaLabels: {
      totalLgus: "+0%",
      activeUsers: "+0%",
      flaggedComments: "+0%",
      reviewBacklog: "+0%",
    },
    elevatedFlags: {
      flaggedComments: false,
      reviewBacklog: false,
    },
  },
  distribution: [],
  reviewBacklog: {
    awaitingCount: 2,
    awaitingOldestDays: 4,
    stuckCount: 1,
    stuckOlderThanDays: 7,
  },
  usageMetrics: {
    errorRateTrend: [],
    chatbotUsageTrend: [],
    avgDailyRequests: 0,
    totalRequests: 0,
    errorRate: 0,
    deltaLabels: {
      avgDailyRequests: "+0%",
      totalRequests: "+0%",
      errorRate: "+0%",
    },
    periodDays: 14,
  },
  recentActivity: [],
  lguOptions: [],
};

describe("admin dashboard repo API snapshot fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dedupes concurrent metric calls to a single fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => snapshot,
    });
    vi.stubGlobal("fetch", fetchMock);

    const repo = createSupabaseAdminDashboardRepo();

    const [summary, usageMetrics, recentActivity] = await Promise.all([
      repo.getSummary(filters),
      repo.getUsageMetrics(filters),
      repo.getRecentActivity(filters),
    ]);

    expect(summary).toEqual(snapshot.summary);
    expect(usageMetrics).toEqual(snapshot.usageMetrics);
    expect(recentActivity).toEqual(snapshot.recentActivity);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on auth-race responses and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: "Unauthorized." }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ message: "Forbidden." }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => snapshot,
      });
    vi.stubGlobal("fetch", fetchMock);

    const repo = createSupabaseAdminDashboardRepo();
    const summary = await repo.getSummary(filters);

    expect(summary).toEqual(snapshot.summary);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws a controlled error after invalid payload retries are exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ html: "<!doctype html><html></html>" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const repo = createSupabaseAdminDashboardRepo();

    await expect(repo.getSummary(filters)).rejects.toThrow(
      "Dashboard request returned an invalid payload."
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
