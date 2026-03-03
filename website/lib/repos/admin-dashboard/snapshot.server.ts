import "server-only";

import type { AipStatus } from "@/lib/contracts/databasev2/enums";
import {
  getDateDaysAgoInTimeZoneYmd,
  getTodayInTimeZoneYmd,
} from "@/lib/date/localDate";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  deriveAipStatusDistribution,
  deriveRecentActivity,
  deriveReviewBacklog,
  deriveSummary,
  deriveUsageMetrics,
  listLguOptions,
} from "./mappers/admin-dashboard.mapper";
import type {
  AdminDashboardDataset,
  AdminDashboardFilters,
  AdminDashboardSnapshot,
} from "./types";

const ASIA_MANILA_TIMEZONE = "Asia/Manila";
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AIP_STATUSES: ReadonlySet<AipStatus> = new Set([
  "draft",
  "pending_review",
  "under_review",
  "for_revision",
  "published",
]);

export type AdminDashboardSearchParams = Record<string, string | string[] | undefined>;

const API_DEFAULT_FILTERS: AdminDashboardFilters = {
  dateFrom: null,
  dateTo: null,
  lguScope: "all",
  lguId: null,
  aipStatus: "all",
};

function readParam(
  params: URLSearchParams | AdminDashboardSearchParams,
  key: string
): string | null {
  if (params instanceof URLSearchParams) {
    return params.get(key);
  }

  const value = params[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function parseYmd(value: string | null): string | null {
  if (!value) return null;
  return YMD_PATTERN.test(value) ? value : null;
}

function parseLguScope(value: string | null): AdminDashboardFilters["lguScope"] {
  if (value === "city" || value === "municipality" || value === "barangay") {
    return value;
  }
  return "all";
}

function parseAipStatus(value: string | null): AdminDashboardFilters["aipStatus"] {
  if (value && AIP_STATUSES.has(value as AipStatus)) {
    return value as AipStatus;
  }
  return "all";
}

export function createDefaultAdminDashboardFilters(): AdminDashboardFilters {
  return {
    dateFrom: getDateDaysAgoInTimeZoneYmd(ASIA_MANILA_TIMEZONE, 13),
    dateTo: getTodayInTimeZoneYmd(ASIA_MANILA_TIMEZONE),
    lguScope: "all",
    lguId: null,
    aipStatus: "all",
  };
}

export function parseAdminDashboardFilters(
  params: URLSearchParams | AdminDashboardSearchParams,
  fallback: AdminDashboardFilters = API_DEFAULT_FILTERS
): AdminDashboardFilters {
  const from = parseYmd(readParam(params, "from"));
  const to = parseYmd(readParam(params, "to"));
  const lguScope = parseLguScope(readParam(params, "lguScope"));
  const lguId = readParam(params, "lguId");
  const aipStatus = parseAipStatus(readParam(params, "status"));

  return {
    dateFrom: from ?? fallback.dateFrom,
    dateTo: to ?? fallback.dateTo,
    lguScope: lguScope === "all" ? fallback.lguScope : lguScope,
    lguId: lguId && lguId.trim().length > 0 ? lguId : fallback.lguId,
    aipStatus: aipStatus === "all" ? fallback.aipStatus : aipStatus,
  };
}

async function loadAdminDashboardDataset(): Promise<AdminDashboardDataset> {
  const admin = supabaseAdmin();
  const [
    citiesResult,
    municipalitiesResult,
    barangaysResult,
    profilesResult,
    aipsResult,
    feedbackResult,
    activityResult,
    chatMessagesResult,
  ] = await Promise.all([
    admin
      .from("cities")
      .select("id,region_id,province_id,psgc_code,name,is_independent,is_active,created_at"),
    admin
      .from("municipalities")
      .select("id,province_id,psgc_code,name,is_active,created_at"),
    admin
      .from("barangays")
      .select("id,city_id,municipality_id,psgc_code,name,is_active,created_at"),
    admin
      .from("profiles")
      .select(
        "id,role,full_name,email,barangay_id,city_id,municipality_id,is_active,created_at,updated_at"
      ),
    admin
      .from("aips")
      .select(
        "id,fiscal_year,barangay_id,city_id,municipality_id,status,status_updated_at,submitted_at,published_at,created_by,created_at,updated_at"
      ),
    admin
      .from("feedback")
      .select(
        "id,target_type,aip_id,project_id,parent_feedback_id,source,kind,extraction_run_id,extraction_artifact_id,field_key,severity,body,is_public,author_id,created_at,updated_at"
      ),
    admin
      .from("activity_log")
      .select(
        "id,actor_id,actor_role,action,entity_table,entity_id,region_id,province_id,city_id,municipality_id,barangay_id,metadata,created_at"
      ),
    admin
      .from("chat_messages")
      .select("id,session_id,role,content,citations,retrieval_meta,created_at"),
  ]);

  const firstError = [
    citiesResult,
    municipalitiesResult,
    barangaysResult,
    profilesResult,
    aipsResult,
    feedbackResult,
    activityResult,
    chatMessagesResult,
  ].find((result) => result.error)?.error;

  if (firstError) {
    throw new Error(firstError.message);
  }

  return {
    cities: (citiesResult.data ?? []) as AdminDashboardDataset["cities"],
    municipalities:
      (municipalitiesResult.data ?? []) as AdminDashboardDataset["municipalities"],
    barangays: (barangaysResult.data ?? []) as AdminDashboardDataset["barangays"],
    profiles: (profilesResult.data ?? []) as AdminDashboardDataset["profiles"],
    aips: (aipsResult.data ?? []) as AdminDashboardDataset["aips"],
    feedback: (feedbackResult.data ?? []) as AdminDashboardDataset["feedback"],
    activity: (activityResult.data ?? []) as AdminDashboardDataset["activity"],
    chatMessages: (chatMessagesResult.data ?? []) as AdminDashboardDataset["chatMessages"],
  };
}

export async function loadAdminDashboardSnapshot(
  filters: AdminDashboardFilters
): Promise<AdminDashboardSnapshot> {
  const dataset = await loadAdminDashboardDataset();

  return {
    summary: deriveSummary(dataset, filters),
    distribution: deriveAipStatusDistribution(dataset, filters),
    reviewBacklog: deriveReviewBacklog(dataset, filters),
    usageMetrics: deriveUsageMetrics(dataset, filters),
    recentActivity: deriveRecentActivity(dataset, filters),
    lguOptions: listLguOptions(dataset),
  };
}
