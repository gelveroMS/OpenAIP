import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminDashboardFilters,
  AdminDashboardSnapshot,
} from "@/lib/repos/admin-dashboard/types";
import { useAdminDashboardData } from "@/features/admin/dashboard/hooks/useAdminDashboardData";

const mockGetAdminDashboardRepo = vi.fn();

vi.mock("@/lib/repos/admin-dashboard", () => ({
  getAdminDashboardRepo: () => mockGetAdminDashboardRepo(),
}));

const initialFilters: AdminDashboardFilters = {
  dateFrom: "2026-03-01",
  dateTo: "2026-03-14",
  lguScope: "all",
  lguId: null,
  aipStatus: "all",
};

const initialSnapshot: AdminDashboardSnapshot = {
  summary: {
    totalLgus: 12,
    activeUsers: 31,
    flaggedComments: 2,
    reviewBacklog: 5,
    deltaLabels: {
      totalLgus: "+0%",
      activeUsers: "+0%",
      flaggedComments: "+0%",
      reviewBacklog: "+0%",
    },
    elevatedFlags: {
      flaggedComments: false,
      reviewBacklog: true,
    },
  },
  distribution: [],
  reviewBacklog: {
    awaitingCount: 4,
    awaitingOldestDays: 3,
    stuckCount: 1,
    stuckOlderThanDays: 7,
  },
  usageMetrics: {
    errorRateTrend: [],
    chatbotUsageTrend: [],
    avgDailyRequests: 120,
    totalRequests: 1680,
    errorRate: 0.02,
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

describe("useAdminDashboardData initial snapshot hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminDashboardRepo.mockReturnValue({
      getSummary: vi.fn().mockResolvedValue(initialSnapshot.summary),
      getAipStatusDistribution: vi.fn().mockResolvedValue(initialSnapshot.distribution),
      getReviewBacklog: vi.fn().mockResolvedValue(initialSnapshot.reviewBacklog),
      getUsageMetrics: vi.fn().mockResolvedValue(initialSnapshot.usageMetrics),
      getRecentActivity: vi.fn().mockResolvedValue(initialSnapshot.recentActivity),
      listLguOptions: vi.fn().mockResolvedValue(initialSnapshot.lguOptions),
    });
  });

  it("uses SSR snapshot immediately without initial empty-state fetches", async () => {
    const repo = mockGetAdminDashboardRepo();
    const { result } = renderHook(
      () => useAdminDashboardData({ filters: initialFilters, snapshot: initialSnapshot }),
      { wrapper: StrictMode }
    );

    expect(result.current.summary).toEqual(initialSnapshot.summary);
    expect(result.current.loading).toBe(false);

    await waitFor(() => {
      expect(repo.getSummary).not.toHaveBeenCalled();
      expect(repo.getAipStatusDistribution).not.toHaveBeenCalled();
      expect(repo.getReviewBacklog).not.toHaveBeenCalled();
      expect(repo.getUsageMetrics).not.toHaveBeenCalled();
      expect(repo.getRecentActivity).not.toHaveBeenCalled();
      expect(repo.listLguOptions).not.toHaveBeenCalled();
    });
  });

  it("fetches reactive metrics after filters change and resolves loading state", async () => {
    const repo = mockGetAdminDashboardRepo();
    const { result } = renderHook(() =>
      useAdminDashboardData({ filters: initialFilters, snapshot: initialSnapshot })
    );

    act(() => {
      result.current.setFilters({
        ...initialFilters,
        dateFrom: "2026-03-02",
      });
    });

    await waitFor(() => {
      expect(repo.getSummary).toHaveBeenCalledTimes(1);
      expect(repo.getAipStatusDistribution).toHaveBeenCalledTimes(1);
      expect(repo.getReviewBacklog).toHaveBeenCalledTimes(1);
      expect(repo.getUsageMetrics).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setFilters(initialFilters);
    });

    await waitFor(() => {
      expect(repo.getSummary).toHaveBeenCalledTimes(2);
      expect(repo.getAipStatusDistribution).toHaveBeenCalledTimes(2);
      expect(repo.getReviewBacklog).toHaveBeenCalledTimes(2);
      expect(repo.getUsageMetrics).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });
});
