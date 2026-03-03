import AdminDashboardPageClient from "./admin-dashboard-page-client";
import {
  createDefaultAdminDashboardFilters,
  loadAdminDashboardSnapshot,
  parseAdminDashboardFilters,
  type AdminDashboardSearchParams,
} from "@/lib/repos/admin-dashboard/snapshot.server";

export const dynamic = "force-dynamic";

type AdminDashboardPageProps = {
  searchParams?: Promise<AdminDashboardSearchParams> | AdminDashboardSearchParams;
};

export default async function AdminDashboardPage({ searchParams }: AdminDashboardPageProps) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const defaultFilters = createDefaultAdminDashboardFilters();
  const initialFilters = parseAdminDashboardFilters(resolvedSearchParams, defaultFilters);
  const initialSnapshot = await loadAdminDashboardSnapshot(initialFilters);

  return (
    <AdminDashboardPageClient
      initialFilters={initialFilters}
      initialSnapshot={initialSnapshot}
    />
  );
}
