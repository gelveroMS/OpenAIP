import { formatNumber } from "@/lib/formatting";
import type {
  AdminDashboardFilters,
  AipStatusDistributionVM,
  DashboardSummaryVM,
  LguOptionVM,
  RecentActivityItemVM,
  ReviewBacklogVM,
  UsageMetricsVM,
} from "@/lib/repos/admin-dashboard/types";
import type { AdminDashboardVM } from "@/lib/types/viewmodels/dashboard/admin-dashboard.vm";

const EMPTY_SUMMARY: DashboardSummaryVM = {
  totalLgus: 0,
  activeUsers: 0,
  flaggedComments: 0,
  reviewBacklog: 0,
  deltaLabels: {
    totalLgus: "",
    activeUsers: "",
    flaggedComments: "",
    reviewBacklog: "",
  },
  elevatedFlags: { flaggedComments: false, reviewBacklog: false },
};

type MapAdminDashboardVMInput = {
  filters: AdminDashboardFilters;
  summary: DashboardSummaryVM | null;
  distribution: AipStatusDistributionVM[];
  reviewBacklog: ReviewBacklogVM | null;
  usageMetrics: UsageMetricsVM | null;
  recentActivity: RecentActivityItemVM[];
  lguOptions: LguOptionVM[];
};

export function mapAdminDashboardToVM({
  filters,
  summary,
  distribution,
  reviewBacklog,
  usageMetrics,
  recentActivity,
  lguOptions,
}: MapAdminDashboardVMInput): AdminDashboardVM {
  const safeSummary = summary ?? EMPTY_SUMMARY;

  const queryParams = new URLSearchParams();
  if (filters.dateFrom) queryParams.set("from", filters.dateFrom);
  if (filters.dateTo) queryParams.set("to", filters.dateTo);
  if (filters.lguScope !== "all") queryParams.set("lguScope", filters.lguScope);
  if (filters.lguId) queryParams.set("lguId", filters.lguId);
  if (filters.aipStatus !== "all") queryParams.set("status", filters.aipStatus);
  const baseQuery = queryParams.toString();

  return {
    safeSummary,
    distribution,
    reviewBacklog,
    usageMetrics,
    recentActivity,
    lguOptions,
    kpis: [
      {
        title: "Total LGUs",
        value: formatNumber(safeSummary.totalLgus),
        deltaLabel: safeSummary.deltaLabels.totalLgus,
        iconClassName: "bg-blue-50 text-blue-600",
        ctaLabel: "View LGUs",
        path: `/admin/lgu-management?${baseQuery}`,
      },
      {
        title: "Active Users",
        value: formatNumber(safeSummary.activeUsers),
        deltaLabel: safeSummary.deltaLabels.activeUsers,
        iconClassName: "bg-emerald-50 text-emerald-600",
        ctaLabel: "View Accounts",
        path: `/admin/account-administration?${baseQuery}`,
      },
      {
        title: "Flagged Feedback",
        value: formatNumber(safeSummary.flaggedComments),
        deltaLabel: safeSummary.deltaLabels.flaggedComments,
        iconClassName: "bg-amber-50 text-amber-600",
        ctaLabel: "View Content",
        path: `/admin/feedback-moderation?${baseQuery}`,
        tagLabel: safeSummary.elevatedFlags.flaggedComments ? "Elevated" : undefined,
      },
      {
        title: "Review Backlog",
        value: formatNumber(safeSummary.reviewBacklog),
        deltaLabel: safeSummary.deltaLabels.reviewBacklog,
        iconClassName: "bg-rose-50 text-rose-600",
        ctaLabel: "View AIPs",
        path: `/admin/aip-monitoring?${baseQuery}`,
        tagLabel: safeSummary.elevatedFlags.reviewBacklog ? "Elevated" : undefined,
      },
    ],
  };
}
