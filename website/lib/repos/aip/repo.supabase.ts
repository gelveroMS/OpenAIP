import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import type { Json } from "@/lib/contracts/databasev2";
import { assertFeedbackUsageAllowed } from "@/lib/feedback/usage-guards";
import type { AipProjectRepo, AipRepo } from "./repo";
import {
  BARANGAY_UPLOADER_WORKFLOW_LOCK_REASON,
  computeBarangayWorkflowPermission,
} from "./workflow-permissions.server";
import {
  applyProjectEditPatch,
  buildProjectReviewBody,
  deriveSectorFromRefCode,
  diffProjectEditableFields,
  normalizeProjectEditPatch,
  normalizeProjectErrors,
  projectEditableFieldsFromRow,
} from "./project-review";
import type {
  AipHeader,
  AipProjectFeedbackMessage,
  AipProjectFeedbackThread,
  AipProjectEditPatch,
  AipProjectReviewDetail,
  AipProjectRow,
  AipRevisionFeedbackCycle,
  AipRevisionFeedbackMessage,
  ProjectCategory,
} from "./types";

type ScopeRow = { name: string | null } | null;

type AipSelectRow = {
  id: string;
  fiscal_year: number;
  status: "draft" | "pending_review" | "under_review" | "for_revision" | "published";
  created_by: string | null;
  created_at: string;
  published_at: string | null;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
  barangay: ScopeRow | ScopeRow[];
  city: ScopeRow | ScopeRow[];
  municipality: ScopeRow | ScopeRow[];
};

type UploadedFileSelectRow = {
  id: string;
  aip_id: string;
  bucket_id: string;
  object_name: string;
  original_file_name: string | null;
  uploaded_by: string;
  created_at: string;
  is_current: boolean;
};

type ArtifactSelectRow = {
  aip_id: string;
  artifact_json: Json | null;
  artifact_text: string | null;
  created_at: string;
};

type ProjectSelectRow = {
  id: string;
  aip_id: string;
  aip_ref_code: string;
  program_project_description: string;
  implementing_agency: string | null;
  start_date: string | null;
  completion_date: string | null;
  expected_output: string | null;
  source_of_funds: string | null;
  personal_services: number | null;
  maintenance_and_other_operating_expenses: number | null;
  financial_expenses: number | null;
  capital_outlay: number | null;
  total: number | null;
  climate_change_adaptation: string | null;
  climate_change_mitigation: string | null;
  cc_topology_code: string | null;
  prm_ncr_lgu_rm_objective_results_indicator: string | null;
  category: ProjectCategory;
  sector_code: string;
  errors: Json | null;
  is_human_edited?: boolean;
  edited_by?: string | null;
  edited_at?: string | null;
};

type AipRevisionReviewSelectRow = {
  id: string;
  aip_id: string;
  note: string | null;
  reviewer_id: string | null;
  created_at: string;
};

type AipPublishedReviewSelectRow = {
  id: string;
  aip_id: string;
  reviewer_id: string;
  created_at: string;
};

type AipRevisionReplySelectRow = {
  id: string;
  aip_id: string | null;
  body: string;
  author_id: string | null;
  created_at: string;
};

type AipRevisionFeedbackMessageByAip = AipRevisionFeedbackMessage & {
  aipId: string;
};

type ExtractionRunSelectRow = {
  id: string;
  aip_id: string;
  stage: "extract" | "validate" | "summarize" | "categorize" | "embed";
  status: "queued" | "running" | "succeeded" | "failed";
  overall_progress_pct: number | null;
  progress_message: string | null;
  error_message?: string | null;
  progress_updated_at?: string | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  role:
    | "citizen"
    | "barangay_official"
    | "city_official"
    | "municipal_official"
    | "admin";
};

type ViewerScope = {
  role:
    | "citizen"
    | "barangay_official"
    | "city_official"
    | "municipal_official"
    | "admin";
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
};

