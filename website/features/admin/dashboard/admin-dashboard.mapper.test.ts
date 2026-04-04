import { describe, expect, it } from "vitest";
import type { AdminDashboardDataset, AdminDashboardFilters } from "@/lib/repos/admin-dashboard/types";
import {
  deriveSummary,
  deriveUsageMetrics,
} from "@/lib/repos/admin-dashboard/mappers/admin-dashboard.mapper";

const baseFilters: AdminDashboardFilters = {
  dateFrom: null,
  dateTo: null,
  lguScope: "all",
  lguId: null,
  aipStatus: "all",
};

const dataset: AdminDashboardDataset = {
  cities: [
    {
      id: "city_1",
      region_id: "region_1",
      province_id: null,
      psgc_code: "130000001",
      name: "Metro City",
      is_independent: true,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
  ],
  provinces: [
    {
      id: "province_1",
      region_id: "region_1",
      psgc_code: "0421",
      name: "Cavite",
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
  ],
  municipalities: [
    {
      id: "municipality_1",
      province_id: "province_1",
      psgc_code: "0421001",
      name: "Silang",
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
  ],
  barangays: [
    {
      id: "barangay_1",
      city_id: "city_1",
      municipality_id: null,
      psgc_code: "130000001001",
      name: "Barangay Uno",
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
  ],
  profiles: [],
  aips: [],
  feedback: [],
  activity: [],
  chatMessages: [
    {
      id: "chat_1",
      session_id: "session_1",
      role: "assistant",
      content: "ok",
      citations: null,
      retrieval_meta: { is_error: true },
      created_at: "2026-01-01T08:00:00.000Z",
    },
    {
      id: "chat_2",
      session_id: "session_1",
      role: "assistant",
      content: "ok",
      citations: null,
      retrieval_meta: null,
      created_at: "2026-01-03T08:00:00.000Z",
    },
  ],
};

describe("admin dashboard mapper", () => {
  it("counts provinces in total LGUs", () => {
    const summary = deriveSummary(dataset, baseFilters);
    expect(summary.totalLgus).toBe(4);
  });

  it("uses full available chat history window by default and exposes date keys", () => {
    const metrics = deriveUsageMetrics(dataset, baseFilters);

    expect(metrics.totalRequests).toBe(2);
    expect(metrics.periodDays).toBe(3);
    expect(metrics.avgDailyRequests).toBeCloseTo(2 / 3, 5);
    expect(metrics.chatbotUsageTrend.every((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.dateKey))).toBe(
      true
    );
  });

  it("honors usageFrom and usageTo query window", () => {
    const metrics = deriveUsageMetrics(dataset, baseFilters, {
      usageFrom: "2026-01-02",
      usageTo: "2026-01-03",
    });

    expect(metrics.totalRequests).toBe(1);
    expect(metrics.periodDays).toBe(2);
    expect(metrics.chatbotUsageTrend).toHaveLength(2);
  });
});

