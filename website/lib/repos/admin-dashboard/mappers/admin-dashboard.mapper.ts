import type {
  AdminDashboardDataset,
  AdminDashboardFilters,
  AipStatusDistributionVM,
  DashboardSummaryVM,
  RecentActivityItemVM,
  ReviewBacklogVM,
  UsageMetricsVM,
  LguOptionVM,
} from "../types";
import type { AipRecord, ActivityLogRecord, ChatMessageRecord, ProfileRecord } from "../types";
import type { AipStatus } from "@/lib/contracts/databasev2/enums";
import { DASHBOARD_AIP_STATUS_CHART_COLORS } from "@/lib/ui/tokens";

const statusLabelMap: Record<AipStatus, string> = {
  draft: "Draft",
  pending_review: "Pending Review",
  under_review: "Under Review",
  for_revision: "For Revision",
  published: "Approved",
};

const toDate = (value: string) => new Date(value);

const isWithinRange = (dateIso: string, filters: AdminDashboardFilters) => {
  const date = toDate(dateIso);
  if (filters.dateFrom) {
    const start = new Date(filters.dateFrom);
    if (date < start) return false;
  }
  if (filters.dateTo) {
    const end = new Date(filters.dateTo);
    end.setHours(23, 59, 59, 999);
    if (date > end) return false;
  }
  return true;
};

const matchesScope = (
  scope: { city_id: string | null; municipality_id: string | null; barangay_id: string | null },
  filters: AdminDashboardFilters
) => {
  if (filters.lguId) {
    return (
      scope.city_id === filters.lguId ||
      scope.municipality_id === filters.lguId ||
      scope.barangay_id === filters.lguId
    );
  }
  if (filters.lguScope === "all") return true;
  if (filters.lguScope === "city") return scope.city_id !== null;
  if (filters.lguScope === "municipality") return scope.municipality_id !== null;
  return scope.barangay_id !== null;
};

const filterAips = (aips: AipRecord[], filters: AdminDashboardFilters) =>
  aips.filter((aip) => {
    if (!matchesScope(aip, filters)) return false;
    if (!isWithinRange(aip.status_updated_at, filters)) return false;
    if (filters.aipStatus !== "all" && aip.status !== filters.aipStatus) return false;
    return true;
  });

const filterActivity = (activity: ActivityLogRecord[], filters: AdminDashboardFilters) =>
  activity.filter((log) => {
    if (!matchesScope(log, filters)) return false;
    if (!isWithinRange(log.created_at, filters)) return false;
    return true;
  });

const filterProfiles = (profiles: ProfileRecord[], filters: AdminDashboardFilters) =>
  profiles.filter((profile) => {
    if (!matchesScope(profile, filters)) return false;
    if (!isWithinRange(profile.created_at, filters)) return false;
    return true;
  });

const filterChatMessages = (messages: ChatMessageRecord[], filters: AdminDashboardFilters) =>
  messages.filter((message) => isWithinRange(message.created_at, filters));

export const deriveSummary = (
  dataset: AdminDashboardDataset,
  filters: AdminDashboardFilters
): DashboardSummaryVM => {
  const totalLgus =
    filters.lguId !== null
      ? 1
      : filters.lguScope === "city"
      ? dataset.cities.filter((city) => city.is_active).length
      : filters.lguScope === "municipality"
      ? dataset.municipalities.filter((municipality) => municipality.is_active).length
      : filters.lguScope === "barangay"
      ? dataset.barangays.filter((barangay) => barangay.is_active).length
      : dataset.cities.filter((city) => city.is_active).length +
        dataset.municipalities.filter((municipality) => municipality.is_active).length +
        dataset.barangays.filter((barangay) => barangay.is_active).length;

  const activeUsers = filterProfiles(dataset.profiles, filters).filter(
    (profile) => profile.is_active
  ).length;

  const flaggedComments = filterActivity(dataset.activity, filters).filter(
    (log) => log.action === "feedback_hidden"
  ).length;

  const reviewBacklog = filterAips(dataset.aips, filters).filter((aip) =>
    ["pending_review", "under_review"].includes(aip.status)
  ).length;

  return {
    totalLgus,
    activeUsers,
    flaggedComments,
    reviewBacklog,
    deltaLabels: {
      totalLgus: "",
      activeUsers: "",
      flaggedComments: "",
      reviewBacklog: "",
    },
    elevatedFlags: {
      flaggedComments: flaggedComments > 10,
      reviewBacklog: reviewBacklog > 5,
    },
  };
};

