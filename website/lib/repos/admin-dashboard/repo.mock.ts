import { ADMIN_DASHBOARD_DATASET } from "@/mocks/fixtures/admin/admin-dashboard/adminDashboard.mock";
import type { AdminDashboardRepo, AdminDashboardFilters } from "./types";
import {
  deriveAipStatusDistribution,
  deriveRecentActivity,
  deriveReviewBacklog,
  deriveSummary,
  deriveUsageMetrics,
  listLguOptions,
} from "./mappers/admin-dashboard.mapper";

export function createMockAdminDashboardRepo(): AdminDashboardRepo {
  return {
    async getSummary(filters: AdminDashboardFilters) {
      return deriveSummary(ADMIN_DASHBOARD_DATASET, filters);
    },
    async getAipStatusDistribution(filters: AdminDashboardFilters) {
      return deriveAipStatusDistribution(ADMIN_DASHBOARD_DATASET, filters);
    },
    async getReviewBacklog(filters: AdminDashboardFilters) {
      return deriveReviewBacklog(ADMIN_DASHBOARD_DATASET, filters);
    },
    async getUsageMetrics(
      filters: AdminDashboardFilters,
      input?: { usageFrom?: string | null; usageTo?: string | null }
    ) {
      return deriveUsageMetrics(ADMIN_DASHBOARD_DATASET, filters, input);
    },
    async getRecentActivity(filters: AdminDashboardFilters) {
      return deriveRecentActivity(ADMIN_DASHBOARD_DATASET, filters);
    },
    async listLguOptions() {
      return listLguOptions(ADMIN_DASHBOARD_DATASET);
    },
  };
}

