import AdminDashboardPageClient from "./admin-dashboard-page-client";
import {
  createDefaultAdminDashboardFilters,
  loadAdminDashboardSnapshot,
} from "@/lib/repos/admin-dashboard/snapshot.server";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const defaultFilters = createDefaultAdminDashboardFilters();
  const initialFilters = defaultFilters;
  const initialSnapshot = await loadAdminDashboardSnapshot(initialFilters);

  return (
    <AdminDashboardPageClient
      initialFilters={initialFilters}
      initialSnapshot={initialSnapshot}
    />
  );
}
