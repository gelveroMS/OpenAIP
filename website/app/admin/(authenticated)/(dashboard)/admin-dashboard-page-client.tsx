"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import AdminDashboardView from "@/features/admin/dashboard/views/admin-dashboard-view";
import type { AdminDashboardActions } from "@/features/admin/dashboard/types/dashboard-actions";
import type {
  AdminDashboardFilters,
  AdminDashboardSnapshot,
} from "@/lib/repos/admin-dashboard/types";

type AdminDashboardPageClientProps = {
  initialFilters: AdminDashboardFilters;
  initialSnapshot: AdminDashboardSnapshot;
};

function buildDashboardQuery(filters: AdminDashboardFilters, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set("from", filters.dateFrom);
  if (filters.dateTo) params.set("to", filters.dateTo);
  if (filters.lguScope !== "all") params.set("lguScope", filters.lguScope);
  if (filters.lguId) params.set("lguId", filters.lguId);
  if (filters.aipStatus !== "all") params.set("status", filters.aipStatus);
  if (extra) {
    Object.entries(extra).forEach(([key, value]) => params.set(key, value));
  }
  return params.toString();
}

export default function AdminDashboardPageClient({
  initialFilters,
  initialSnapshot,
}: AdminDashboardPageClientProps) {
  const router = useRouter();

  const handleFiltersChange = useCallback((filters: AdminDashboardFilters) => {
    const query = buildDashboardQuery(filters);
    const nextUrl = query.length > 0 ? `/admin?${query}` : "/admin";
    if (window.location.pathname + window.location.search === nextUrl) return;
    // Persist filter state in the URL without forcing a client navigation or RSC refetch.
    window.history.replaceState(null, "", nextUrl);
  }, []);

  const actions = useMemo<AdminDashboardActions>(
    () => ({
      onOpenLguManagement: ({ filters }) => {
        router.push(`/admin/lgu-management?${buildDashboardQuery(filters)}`);
      },
      onOpenAccounts: ({ filters }) => {
        router.push(`/admin/account-administration?${buildDashboardQuery(filters)}`);
      },
      onOpenFeedbackModeration: ({ filters }) => {
        router.push(`/admin/feedback-moderation?${buildDashboardQuery(filters)}`);
      },
      onOpenAipMonitoring: ({ filters, status }) => {
        const query = buildDashboardQuery(filters, status ? { status } : undefined);
        router.push(`/admin/aip-monitoring?${query}`);
      },
      onOpenAuditLogs: ({ filters }) => {
        router.push(`/admin/audit-logs?${buildDashboardQuery(filters)}`);
      },
    }),
    [router]
  );

  return (
    <AdminDashboardView
      actions={actions}
      onFiltersChange={handleFiltersChange}
      initialData={{ filters: initialFilters, snapshot: initialSnapshot }}
    />
  );
}
