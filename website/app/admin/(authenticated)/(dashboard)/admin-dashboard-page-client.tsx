"use client";

import { useMemo } from "react";
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

function buildPathWithQuery(path: string, query: string): string {
  return query.length > 0 ? `${path}?${query}` : path;
}

export default function AdminDashboardPageClient({
  initialFilters,
  initialSnapshot,
}: AdminDashboardPageClientProps) {
  const router = useRouter();

  const actions = useMemo<AdminDashboardActions>(
    () => ({
      onOpenLguManagement: ({ filters }) => {
        router.push(buildPathWithQuery("/admin/lgu-management", buildDashboardQuery(filters)));
      },
      onOpenAccounts: ({ filters }) => {
        router.push(buildPathWithQuery("/admin/account-administration", buildDashboardQuery(filters)));
      },
      onOpenFeedbackModeration: ({ filters }) => {
        router.push(buildPathWithQuery("/admin/feedback-moderation", buildDashboardQuery(filters)));
      },
      onOpenAipMonitoring: ({ filters, status }) => {
        const query = buildDashboardQuery(filters, status ? { status } : undefined);
        router.push(buildPathWithQuery("/admin/aip-monitoring", query));
      },
      onOpenAuditLogs: ({ filters }) => {
        router.push(buildPathWithQuery("/admin/audit-logs", buildDashboardQuery(filters)));
      },
    }),
    [router]
  );

  return (
    <AdminDashboardView
      actions={actions}
      initialData={{ filters: initialFilters, snapshot: initialSnapshot }}
    />
  );
}
