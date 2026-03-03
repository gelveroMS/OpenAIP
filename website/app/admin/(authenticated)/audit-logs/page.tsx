import AdminAuditLogsView from "@/features/admin/audit-logs/views/admin-audit-logs-view";
import { getAdminAuditFeedPage } from "@/lib/repos/audit/queries";

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const { filters, result } = await getAdminAuditFeedPage(resolvedSearchParams);

  return (
    <AdminAuditLogsView
      logs={result.rows}
      total={result.total}
      filters={filters}
    />
  );
}