export const deriveAipStatusDistribution = (
  dataset: AdminDashboardDataset,
  filters: AdminDashboardFilters
): AipStatusDistributionVM[] => {
  const filtered = filterAips(dataset.aips, filters);
  const counts = filtered.reduce<Record<AipStatus, number>>(
    (acc, aip) => {
      acc[aip.status] += 1;
      return acc;
    },
    {
      draft: 0,
      pending_review: 0,
      under_review: 0,
      for_revision: 0,
      published: 0,
    }
  );

  return (Object.keys(counts) as AipStatus[]).map((status) => ({
    status,
    label: statusLabelMap[status],
    count: counts[status],
    color: DASHBOARD_AIP_STATUS_CHART_COLORS[status],
  }));
};

export const deriveReviewBacklog = (
  dataset: AdminDashboardDataset,
  filters: AdminDashboardFilters
): ReviewBacklogVM => {
  const filtered = filterAips(dataset.aips, filters).filter((aip) =>
    ["pending_review", "under_review"].includes(aip.status)
  );
  const awaiting = filtered.filter((aip) => aip.status === "pending_review");
  const stuck = filtered.filter((aip) => {
    const days = (Date.now() - toDate(aip.status_updated_at).getTime()) / (1000 * 60 * 60 * 24);
    return days > 7;
  });

  const oldestDays = awaiting.length
    ? Math.round(
        Math.max(
          ...awaiting.map((aip) => (Date.now() - toDate(aip.status_updated_at).getTime()) / (1000 * 60 * 60 * 24))
        )
      )
    : 0;

  return {
    awaitingCount: awaiting.length,
    awaitingOldestDays: oldestDays,
    stuckCount: stuck.length,
    stuckOlderThanDays: 7,
  };
};

const buildDateSeries = (filters: AdminDashboardFilters, periodDays: number) => {
  const end = filters.dateTo ? new Date(filters.dateTo) : new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (periodDays - 1));
  return Array.from({ length: periodDays }).map((_, idx) => {
    const date = new Date(start);
    date.setDate(start.getDate() + idx);
    return date;
  });
};

export const deriveUsageMetrics = (
  dataset: AdminDashboardDataset,
  filters: AdminDashboardFilters
): UsageMetricsVM => {
  const periodDays = filters.dateFrom && filters.dateTo
    ? Math.max(
        1,
        Math.round(
          (toDate(filters.dateTo).getTime() - toDate(filters.dateFrom).getTime()) /
            (1000 * 60 * 60 * 24)
        ) + 1
      )
    : 14;

  const messages = filterChatMessages(dataset.chatMessages, filters);
  const totalRequests = messages.length;
  const errorRequests = messages.filter(
    (message) => (message.retrieval_meta as { is_error?: boolean } | null)?.is_error
  ).length;
  const errorRate = totalRequests ? errorRequests / totalRequests : 0;
  const avgDailyRequests = totalRequests / periodDays;

  const seriesDates = buildDateSeries(filters, periodDays);
  const countsByDay = new Map<string, { total: number; errors: number }>();

  seriesDates.forEach((date) => {
    countsByDay.set(date.toISOString().slice(0, 10), { total: 0, errors: 0 });
  });

  messages.forEach((message) => {
    const key = message.created_at.slice(0, 10);
    const entry = countsByDay.get(key);
    if (!entry) return;
    entry.total += 1;
    if ((message.retrieval_meta as { is_error?: boolean } | null)?.is_error) {
      entry.errors += 1;
    }
  });

  const errorRateTrend = seriesDates.map((date) => {
    const key = date.toISOString().slice(0, 10);
    const entry = countsByDay.get(key) ?? { total: 0, errors: 0 };
    const dailyRate = entry.total ? (entry.errors / entry.total) * 100 : 0;
    return {
      label: date.toLocaleDateString("en-PH", { month: "short", day: "numeric" }),
      value: Number(dailyRate.toFixed(2)),
    };
  });

  const chatbotUsageTrend = seriesDates.map((date) => {
    const key = date.toISOString().slice(0, 10);
    const entry = countsByDay.get(key) ?? { total: 0, errors: 0 };
    return {
      label: date.toLocaleDateString("en-PH", { month: "short", day: "numeric" }),
      value: entry.total,
    };
  });

  return {
    errorRateTrend,
    chatbotUsageTrend,
    avgDailyRequests,
    totalRequests,
    errorRate,
    deltaLabels: {
      avgDailyRequests: "+8.1%",
      totalRequests: "+12.3%",
      errorRate: "-0.4%",
    },
    periodDays,
  };
};

