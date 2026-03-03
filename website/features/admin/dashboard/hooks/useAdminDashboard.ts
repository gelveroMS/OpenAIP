"use client";

import { useMemo } from "react";
import {
  useAdminDashboardData,
  type AdminDashboardInitialData,
} from "./useAdminDashboardData";
import { mapAdminDashboardToVM } from "@/lib/mappers/dashboard/admin";

export function useAdminDashboard(initial?: AdminDashboardInitialData) {
  const {
    filters,
    setFilters,
    summary,
    distribution,
    reviewBacklog,
    usageMetrics,
    recentActivity,
    lguOptions,
    loading,
    error,
    createDefaultFilters,
  } = useAdminDashboardData(initial);

  const viewModel = useMemo(
    () =>
      mapAdminDashboardToVM({
        filters,
        summary,
        distribution,
        reviewBacklog,
        usageMetrics,
        recentActivity,
        lguOptions,
      }),
    [
      filters,
      summary,
      distribution,
      reviewBacklog,
      usageMetrics,
      recentActivity,
      lguOptions,
    ]
  );

  const handleReset = () => setFilters(createDefaultFilters());

  return {
    filters,
    setFilters,
    viewModel,
    loading,
    error,
    handleReset,
    createDefaultFilters,
  };
}
