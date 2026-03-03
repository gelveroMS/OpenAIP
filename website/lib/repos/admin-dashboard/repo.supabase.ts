import type {
  AdminDashboardFilters,
  AdminDashboardRepo,
  AdminDashboardSnapshot,
} from "./types";

const RETRYABLE_STATUS_CODES = new Set([401, 403]);
const RETRY_DELAYS_MS = [200, 400, 800];
const DASHBOARD_ROUTE_PATH = "/api/admin/dashboard";

const inFlightSnapshotRequests = new Map<string, Promise<AdminDashboardSnapshot>>();

type SnapshotErrorPayload = {
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAdminDashboardSnapshot(payload: unknown): payload is AdminDashboardSnapshot {
  if (!isRecord(payload)) return false;
  return (
    isRecord(payload.summary) &&
    Array.isArray(payload.distribution) &&
    isRecord(payload.reviewBacklog) &&
    isRecord(payload.usageMetrics) &&
    Array.isArray(payload.recentActivity) &&
    Array.isArray(payload.lguOptions)
  );
}

function buildQuery(filters?: AdminDashboardFilters): string {
  if (!filters) return "";

  const params = new URLSearchParams();
  if (filters.dateFrom) params.set("from", filters.dateFrom);
  if (filters.dateTo) params.set("to", filters.dateTo);
  if (filters.lguScope !== "all") params.set("lguScope", filters.lguScope);
  if (filters.lguId) params.set("lguId", filters.lguId);
  if (filters.aipStatus !== "all") params.set("status", filters.aipStatus);

  return params.toString();
}

function buildCacheKey(filters?: AdminDashboardFilters): string {
  const query = buildQuery(filters);
  return query.length > 0 ? query : "__default__";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function requestSnapshot(
  filters?: AdminDashboardFilters,
  attempt = 0
): Promise<AdminDashboardSnapshot> {
  const query = buildQuery(filters);
  const url = query.length > 0 ? `${DASHBOARD_ROUTE_PATH}?${query}` : DASHBOARD_ROUTE_PATH;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | unknown
    | SnapshotErrorPayload
    | null;

  if (response.ok && isAdminDashboardSnapshot(payload)) {
    return payload;
  }

  const invalidAuthResponse = response.ok && !isAdminDashboardSnapshot(payload);
  const shouldRetry =
    attempt < RETRY_DELAYS_MS.length &&
    // After auth transitions, the first client request can briefly observe stale auth/cached payloads.
    (RETRYABLE_STATUS_CODES.has(response.status) || invalidAuthResponse);

  if (shouldRetry) {
    await delay(RETRY_DELAYS_MS[attempt]);
    return requestSnapshot(filters, attempt + 1);
  }

  if (invalidAuthResponse) {
    throw new Error("Dashboard request returned an invalid payload.");
  }

  throw new Error((payload as SnapshotErrorPayload | null)?.message ?? "Dashboard request failed.");
}

function getSnapshot(filters?: AdminDashboardFilters): Promise<AdminDashboardSnapshot> {
  const key = buildCacheKey(filters);
  const existingRequest = inFlightSnapshotRequests.get(key);
  if (existingRequest) {
    return existingRequest;
  }

  const nextRequest = requestSnapshot(filters).finally(() => {
    inFlightSnapshotRequests.delete(key);
  });
  inFlightSnapshotRequests.set(key, nextRequest);

  return nextRequest;
}

export function createSupabaseAdminDashboardRepo(): AdminDashboardRepo {
  return {
    async getSummary(filters) {
      return (await getSnapshot(filters)).summary;
    },
    async getAipStatusDistribution(filters) {
      return (await getSnapshot(filters)).distribution;
    },
    async getReviewBacklog(filters) {
      return (await getSnapshot(filters)).reviewBacklog;
    },
    async getUsageMetrics(filters) {
      return (await getSnapshot(filters)).usageMetrics;
    },
    async getRecentActivity(filters) {
      return (await getSnapshot(filters)).recentActivity;
    },
    async listLguOptions() {
      return (await getSnapshot()).lguOptions;
    },
  };
}