const mapActivityToItem = (log: ActivityLogRecord): RecentActivityItemVM => {
  const details = (log.metadata as { details?: string; actor_name?: string } | null) ?? {};
  const actorName = details.actor_name ?? log.actor_role ?? "System";
  switch (log.action) {
    case "feedback_hidden":
      return {
        id: log.id,
        title: "Comment Hidden",
        tagLabel: "Moderated",
        tagTone: "warning",
        reference: details.details ?? `Comment ${log.entity_id ?? ""}`.trim(),
        timestamp: log.created_at,
        performedBy: actorName,
        iconKey: "comment",
      };
    case "aip_locked":
      return {
        id: log.id,
        title: "Locked Workflow",
        tagLabel: "Locked",
        tagTone: "danger",
        reference: details.details ?? `AIP ${log.entity_id ?? ""}`.trim(),
        timestamp: log.created_at,
        performedBy: actorName,
        iconKey: "lock",
      };
    case "user_suspended":
    case "user_blocked":
      return {
        id: log.id,
        title: "Suspended Account",
        tagLabel: "Suspended",
        tagTone: "danger",
        reference: details.details ?? `User ${log.entity_id ?? ""}`.trim(),
        timestamp: log.created_at,
        performedBy: actorName,
        iconKey: "user",
      };
    case "aip_published":
    case "aip_approved":
      return {
        id: log.id,
        title: "AIP Approved",
        tagLabel: "Approved",
        tagTone: "success",
        reference: details.details ?? `AIP ${log.entity_id ?? ""}`.trim(),
        timestamp: log.created_at,
        performedBy: actorName,
        iconKey: "check",
      };
    default:
      return {
        id: log.id,
        title: "Operational Update",
        tagLabel: "Info",
        tagTone: "info",
        reference: details.details ?? log.action,
        timestamp: log.created_at,
        performedBy: actorName,
        iconKey: "alert",
      };
  }
};

export const deriveRecentActivity = (
  dataset: AdminDashboardDataset,
  filters: AdminDashboardFilters
): RecentActivityItemVM[] => {
  return filterActivity(dataset.activity, filters)
    .sort((a, b) => toDate(b.created_at).getTime() - toDate(a.created_at).getTime())
    .slice(0, 8)
    .map(mapActivityToItem);
};

export const listLguOptions = (dataset: AdminDashboardDataset): LguOptionVM[] => {
  const cityOptions = dataset.cities.map((city) => ({
    id: city.id,
    label: `City: ${city.name}`,
    scope: "city" as const,
  }));
  const municipalityOptions = dataset.municipalities.map((municipality) => ({
    id: municipality.id,
    label: `Municipality: ${municipality.name}`,
    scope: "municipality" as const,
  }));
  const barangayOptions = dataset.barangays.map((barangay) => ({
    id: barangay.id,
    label: `Barangay: ${barangay.name}`,
    scope: "barangay" as const,
  }));
  return [...cityOptions, ...municipalityOptions, ...barangayOptions];
};