function toDateOnly(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function scopeNameOf(scope: ScopeRow | ScopeRow[] | undefined): string | null {
  if (!scope) return null;
  if (Array.isArray(scope)) return scope[0]?.name ?? null;
  return scope.name ?? null;
}

function toPrettyDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return d.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function roleLabel(role: ProfileRow["role"]): string {
  if (role === "barangay_official") return "Barangay Official";
  if (role === "city_official") return "City Official";
  if (role === "municipal_official") return "Municipal Official";
  if (role === "admin") return "Admin";
  return "Citizen";
}

function toSectorLabel(sectorCode: string): "General Sector" | "Social Sector" | "Economic Sector" | "Other Services" | "Unknown" {
  if (sectorCode.startsWith("1000")) return "General Sector";
  if (sectorCode.startsWith("3000")) return "Social Sector";
  if (sectorCode.startsWith("8000")) return "Economic Sector";
  if (sectorCode.startsWith("9000")) return "Other Services";
  return "Unknown";
}

const PROJECT_SELECT_COLUMNS = [
  "id",
  "aip_id",
  "aip_ref_code",
  "program_project_description",
  "implementing_agency",
  "start_date",
  "completion_date",
  "expected_output",
  "source_of_funds",
  "personal_services",
  "maintenance_and_other_operating_expenses",
  "financial_expenses",
  "capital_outlay",
  "total",
  "climate_change_adaptation",
  "climate_change_mitigation",
  "cc_topology_code",
  "prm_ncr_lgu_rm_objective_results_indicator",
  "category",
  "sector_code",
  "errors",
  "is_human_edited",
  "edited_by",
  "edited_at",
].join(",");

type DbProjectReviewNoteRow = {
  project_id: string | null;
  body: string;
  created_at: string;
};

type AipStatusRow = {
  status: "draft" | "pending_review" | "under_review" | "for_revision" | "published";
};

type AipScopeOwnerRow = {
  id: string;
  barangay_id: string | null;
  created_by: string | null;
};

type UploadedFileOwnerRow = {
  uploaded_by: string | null;
};

type ProfileBarangayScopeRow = {
  role: ProfileRow["role"];
  barangay_id: string | null;
};

type ProjectFeedbackSelectRow = {
  id: string;
  parent_feedback_id: string | null;
  kind:
    | "question"
    | "suggestion"
    | "concern"
    | "lgu_note"
    | "ai_finding"
    | "commend";
  source: "human" | "ai";
  body: string;
  author_id: string | null;
  created_at: string;
  updated_at: string;
};

function mapProjectSelectRowToAipProjectRow(
  row: ProjectSelectRow,
  officialComment?: string
): AipProjectRow {
  const errors = normalizeProjectErrors(row.errors);
  const aiIssues = errors ?? undefined;
  const reviewStatus = officialComment
    ? "reviewed"
    : aiIssues && aiIssues.length
      ? "ai_flagged"
      : "unreviewed";

  return {
    id: row.id,
    aipId: row.aip_id,

    aipRefCode: row.aip_ref_code,
    programProjectDescription: row.program_project_description,
    implementingAgency: row.implementing_agency,
    startDate: row.start_date,
    completionDate: row.completion_date,
    expectedOutput: row.expected_output,
    sourceOfFunds: row.source_of_funds,
    personalServices: row.personal_services,
    maintenanceAndOtherOperatingExpenses: row.maintenance_and_other_operating_expenses,
    financialExpenses: row.financial_expenses,
    capitalOutlay: row.capital_outlay,
    total: row.total,
    climateChangeAdaptation: row.climate_change_adaptation,
    climateChangeMitigation: row.climate_change_mitigation,
    ccTopologyCode: row.cc_topology_code,
    prmNcrLguRmObjectiveResultsIndicator:
      row.prm_ncr_lgu_rm_objective_results_indicator,
    category: row.category,
    errors,

    // Compatibility aliases
    projectRefCode: row.aip_ref_code,
    kind: row.category,
    sector: deriveSectorFromRefCode(row.aip_ref_code),
    amount: row.total ?? 0,
    aipDescription: row.program_project_description,
    aiIssues,
    officialComment,
    reviewStatus,
  };
}

function mapEditPatchToProjectUpdateColumns(
  patch: AipProjectEditPatch
): Record<string, unknown> {
  const update: Record<string, unknown> = {};

  if ("aipRefCode" in patch) update.aip_ref_code = patch.aipRefCode;
  if ("programProjectDescription" in patch) {
    update.program_project_description = patch.programProjectDescription;
  }
  if ("implementingAgency" in patch) update.implementing_agency = patch.implementingAgency;
  if ("startDate" in patch) update.start_date = patch.startDate;
  if ("completionDate" in patch) update.completion_date = patch.completionDate;
  if ("expectedOutput" in patch) update.expected_output = patch.expectedOutput;
  if ("sourceOfFunds" in patch) update.source_of_funds = patch.sourceOfFunds;
  if ("personalServices" in patch) update.personal_services = patch.personalServices;
  if ("maintenanceAndOtherOperatingExpenses" in patch) {
    update.maintenance_and_other_operating_expenses = patch.maintenanceAndOtherOperatingExpenses;
  }
  if ("financialExpenses" in patch) update.financial_expenses = patch.financialExpenses;
  if ("capitalOutlay" in patch) update.capital_outlay = patch.capitalOutlay;
  if ("total" in patch) update.total = patch.total;
  if ("climateChangeAdaptation" in patch) {
    update.climate_change_adaptation = patch.climateChangeAdaptation;
  }
  if ("climateChangeMitigation" in patch) {
    update.climate_change_mitigation = patch.climateChangeMitigation;
  }
  if ("ccTopologyCode" in patch) update.cc_topology_code = patch.ccTopologyCode;
  if ("prmNcrLguRmObjectiveResultsIndicator" in patch) {
    update.prm_ncr_lgu_rm_objective_results_indicator =
      patch.prmNcrLguRmObjectiveResultsIndicator;
  }
  if ("category" in patch) update.category = patch.category;
  if ("errors" in patch) update.errors = patch.errors;

  return update;
}

function parseSummary(row: ArtifactSelectRow | undefined): string | undefined {
  if (!row) return undefined;
  if (typeof row.artifact_text === "string" && row.artifact_text.trim()) {
    return row.artifact_text.trim();
  }
  if (row.artifact_json && typeof row.artifact_json === "object" && !Array.isArray(row.artifact_json)) {
    const candidate = (row.artifact_json as Record<string, unknown>).summary;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const text = (candidate as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) return text.trim();
    }
  }
  return undefined;
}

const FINALIZING_PROGRESS_MESSAGE = "Finalizing processed output...";

function clampProgress(value: number | null | undefined, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function toProgressMessage(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const message = value.trim();
  return message ? message : null;
}

function buildAipProcessing(input: {
  run: ExtractionRunSelectRow | undefined;
  summary: string | undefined;
}): AipHeader["processing"] | undefined {
  const { run, summary } = input;
  if (!run) return undefined;
  if (run.stage === "embed") return undefined;

  if (run.status === "queued" || run.status === "running") {
    return {
      state: "processing",
      overallProgressPct: clampProgress(run.overall_progress_pct, 0),
      message: toProgressMessage(run.progress_message),
      runId: run.id,
    };
  }

  if (run.status === "succeeded" && !summary) {
    return {
      state: "finalizing",
      overallProgressPct: 100,
      message: toProgressMessage(run.progress_message) ?? FINALIZING_PROGRESS_MESSAGE,
      runId: run.id,
    };
  }

  return undefined;
}

function buildAipEmbedding(run: ExtractionRunSelectRow | undefined): AipHeader["embedding"] | undefined {
  if (!run) return undefined;
  return {
    runId: run.id,
    status: run.status,
    overallProgressPct:
      typeof run.overall_progress_pct === "number"
        ? clampProgress(run.overall_progress_pct, 0)
        : null,
    progressMessage: toProgressMessage(run.progress_message),
    errorMessage: toProgressMessage(run.error_message),
    updatedAt: run.progress_updated_at ?? run.created_at ?? null,
  };
}

async function getViewerScope(): Promise<ViewerScope | null> {
  const client = await supabaseServer();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user?.id) return null;

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role,barangay_id,city_id,municipality_id")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile) return null;
  return profile as ViewerScope;
}

