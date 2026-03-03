import type {
  ActivityLogRow,
  ChatMessageRow,
  ChatRateEventRow,
  Json,
} from "@/lib/contracts/databasev2";
import type { BlockedUsersSetting } from "@/lib/settings/app-settings";
import type {
  FeedbackRecord,
  FlaggedUserRowVM,
  ProfileRecord,
  RateLimitSettingsVM,
  AuditEntryVM,
  ChatbotMetrics,
  ChatbotRateLimitPolicy,
} from "@/lib/repos/usage-controls/types";

const getMetadataString = (metadata: Json, key: string): string | null => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
};

const getMetadataNumber = (metadata: Json, key: string): number | null => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
};

const formatShortDate = (iso: string) => iso.slice(0, 10);

const formatAccountType = (role: string | null | undefined) => {
  if (!role) return "User";
  if (role.includes("official")) return "Official";
  if (role === "citizen") return "Citizen";
  if (role === "admin") return "Admin";
  return "User";
};

const getLatestLog = (logs: ActivityLogRow[]) =>
  logs
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ??
  null;

export function deriveRateLimitSettings(activity: ActivityLogRow[]): RateLimitSettingsVM {
  const latest = getLatestLog(activity.filter((log) => log.action === "comment_rate_limit_updated"));

  const maxComments =
    (latest ? getMetadataNumber(latest.metadata, "max_comments") : null) ?? 5;
  const timeWindow =
    (latest ? getMetadataString(latest.metadata, "time_window") : null) === "day"
      ? "day"
      : "hour";

  return {
    maxComments,
    timeWindow,
    updatedAt: latest?.created_at ?? new Date().toISOString(),
    updatedBy: latest ? getMetadataString(latest.metadata, "actor_name") : null,
  };
}

export function mapFlaggedUsers(input: {
  profiles: ProfileRecord[];
  feedback: FeedbackRecord[];
  activity: ActivityLogRow[];
  blockedUsers: BlockedUsersSetting;
}): FlaggedUserRowVM[] {
  const feedbackById = new Map(input.feedback.map((row) => [row.id, row]));
  const hiddenLogs = input.activity.filter((log) => log.action === "feedback_hidden");

  const flagCountByUser = new Map<string, number>();
  const lastHiddenByUser = new Map<string, ActivityLogRow>();

  hiddenLogs.forEach((log) => {
    if (!log.entity_id) return;
    const feedback = feedbackById.get(log.entity_id);
    const authorId = feedback?.author_id;
    if (!authorId) return;

    flagCountByUser.set(authorId, (flagCountByUser.get(authorId) ?? 0) + 1);

    const currentLast = lastHiddenByUser.get(authorId);
    if (!currentLast || currentLast.created_at < log.created_at) {
      lastHiddenByUser.set(authorId, log);
    }
  });

  const userActions = input.activity.filter(
    (log) => log.entity_table === "profiles" && log.entity_id
  );

  return input.profiles
    .map((profile) => {
      const flags = flagCountByUser.get(profile.id) ?? 0;
      const lastHidden = lastHiddenByUser.get(profile.id);
      const defaultReason = "Policy violation";

      const userLogs = userActions.filter((log) => log.entity_id === profile.id);
      const latestUserLog = getLatestLog(
        userLogs.filter((log) => log.action === "user_blocked" || log.action === "user_unblocked")
      );

      const blockedSetting = input.blockedUsers[profile.id];
      const blockedUntilRaw = blockedSetting?.blockedUntil ?? null;
      const blockedUntilMs = blockedUntilRaw ? new Date(blockedUntilRaw).getTime() : Number.NaN;
      const isBlocked =
        Boolean(blockedSetting) &&
        Number.isFinite(blockedUntilMs) &&
        blockedUntilMs > Date.now();
      const blockedUntil = isBlocked ? blockedUntilRaw : null;
      const blockReason = isBlocked
        ? blockedSetting?.reason ?? null
        : latestUserLog?.action === "user_blocked"
          ? getMetadataString(latestUserLog.metadata, "reason")
          : null;

      const reasonSummary =
        (lastHidden ? getMetadataString(lastHidden.metadata, "reason") : null) ??
        blockReason ??
        defaultReason;

      return {
        userId: profile.id,
        name: profile.full_name ?? "Unknown User",
        accountType: formatAccountType(profile.role),
        reasonSummary,
        flags,
        lastFlagged: lastHidden
          ? formatShortDate(lastHidden.created_at)
          : latestUserLog
            ? formatShortDate(latestUserLog.created_at)
            : "-",
        status: isBlocked ? "Blocked" : "Active",
        blockedUntil,
      } satisfies FlaggedUserRowVM;
    })
    .filter((row) => row.flags > 0 || row.status === "Blocked")
    .sort((a, b) => b.flags - a.flags);
}

const getAuditTitle = (action: string) => {
  switch (action) {
    case "feedback_hidden":
      return "Feedback Marked as Hidden";
    case "feedback_unhidden":
      return "Feedback Restored";
    case "user_blocked":
      return "Account Temporarily Blocked";
    case "user_unblocked":
      return "Account Unblocked";
    case "comment_rate_limit_updated":
      return "Feedback Rate Limit Updated";
    default:
      return action;
  }
};