async function getProfilesByIds(userIds: string[]): Promise<Map<string, ProfileRow>> {
  if (!userIds.length) return new Map();
  try {
    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("profiles")
      .select("id,full_name,role")
      .in("id", userIds);
    if (error) throw new Error(error.message);
    return new Map(((data ?? []) as ProfileRow[]).map((r) => [r.id, r]));
  } catch {
    const client = await supabaseServer();
    const { data, error } = await client
      .from("profiles")
      .select("id,full_name,role")
      .in("id", userIds);
    if (error) throw new Error(error.message);
    return new Map(((data ?? []) as ProfileRow[]).map((r) => [r.id, r]));
  }
}

async function getLatestSummaries(aipIds: string[]): Promise<Map<string, ArtifactSelectRow>> {
  if (!aipIds.length) return new Map();
  const client = await supabaseServer();
  const { data, error } = await client
    .from("extraction_artifacts")
    .select("aip_id,artifact_json,artifact_text,created_at")
    .eq("artifact_type", "summarize")
    .in("aip_id", aipIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const map = new Map<string, ArtifactSelectRow>();
  for (const row of (data ?? []) as ArtifactSelectRow[]) {
    if (!map.has(row.aip_id)) map.set(row.aip_id, row);
  }
  return map;
}

async function getCurrentFiles(aipIds: string[]): Promise<Map<string, UploadedFileSelectRow>> {
  if (!aipIds.length) return new Map();
  const client = await supabaseServer();
  const { data, error } = await client
    .from("uploaded_files")
    .select("id,aip_id,bucket_id,object_name,original_file_name,uploaded_by,created_at,is_current")
    .eq("is_current", true)
    .in("aip_id", aipIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const map = new Map<string, UploadedFileSelectRow>();
  for (const row of (data ?? []) as UploadedFileSelectRow[]) {
    if (!map.has(row.aip_id)) map.set(row.aip_id, row);
  }
  return map;
}

async function getProjectsByAipIds(aipIds: string[]): Promise<Map<string, ProjectSelectRow[]>> {
  const map = new Map<string, ProjectSelectRow[]>();
  if (!aipIds.length) return map;

  const client = await supabaseServer();
  const { data, error } = await client
    .from("projects")
    .select(PROJECT_SELECT_COLUMNS)
    .in("aip_id", aipIds)
    .order("aip_ref_code", { ascending: true });
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as unknown as ProjectSelectRow[]) {
    const list = map.get(row.aip_id) ?? [];
    list.push(row);
    map.set(row.aip_id, list);
  }
  return map;
}

function toTimestamp(value: string): number | null {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function sortByCreatedAtAscThenId(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string }
): number {
  const leftAt = toTimestamp(left.createdAt);
  const rightAt = toTimestamp(right.createdAt);
  if (leftAt !== null && rightAt !== null && leftAt !== rightAt) {
    return leftAt - rightAt;
  }
  if (left.createdAt !== right.createdAt) {
    return left.createdAt.localeCompare(right.createdAt);
  }
  return left.id.localeCompare(right.id);
}

function sortByCreatedAtDescThenId(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string }
): number {
  return -sortByCreatedAtAscThenId(left, right);
}

async function getRevisionRemarksByAipIds(
  aipIds: string[]
): Promise<AipRevisionFeedbackMessageByAip[]> {
  if (!aipIds.length) return [];

  const client = await supabaseServer();
  const { data, error } = await client
    .from("aip_reviews")
    .select("id,aip_id,note,reviewer_id,created_at")
    .eq("action", "request_revision")
    .in("aip_id", aipIds)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as AipRevisionReviewSelectRow[];
  const reviewerIds = Array.from(
    new Set(
      rows
        .map((row) => row.reviewer_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );
  const profilesById = await getProfilesByIds(reviewerIds);

  return rows
    .filter((row) => typeof row.note === "string" && row.note.trim().length > 0)
    .map((row) => ({
      aipId: row.aip_id,
      id: row.id,
      body: row.note!.trim(),
      createdAt: row.created_at,
      authorName: row.reviewer_id
        ? profilesById.get(row.reviewer_id)?.full_name?.trim() || null
        : null,
      authorRole: "reviewer" as const,
    }))
    .sort(sortByCreatedAtAscThenId);
}

async function getBarangayAipRepliesByAipIds(
  aipIds: string[]
): Promise<AipRevisionFeedbackMessageByAip[]> {
  if (!aipIds.length) return [];

  const client = await supabaseServer();
  const { data, error } = await client
    .from("feedback")
    .select("id,aip_id,body,author_id,created_at")
    .eq("target_type", "aip")
    .eq("source", "human")
    .eq("kind", "lgu_note")
    .is("parent_feedback_id", null)
    .in("aip_id", aipIds)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as AipRevisionReplySelectRow[];
  const authorIds = Array.from(
    new Set(
      rows
        .map((row) => row.author_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );
  const profilesById = await getProfilesByIds(authorIds);

  return rows
    .filter((row) => row.aip_id && typeof row.body === "string" && row.body.trim().length > 0)
    .filter((row) => {
      if (!row.author_id) return false;
      return profilesById.get(row.author_id)?.role === "barangay_official";
    })
    .map((row) => ({
      aipId: row.aip_id as string,
      id: row.id,
      body: row.body.trim(),
      createdAt: row.created_at,
      authorName: row.author_id
        ? profilesById.get(row.author_id)?.full_name?.trim() || null
        : null,
      authorRole: "barangay_official" as const,
    }))
    .sort(sortByCreatedAtAscThenId);
}

async function getLatestPublishedByByAipIds(
  aipIds: string[]
): Promise<Map<string, NonNullable<AipHeader["publishedBy"]>>> {
  const map = new Map<string, NonNullable<AipHeader["publishedBy"]>>();
  if (!aipIds.length) return map;

  const client = await supabaseServer();
  const { data, error } = await client
    .from("aip_reviews")
    .select("id,aip_id,reviewer_id,created_at")
    .eq("action", "approve")
    .in("aip_id", aipIds)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as AipPublishedReviewSelectRow[];
  const reviewerIds = Array.from(new Set(rows.map((row) => row.reviewer_id)));
  const profilesById = await getProfilesByIds(reviewerIds);

  for (const row of rows) {
    if (map.has(row.aip_id)) continue;
    map.set(row.aip_id, {
      reviewerId: row.reviewer_id,
      reviewerName: profilesById.get(row.reviewer_id)?.full_name?.trim() || null,
      createdAt: row.created_at,
    });
  }

  return map;
}

function buildLatestRevisionNotes(
  remarks: AipRevisionFeedbackMessageByAip[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const remark of [...remarks].sort(sortByCreatedAtDescThenId)) {
    if (!map.has(remark.aipId)) {
      map.set(remark.aipId, remark.body);
    }
  }
  return map;
}

function buildLatestBarangayRevisionReplies(
  replies: AipRevisionFeedbackMessageByAip[]
): Map<string, NonNullable<AipHeader["revisionReply"]>> {
  const map = new Map<string, NonNullable<AipHeader["revisionReply"]>>();
  for (const reply of [...replies].sort(sortByCreatedAtDescThenId)) {
    if (!map.has(reply.aipId)) {
      map.set(reply.aipId, {
        body: reply.body,
        createdAt: reply.createdAt,
        authorName: reply.authorName ?? null,
      });
    }
  }
  return map;
}

function buildRevisionFeedbackCycles(params: {
  aipIds: string[];
  remarks: AipRevisionFeedbackMessageByAip[];
  replies: AipRevisionFeedbackMessageByAip[];
}): Map<string, AipRevisionFeedbackCycle[]> {
  const { aipIds, remarks, replies } = params;
  const cyclesByAip = new Map<string, AipRevisionFeedbackCycle[]>();
  if (!aipIds.length) return cyclesByAip;

  const remarksByAip = new Map<string, AipRevisionFeedbackMessageByAip[]>();
  for (const remark of remarks) {
    const list = remarksByAip.get(remark.aipId) ?? [];
    list.push(remark);
    remarksByAip.set(remark.aipId, list);
  }

  const repliesByAip = new Map<string, AipRevisionFeedbackMessageByAip[]>();
  for (const reply of replies) {
    const list = repliesByAip.get(reply.aipId) ?? [];
    list.push(reply);
    repliesByAip.set(reply.aipId, list);
  }

  for (const aipId of aipIds) {
    const aipRemarks = [...(remarksByAip.get(aipId) ?? [])].sort(
      sortByCreatedAtAscThenId
    );
    if (!aipRemarks.length) continue;

    const aipReplies = [...(repliesByAip.get(aipId) ?? [])].sort(
      sortByCreatedAtAscThenId
    );

    const cyclesAsc: AipRevisionFeedbackCycle[] = aipRemarks.map((remark, index) => {
      const nextRemark = aipRemarks[index + 1];
      const remarkAt = toTimestamp(remark.createdAt);
      const nextRemarkAt = nextRemark ? toTimestamp(nextRemark.createdAt) : null;

      const cycleReplies = aipReplies.filter((reply) => {
        const replyAt = toTimestamp(reply.createdAt);
        if (remarkAt === null || replyAt === null) return false;
        if (replyAt < remarkAt) return false;
        if (nextRemarkAt !== null && replyAt >= nextRemarkAt) return false;
        return true;
      });

      return {
        cycleId: remark.id,
        reviewerRemark: {
          id: remark.id,
          body: remark.body,
          createdAt: remark.createdAt,
          authorName: remark.authorName ?? null,
          authorRole: "reviewer",
        },
        replies: cycleReplies.map((reply) => ({
          id: reply.id,
          body: reply.body,
          createdAt: reply.createdAt,
          authorName: reply.authorName ?? null,
          authorRole: "barangay_official",
        })),
      };
    });

    cyclesByAip.set(
      aipId,
      [...cyclesAsc].sort((left, right) =>
        sortByCreatedAtDescThenId(left.reviewerRemark, right.reviewerRemark)
      )
    );
  }

  return cyclesByAip;
}

async function getLatestRunsByAipIds(aipIds: string[]): Promise<Map<string, ExtractionRunSelectRow>> {
  const map = new Map<string, ExtractionRunSelectRow>();
  if (!aipIds.length) return map;

  const client = await supabaseServer();
  const { data, error } = await client
    .from("extraction_runs")
    .select("id,aip_id,stage,status,overall_progress_pct,progress_message,error_message,progress_updated_at,created_at")
    .in("aip_id", aipIds)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ExtractionRunSelectRow[]) {
    if (row.stage === "embed") continue;
    if (!map.has(row.aip_id)) {
      map.set(row.aip_id, row);
    }
  }
  return map;
}

async function getLatestEmbedRunsByAipIds(
  aipIds: string[]
): Promise<Map<string, ExtractionRunSelectRow>> {
  const map = new Map<string, ExtractionRunSelectRow>();
  if (!aipIds.length) return map;

  const client = await supabaseServer();
  const { data, error } = await client
    .from("extraction_runs")
    .select("id,aip_id,stage,status,overall_progress_pct,progress_message,error_message,progress_updated_at,created_at")
    .in("aip_id", aipIds)
    .eq("stage", "embed")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ExtractionRunSelectRow[]) {
    if (!map.has(row.aip_id)) {
      map.set(row.aip_id, row);
    }
  }
  return map;
}

async function createSignedUrl(file: UploadedFileSelectRow | undefined): Promise<string> {
  if (!file) return "";
  const admin = supabaseAdmin();
  const { data, error } = await admin.storage
    .from(file.bucket_id)
    .createSignedUrl(file.object_name, 60 * 10);
  if (error || !data?.signedUrl) return "";
  return data.signedUrl;
}

function buildAipHeader(input: {
  aip: AipSelectRow;
  currentFile?: UploadedFileSelectRow;
  summary?: string;
  projects: ProjectSelectRow[];
  uploader?: ProfileRow;
  pdfUrl?: string;
  revisionNote?: string;
  publishedBy?: AipHeader["publishedBy"];
  revisionReply?: AipHeader["revisionReply"];
  revisionFeedbackCycles?: AipRevisionFeedbackCycle[];
  processing?: AipHeader["processing"];
  embedding?: AipHeader["embedding"];
  workflowPermissions?: AipHeader["workflowPermissions"];
}) {
  const {
    aip,
    currentFile,
    summary,
    projects,
    uploader,
    pdfUrl,
    revisionNote,
    publishedBy,
    revisionReply,
    revisionFeedbackCycles,
    processing,
    embedding,
    workflowPermissions,
  } = input;

  const budget = projects.reduce((acc, p) => acc + (p.total ?? 0), 0);
  const sectors = Array.from(new Set(projects.map((p) => toSectorLabel(p.sector_code)).filter((s) => s !== "Unknown")));
  const detailedBullets = projects
    .map((p) => p.program_project_description?.trim())
    .filter((v): v is string => !!v)
    .slice(0, 5);

  const scope: "barangay" | "city" = aip.barangay_id ? "barangay" : "city";
  const scopeName =
    scopeNameOf(aip.barangay) ?? scopeNameOf(aip.city) ?? scopeNameOf(aip.municipality) ?? "LGU";

  const fileName =
    currentFile?.original_file_name?.trim() ||
    (currentFile ? basename(currentFile.object_name) : `AIP_${aip.fiscal_year}.pdf`);

  const uploaderName =
    uploader?.full_name?.trim() ||
    (scope === "barangay" ? "Barangay Official" : "Official");
  const uploaderRole =
    uploader?.role
      ? roleLabel(uploader.role)
      : (scope === "barangay" ? "Barangay Official" : "Official");
  const uploadedAt = currentFile?.created_at ?? aip.created_at;

  return {
    id: aip.id,
    scope,
    barangayName: scope === "barangay" ? scopeName : undefined,
    title: `Annual Investment Program ${aip.fiscal_year}`,
    description:
      (summary && summary.slice(0, 220)) ||
      `Annual Investment Program for ${scopeName} fiscal year ${aip.fiscal_year}.`,
    year: aip.fiscal_year,
    budget,
    uploadedAt: toDateOnly(uploadedAt),
    publishedAt: aip.published_at ? toDateOnly(aip.published_at) : undefined,
    status: aip.status,
    fileName,
    pdfUrl: pdfUrl ?? "",
    summaryText: summary,
    detailedBullets,
    sectors: sectors.length ? sectors : ["General Sector", "Social Sector", "Economic Sector", "Other Services"],
    uploader: {
      name: uploaderName,
      role: uploaderRole,
      uploadDate: toPrettyDate(uploadedAt),
      budgetAllocated: budget,
    },
    feedback: revisionNote,
    publishedBy,
    revisionReply,
    revisionFeedbackCycles,
    processing,
    embedding,
    workflowPermissions,
  };
}

export function createSupabaseAipRepo(): AipRepo {
  return {
    async listVisibleAips(input, actor) {
      const scope = input.scope ?? "barangay";
      const visibility = input.visibility ?? "my";
      const client = await supabaseServer();

      let query = client
        .from("aips")
        .select(
          "id,fiscal_year,status,created_by,created_at,published_at,barangay_id,city_id,municipality_id,barangay:barangays!aips_barangay_id_fkey(name),city:cities!aips_city_id_fkey(name),municipality:municipalities!aips_municipality_id_fkey(name)"
        )
        .order("fiscal_year", { ascending: false })
        .order("created_at", { ascending: false });

      if (scope === "barangay") {
        query = query.not("barangay_id", "is", null);
      } else {
        query = query.not("city_id", "is", null);
      }

      if (visibility === "public") {
        query = query.neq("status", "draft");
      } else {
        const viewer = await getViewerScope();
        if (scope === "barangay" && viewer?.barangay_id) {
          query = query.eq("barangay_id", viewer.barangay_id);
        } else if (scope === "city" && viewer?.city_id) {
          query = query.eq("city_id", viewer.city_id);
        }
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const aips = (data ?? []) as AipSelectRow[];
      const aipIds = aips.map((a) => a.id);

      const [
        filesByAip,
        projectsByAip,
        summariesByAip,
        revisionRemarks,
        revisionReplies,
        publishedByByAip,
        latestRunsByAip,
        latestEmbedRunsByAip,
      ] = await Promise.all([
        getCurrentFiles(aipIds),
        getProjectsByAipIds(aipIds),
        getLatestSummaries(aipIds),
        getRevisionRemarksByAipIds(aipIds),
        getBarangayAipRepliesByAipIds(aipIds),
        getLatestPublishedByByAipIds(aipIds),
        getLatestRunsByAipIds(aipIds),
        getLatestEmbedRunsByAipIds(aipIds),
      ]);

      const uploaderIds = Array.from(
        new Set(
          Array.from(filesByAip.values())
            .map((f) => f.uploaded_by)
            .filter(Boolean)
        )
      );
      const profilesById = await getProfilesByIds(uploaderIds);
      const revisionNotes = buildLatestRevisionNotes(revisionRemarks);
      const latestRevisionReplies = buildLatestBarangayRevisionReplies(
        revisionReplies
      );
      const revisionFeedbackCyclesByAip = buildRevisionFeedbackCycles({
        aipIds,
        remarks: revisionRemarks,
        replies: revisionReplies,
      });

      return aips.map((aip) => {
        const summary = parseSummary(summariesByAip.get(aip.id));
        const processing = buildAipProcessing({
          run: latestRunsByAip.get(aip.id),
          summary,
        });
        const embedding = buildAipEmbedding(latestEmbedRunsByAip.get(aip.id));
        const file = filesByAip.get(aip.id);
        const scopeKind = aip.barangay_id
          ? "barangay"
          : aip.city_id
            ? "city"
            : "municipality";
        const ownerUserId = file?.uploaded_by ?? aip.created_by ?? null;
        const permission = computeBarangayWorkflowPermission({
          actor,
          aipScopeKind: scopeKind,
          aipBarangayId: aip.barangay_id,
          ownerUserId,
        });
        const workflowPermissions: AipHeader["workflowPermissions"] = {
          canManageBarangayWorkflow: permission.canManageBarangayWorkflow,
          lockReason: permission.lockReason,
        };

        return buildAipHeader({
          aip,
          currentFile: file,
          projects: projectsByAip.get(aip.id) ?? [],
          summary,
          uploader: (() => {
            return file ? profilesById.get(file.uploaded_by) : undefined;
          })(),
          revisionNote: revisionNotes.get(aip.id),
          publishedBy: publishedByByAip.get(aip.id),
          revisionReply: latestRevisionReplies.get(aip.id),
          revisionFeedbackCycles: revisionFeedbackCyclesByAip.get(aip.id),
          processing,
          embedding,
          workflowPermissions,
        });
      });
    },

    async getAipDetail(aipId, actor) {
      const client = await supabaseServer();
      const { data, error } = await client
        .from("aips")
        .select(
          "id,fiscal_year,status,created_by,created_at,published_at,barangay_id,city_id,municipality_id,barangay:barangays!aips_barangay_id_fkey(name),city:cities!aips_city_id_fkey(name),municipality:municipalities!aips_municipality_id_fkey(name)"
        )
        .eq("id", aipId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) return null;

      const aip = data as AipSelectRow;
      const [
        filesByAip,
        projectsByAip,
        summariesByAip,
        revisionRemarks,
        revisionReplies,
        publishedByByAip,
        latestEmbedRunsByAip,
      ] =
        await Promise.all([
          getCurrentFiles([aipId]),
          getProjectsByAipIds([aipId]),
          getLatestSummaries([aipId]),
          getRevisionRemarksByAipIds([aipId]),
          getBarangayAipRepliesByAipIds([aipId]),
          getLatestPublishedByByAipIds([aipId]),
          getLatestEmbedRunsByAipIds([aipId]),
        ]);

      const file = filesByAip.get(aipId);
      const uploaderIds = file ? [file.uploaded_by] : [];
      const profilesById = await getProfilesByIds(uploaderIds);
      const revisionNotes = buildLatestRevisionNotes(revisionRemarks);
      const latestRevisionReplies = buildLatestBarangayRevisionReplies(
        revisionReplies
      );
      const revisionFeedbackCyclesByAip = buildRevisionFeedbackCycles({
        aipIds: [aipId],
        remarks: revisionRemarks,
        replies: revisionReplies,
      });
      const pdfUrl = await createSignedUrl(file);
      const scopeKind = aip.barangay_id
        ? "barangay"
        : aip.city_id
          ? "city"
          : "municipality";
      const ownerUserId = file?.uploaded_by ?? aip.created_by ?? null;
      const permission = computeBarangayWorkflowPermission({
        actor,
        aipScopeKind: scopeKind,
        aipBarangayId: aip.barangay_id,
        ownerUserId,
      });
      const workflowPermissions: AipHeader["workflowPermissions"] = {
        canManageBarangayWorkflow: permission.canManageBarangayWorkflow,
        lockReason: permission.lockReason,
      };

      return buildAipHeader({
        aip,
        currentFile: file,
        projects: projectsByAip.get(aipId) ?? [],
        summary: parseSummary(summariesByAip.get(aipId)),
        uploader: file ? profilesById.get(file.uploaded_by) : undefined,
        pdfUrl,
        revisionNote: revisionNotes.get(aipId),
        publishedBy: publishedByByAip.get(aipId),
        revisionReply: latestRevisionReplies.get(aipId),
        revisionFeedbackCycles: revisionFeedbackCyclesByAip.get(aipId),
        embedding: buildAipEmbedding(latestEmbedRunsByAip.get(aipId)),
        workflowPermissions,
      });
    },

    async updateAipStatus(aipId, next) {
      const client = await supabaseServer();
      const patch: { status: AipStatusRow["status"]; submitted_at?: string } = {
        status: next,
      };
      if (next === "pending_review") {
        patch.submitted_at = new Date().toISOString();
      }
      const { error } = await client.from("aips").update(patch).eq("id", aipId);
      if (error) throw new Error(error.message);
    },
  };
}

async function getLatestProjectComments(
  client: Awaited<ReturnType<typeof supabaseServer>>,
  projectIds: string[]
): Promise<Map<string, string>> {
  const commentsByProject = new Map<string, string>();
  if (!projectIds.length) return commentsByProject;

  const { data: notes, error } = await client
    .from("feedback")
    .select("project_id,body,created_at")
    .eq("target_type", "project")
    .eq("kind", "lgu_note")
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  for (const row of (notes ?? []) as DbProjectReviewNoteRow[]) {
    if (row.project_id && !commentsByProject.has(row.project_id)) {
      commentsByProject.set(row.project_id, row.body);
    }
  }
  return commentsByProject;
}

const REVIEWABLE_AIP_STATUSES = new Set<AipStatusRow["status"]>(["draft", "for_revision"]);

async function assertProjectReviewIsEditable(
  client: Awaited<ReturnType<typeof supabaseServer>>,
  aipId: string
) {
  const { data, error } = await client
    .from("aips")
    .select("status")
    .eq("id", aipId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("AIP not found.");

  const status = (data as AipStatusRow).status;
  if (!REVIEWABLE_AIP_STATUSES.has(status)) {
    throw new Error(
      "Project reviews can only be submitted when the AIP status is Draft or For Revision."
    );
  }
}

async function assertBarangayProjectEditOwnership(
  client: Awaited<ReturnType<typeof supabaseServer>>,
  aipId: string,
  userId: string
) {
  const { data: aipData, error: aipError } = await client
    .from("aips")
    .select("id,barangay_id,created_by")
    .eq("id", aipId)
    .maybeSingle();

  if (aipError) throw new Error(aipError.message);
  if (!aipData) throw new Error("AIP not found.");

  const aip = aipData as AipScopeOwnerRow;
  if (!aip.barangay_id) return;

  const { data: profileData, error: profileError } = await client
    .from("profiles")
    .select("role,barangay_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (!profileData) throw new Error("Unauthorized");

  const profile = profileData as ProfileBarangayScopeRow;
  const isBarangayOfficialInOwningScope =
    profile.role === "barangay_official" &&
    !!profile.barangay_id &&
    profile.barangay_id === aip.barangay_id;

  if (!isBarangayOfficialInOwningScope) {
    throw new Error(BARANGAY_UPLOADER_WORKFLOW_LOCK_REASON);
  }

  const { data: currentFileData, error: currentFileError } = await client
    .from("uploaded_files")
    .select("uploaded_by")
    .eq("aip_id", aipId)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (currentFileError) throw new Error(currentFileError.message);

  const currentFile = currentFileData as UploadedFileOwnerRow | null;
  const ownerUserId = currentFile?.uploaded_by ?? aip.created_by ?? null;

  if (!ownerUserId || ownerUserId !== userId) {
    throw new Error(
      BARANGAY_UPLOADER_WORKFLOW_LOCK_REASON
    );
  }
}

function toFeedbackAuthorName(
  row: ProjectFeedbackSelectRow,
  profilesById: Map<string, ProfileRow>
): string | null {
  if (row.source === "ai") return "AI";
  if (!row.author_id) return null;
  const profile = profilesById.get(row.author_id);
  if (!profile?.full_name) return null;
  const fullName = profile.full_name.trim();
  return fullName.length ? fullName : null;
}

function toFeedbackAuthorRole(
  row: ProjectFeedbackSelectRow,
  profilesById: Map<string, ProfileRow>
): ProfileRow["role"] | null {
  if (!row.author_id) return null;
  return profilesById.get(row.author_id)?.role ?? null;
}

function sortFeedbackMessageByCreatedAtAsc(
  left: AipProjectFeedbackMessage,
  right: AipProjectFeedbackMessage
) {
  const leftAt = new Date(left.createdAt).getTime();
  const rightAt = new Date(right.createdAt).getTime();
  if (leftAt !== rightAt) return leftAt - rightAt;
  return left.id.localeCompare(right.id);
}

function sortFeedbackThreadByRootCreatedAtDesc(
  left: AipProjectFeedbackThread,
  right: AipProjectFeedbackThread
) {
  const leftAt = new Date(left.root.createdAt).getTime();
  const rightAt = new Date(right.root.createdAt).getTime();
  if (leftAt !== rightAt) return rightAt - leftAt;
  return right.root.id.localeCompare(left.root.id);
}

function resolveRootMessageId(
  messageId: string,
  messagesById: Map<string, AipProjectFeedbackMessage>
): string {
  const origin = messagesById.get(messageId);
  if (!origin) return messageId;

  const visited = new Set<string>();
  let current = origin;
  while (current.parentFeedbackId) {
    const parentId = current.parentFeedbackId;
    if (visited.has(parentId)) break;
    visited.add(parentId);

    const parent = messagesById.get(parentId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

function buildProjectFeedbackThreads(
  rows: ProjectFeedbackSelectRow[],
  profilesById: Map<string, ProfileRow>
): AipProjectFeedbackThread[] {
  const messages = rows
    .map<AipProjectFeedbackMessage>((row) => ({
      id: row.id,
      parentFeedbackId: row.parent_feedback_id,
      kind: row.kind,
      source: row.source,
      body: row.body,
      authorId: row.author_id,
      authorName: toFeedbackAuthorName(row, profilesById),
      authorRole: toFeedbackAuthorRole(row, profilesById),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    .sort(sortFeedbackMessageByCreatedAtAsc);

  if (!messages.length) return [];

  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const threadsByRootId = new Map<string, AipProjectFeedbackThread>();

  for (const message of messages) {
    const rootId = resolveRootMessageId(message.id, messagesById);
    const root = messagesById.get(rootId) ?? message;
    const thread = threadsByRootId.get(rootId) ?? { root, replies: [] };
    if (message.id !== thread.root.id) {
      thread.replies.push(message);
    }
    threadsByRootId.set(rootId, thread);
  }

  return Array.from(threadsByRootId.values())
    .map((thread) => ({
      root: thread.root,
      replies: [...thread.replies].sort(sortFeedbackMessageByCreatedAtAsc),
    }))
    .sort(sortFeedbackThreadByRootCreatedAtDesc);
}

export function createSupabaseAipProjectRepo(): AipProjectRepo {
  return {
    async listByAip(aipId) {
      const client = await supabaseServer();
      const { data: projects, error } = await client
        .from("projects")
        .select(PROJECT_SELECT_COLUMNS)
        .eq("aip_id", aipId)
        .order("aip_ref_code", { ascending: true });

      if (error) throw new Error(error.message);
      const rows = (projects ?? []) as unknown as ProjectSelectRow[];
      const projectIds = rows.map((p) => p.id);
      const commentsByProject = await getLatestProjectComments(client, projectIds);
      return rows.map((row) => mapProjectSelectRowToAipProjectRow(row, commentsByProject.get(row.id)));
    },

    async getReviewDetail(aipId, projectId): Promise<AipProjectReviewDetail | null> {
      const client = await supabaseServer();
      const { data: projectData, error: projectError } = await client
        .from("projects")
        .select(PROJECT_SELECT_COLUMNS)
        .eq("id", projectId)
        .eq("aip_id", aipId)
        .maybeSingle();

      if (projectError) throw new Error(projectError.message);
      if (!projectData) return null;

      const { data: feedbackData, error: feedbackError } = await client
        .from("feedback")
        .select("id,parent_feedback_id,kind,source,body,author_id,created_at,updated_at")
        .eq("target_type", "project")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

      if (feedbackError) throw new Error(feedbackError.message);

      const feedbackRows = (feedbackData ?? []) as ProjectFeedbackSelectRow[];
      const authorIds = Array.from(
        new Set(
          feedbackRows
            .map((row) => row.author_id)
            .filter((value): value is string => typeof value === "string" && value.length > 0)
        )
      );
      const profilesById = await getProfilesByIds(authorIds);

      const latestLguNoteBody =
        [...feedbackRows]
          .filter((row) => row.kind === "lgu_note")
          .sort((left, right) => {
            const leftAt = new Date(left.created_at).getTime();
            const rightAt = new Date(right.created_at).getTime();
            if (leftAt !== rightAt) return rightAt - leftAt;
            return right.id.localeCompare(left.id);
          })[0]?.body ?? undefined;

      return {
        project: mapProjectSelectRowToAipProjectRow(
          projectData as unknown as ProjectSelectRow,
          latestLguNoteBody
        ),
        feedbackThreads: buildProjectFeedbackThreads(feedbackRows, profilesById),
      };
    },

    async submitReview(input) {
      const reason = input.reason.trim();
      if (!reason) {
        throw new Error("Review comment is required.");
      }

      const client = await supabaseServer();
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError || !authData.user?.id) throw new Error("Unauthorized");
      await assertBarangayProjectEditOwnership(client, input.aipId, authData.user.id);
      await assertProjectReviewIsEditable(client, input.aipId);

      const { data: currentRowData, error: currentRowError } = await client
        .from("projects")
        .select(PROJECT_SELECT_COLUMNS)
        .eq("id", input.projectId)
        .eq("aip_id", input.aipId)
        .maybeSingle();

      if (currentRowError) throw new Error(currentRowError.message);
      if (!currentRowData) throw new Error("Project not found.");

      const currentRow = currentRowData as unknown as ProjectSelectRow;
      const baseRow = mapProjectSelectRowToAipProjectRow(currentRow);
      const baseFields = projectEditableFieldsFromRow(baseRow);
      const normalizedPatch = normalizeProjectEditPatch(input.changes, baseFields);
      const nextFields = applyProjectEditPatch(baseFields, normalizedPatch);
      const diff = diffProjectEditableFields(baseFields, nextFields);
      const hasAiIssues = (baseRow.errors?.length ?? 0) > 0;

      if (!hasAiIssues && diff.length === 0) {
        throw new Error("No changes detected. Edit at least one field before saving.");
      }

      let persistedRow = currentRow;
      if (diff.length > 0) {
        const updatePayload = {
          ...mapEditPatchToProjectUpdateColumns(normalizedPatch),
          is_human_edited: true,
          edited_by: authData.user.id,
          edited_at: new Date().toISOString(),
        };

        const { data: updatedData, error: updateError } = await client
          .from("projects")
          .update(updatePayload)
          .eq("id", input.projectId)
          .eq("aip_id", input.aipId)
          .select(PROJECT_SELECT_COLUMNS)
          .single();

        if (updateError) throw new Error(updateError.message);
        persistedRow = updatedData as unknown as ProjectSelectRow;
      }

      const commentBody = buildProjectReviewBody({
        reason,
        diff,
      });

      await assertFeedbackUsageAllowed({
        client: client as any,
        userId: authData.user.id,
      });

      const { error } = await client.from("feedback").insert({
        target_type: "project",
        aip_id: null,
        project_id: input.projectId,
        parent_feedback_id: null,
        source: "human",
        kind: "lgu_note",
        extraction_run_id: null,
        extraction_artifact_id: null,
        field_key: input.resolution ?? null,
        severity: null,
        body: commentBody,
        is_public: true,
        author_id: authData.user.id,
      });

      if (error) throw new Error(error.message);

      return mapProjectSelectRowToAipProjectRow(persistedRow, commentBody);
    },
  };
}