export function mapUserAuditHistory(input: {
  userId: string;
  feedback: FeedbackRecord[];
  activity: ActivityLogRow[];
}): AuditEntryVM[] {
  const feedbackById = new Map(input.feedback.map((row) => [row.id, row]));

  const relevantLogs = input.activity.filter((log) => {
    if (log.action === "feedback_hidden" || log.action === "feedback_unhidden") {
      if (!log.entity_id) return false;
      const feedback = feedbackById.get(log.entity_id);
      return feedback?.author_id === input.userId;
    }

    if (log.action === "user_blocked" || log.action === "user_unblocked") {
      return log.entity_id === input.userId;
    }

    return false;
  });

  return relevantLogs
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((log) => ({
      id: log.id,
      title: getAuditTitle(log.action),
      timestamp: log.created_at,
      performedBy:
        getMetadataString(log.metadata, "actor_name") ??
        (log.actor_id ? `User ${log.actor_id}` : "System"),
      violationCategory: getMetadataString(log.metadata, "violation_category"),
      details: getMetadataString(log.metadata, "reason") ?? getMetadataString(log.metadata, "details"),
      status:
        log.action === "feedback_hidden"
          ? "Hidden"
          : log.action === "feedback_unhidden"
            ? "Visible"
            : log.action === "user_blocked"
              ? "Blocked"
              : log.action === "user_unblocked"
                ? "Active"
                : null,
    }));
}

export function deriveChatbotRateLimitPolicy(
  activity: ActivityLogRow[]
): ChatbotRateLimitPolicy {
  const latest = getLatestLog(
    activity.filter((log) => log.action === "chatbot_rate_limit_updated")
  );

  const maxRequests =
    (latest ? getMetadataNumber(latest.metadata, "max_requests") : null) ?? 20;
  const rawWindow = latest ? getMetadataString(latest.metadata, "time_window") : null;
  const timeWindow = rawWindow === "per_day" ? "per_day" : "per_hour";

  return {
    maxRequests,
    timeWindow,
    updatedAt: latest?.created_at ?? new Date().toISOString(),
    updatedBy: latest ? getMetadataString(latest.metadata, "actor_name") : null,
  };
}

function isWithinWindow(
  iso: string,
  startInclusive: number,
  endExclusive: number
): boolean {
  const time = new Date(iso).getTime();
  return Number.isFinite(time) && time >= startInclusive && time < endExclusive;
}

function calculateTrendPct(current: number, previous: number): number {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }
  return ((current - previous) / previous) * 100;
}

const FAILURE_REASONS = new Set(["pipeline_error", "validation_failed", "unknown"]);
const DAY_MS = 24 * 60 * 60 * 1000;

function isSystemFailureMessage(row: ChatMessageRow): boolean {
  if (row.role !== "assistant") return false;
  if (!row.retrieval_meta || typeof row.retrieval_meta !== "object" || Array.isArray(row.retrieval_meta)) {
    return false;
  }

  const reason = (row.retrieval_meta as Record<string, unknown>).reason;
  return typeof reason === "string" && FAILURE_REASONS.has(reason);
}

function parseYmdUtcStart(value: string | null | undefined): number | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function deriveChatbotMetrics(input: {
  chatRateEvents: ChatRateEventRow[];
  chatMessages: ChatMessageRow[];
  periodDays?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
}): ChatbotMetrics {
  const defaultPeriodDays = input.periodDays ?? 14;
  const dateFromStart = parseYmdUtcStart(input.dateFrom);
  const dateToStart = parseYmdUtcStart(input.dateTo);
  const hasExplicitWindow =
    dateFromStart !== null && dateToStart !== null && dateToStart >= dateFromStart;
  const explicitStart = hasExplicitWindow ? dateFromStart : 0;
  const explicitEnd = hasExplicitWindow ? dateToStart : 0;

  const periodDays = hasExplicitWindow
    ? Math.max(1, Math.floor((explicitEnd - explicitStart) / DAY_MS) + 1)
    : defaultPeriodDays;
  const windowMs = periodDays * DAY_MS;

  const currentStart = hasExplicitWindow ? explicitStart : Date.now() - windowMs;
  const currentEndExclusive = hasExplicitWindow ? explicitEnd + DAY_MS : Date.now() + 1;
  const previousStart = currentStart - windowMs;

  const acceptedCurrent = input.chatRateEvents.filter(
    (row) =>
      row.event_status === "accepted" &&
      isWithinWindow(row.created_at, currentStart, currentEndExclusive)
  ).length;
  const acceptedPrevious = input.chatRateEvents.filter(
    (row) =>
      row.event_status === "accepted" &&
      isWithinWindow(row.created_at, previousStart, currentStart)
  ).length;

  const failuresCurrent = input.chatMessages.filter(
    (row) =>
      isSystemFailureMessage(row) &&
      isWithinWindow(row.created_at, currentStart, currentEndExclusive)
  ).length;
  const failuresPrevious = input.chatMessages.filter(
    (row) =>
      isSystemFailureMessage(row) &&
      isWithinWindow(row.created_at, previousStart, currentStart)
  ).length;

  const totalRequests = acceptedCurrent;
  const previousTotalRequests = acceptedPrevious;
  const errorRate = totalRequests === 0 ? 0 : failuresCurrent / totalRequests;
  const previousErrorRate =
    previousTotalRequests === 0 ? 0 : failuresPrevious / previousTotalRequests;
  const avgDailyRequests = periodDays > 0 ? totalRequests / periodDays : totalRequests;
  const previousAvgDaily =
    periodDays > 0 ? previousTotalRequests / periodDays : previousTotalRequests;

  return {
    totalRequests,
    errorRate,
    avgDailyRequests,
    periodDays,
    trendTotalRequestsPct: calculateTrendPct(totalRequests, previousTotalRequests),
    trendErrorRatePct: calculateTrendPct(errorRate, previousErrorRate),
    trendAvgDailyPct: calculateTrendPct(avgDailyRequests, previousAvgDaily),
  };
}
