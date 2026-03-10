import "server-only";

import { createSupabaseFeedbackThreadsRepo } from "@/lib/repos/feedback/repo.supabase";
import { fetchAipFileTotalsByAipIds } from "@/lib/repos/_shared/aip-totals";
import {
  chunkArray,
  SUPABASE_PAGE_SIZE,
} from "@/lib/repos/_shared/supabase-batching";
import { supabaseServer } from "@/lib/supabase/server";
import { applyAipUploaderMetadata, resolveDefaultFiscalYear, resolveSelectedFiscalYear } from "./mappers";
import type { DashboardRepo } from "./repo";
import {
  CITIZEN_FEEDBACK_KINDS,
  DASHBOARD_REPLY_MAX_LENGTH,
  type CreateDashboardDraftInput,
  type CreateDashboardDraftResult,
  type DashboardAip,
  type DashboardData,
  type DashboardFeedback,
  type DashboardProjectUpdateLog,
  type DashboardProject,
  type DashboardReview,
  type DashboardRun,
  type DashboardScope,
  type DashboardSector,
  type ReplyDashboardFeedbackInput,
} from "./types";

type SupabaseClient = Awaited<ReturnType<typeof supabaseServer>>;

type AipRow = {
  id: string;
  fiscal_year: number;
  status: DashboardAip["status"];
  status_updated_at: string;
  submitted_at: string | null;
  published_at: string | null;
  created_at: string;
};

type UploadedFileRow = {
  aip_id: string;
  uploaded_by: string;
  created_at: string;
  is_current: boolean;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
};

type ProjectRow = {
  id: string;
  aip_id: string;
  aip_ref_code: string | null;
  program_project_description: string;
  category: DashboardProject["category"];
  sector_code: string | null;
  total: number | null;
  personal_services: number | null;
  maintenance_and_other_operating_expenses: number | null;
  capital_outlay: number | null;
  errors: unknown;
  is_human_edited: boolean;
  edited_at: string | null;
};

type HealthDetailsRow = { project_id: string; program_name: string };
type SectorRow = { code: string; label: string };

type RunRow = {
  id: string;
  aip_id: string;
  stage: DashboardRun["stage"];
  status: DashboardRun["status"];
  started_at: string | null;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

type ReviewRow = {
  id: string;
  aip_id: string;
  action: DashboardReview["action"];
  note: string | null;
  reviewer_id: string;
  created_at: string;
};

type FeedbackRow = {
  id: string;
  target_type: DashboardFeedback["targetType"];
  aip_id: string | null;
  project_id: string | null;
  parent_feedback_id: string | null;
  kind: DashboardFeedback["kind"];
  source: "human" | "ai";
  body: string;
  created_at: string;
};

type ParentProjectRow = {
  id: string;
  aip_id: string;
};

type ActivityLogRow = {
  id: string;
  action: string;
  entity_id: string | null;
  entity_table: string | null;
  metadata: unknown;
  created_at: string;
};

const CITIZEN_KIND_SET = new Set<string>(CITIZEN_FEEDBACK_KINDS);
const PROJECT_UPDATE_ACTION_SET = new Set<string>(["project_info_updated", "project_updated"]);

function toTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
}

function getScopeColumn(scope: DashboardScope): "barangay_id" | "city_id" {
  return scope === "city" ? "city_id" : "barangay_id";
}

function mapAipRow(row: AipRow): DashboardAip {
  return {
    id: row.id,
    fiscalYear: row.fiscal_year,
    totalInvestmentProgram: null,
    status: row.status,
    statusUpdatedAt: row.status_updated_at,
    submittedAt: row.submitted_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    uploadedBy: null,
    uploadedDate: null,
  };
}

function mapProjectRow(row: ProjectRow, healthProgramName: string | null): DashboardProject {
  const aipRefCode =
    typeof row.aip_ref_code === "string" && row.aip_ref_code.trim().length > 0
      ? row.aip_ref_code.trim()
      : "Unspecified";
  const sectorCode =
    typeof row.sector_code === "string" && row.sector_code.trim().length > 0
      ? row.sector_code.trim()
      : "unknown";
  return {
    id: row.id,
    aipId: row.aip_id,
    aipRefCode,
    programProjectDescription: row.program_project_description,
    category: row.category,
    sectorCode,
    total: row.total,
    personalServices: row.personal_services,
    maintenanceAndOtherOperatingExpenses: row.maintenance_and_other_operating_expenses,
    capitalOutlay: row.capital_outlay,
    errors: row.errors,
    isHumanEdited: row.is_human_edited,
    editedAt: row.edited_at,
    healthProgramName,
  };
}

function mapRunRow(row: RunRow): DashboardRun {
  return {
    id: row.id,
    aipId: row.aip_id,
    stage: row.stage,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function mapReviewRow(row: ReviewRow): DashboardReview {
  return {
    id: row.id,
    aipId: row.aip_id,
    action: row.action,
    note: row.note,
    reviewerId: row.reviewer_id,
    createdAt: row.created_at,
  };
}

function mapFeedbackRow(row: FeedbackRow): DashboardFeedback {
  return {
    id: row.id,
    targetType: row.target_type,
    aipId: row.aip_id,
    projectId: row.project_id,
    parentFeedbackId: row.parent_feedback_id,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
  };
}

function getMetadataObject(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

function getMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function listAipsByScope(
  client: SupabaseClient,
  input: { scope: DashboardScope; scopeId: string }
): Promise<DashboardAip[]> {
  const scopeColumn = getScopeColumn(input.scope);
  const rows: AipRow[] = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await client
      .from("aips")
      .select("id,fiscal_year,status,status_updated_at,submitted_at,published_at,created_at")
      .eq(scopeColumn, input.scopeId)
      .order("fiscal_year", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error) throw new Error(error.message);

    const batch = (data ?? []) as AipRow[];
    rows.push(...batch);
    if (batch.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return rows.map(mapAipRow);
}

async function listAipUploaderMetadata(
  client: SupabaseClient,
  aipIds: string[]
): Promise<Map<string, { uploadedBy: string | null; uploadedDate: string | null }>> {
  const metadataByAipId = new Map<string, { uploadedBy: string | null; uploadedDate: string | null }>();
  const uniqueAipIds = Array.from(
    new Set(
      aipIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    )
  );
  if (uniqueAipIds.length === 0) return metadataByAipId;

  const latestUploadByAipId = new Map<string, UploadedFileRow>();
  for (const aipIdChunk of chunkArray(uniqueAipIds)) {
    const { data: uploadRows, error: uploadError } = await client
      .from("uploaded_files")
      .select("aip_id,uploaded_by,created_at,is_current")
      .eq("is_current", true)
      .in("aip_id", aipIdChunk)
      .order("created_at", { ascending: false });
    if (uploadError) throw new Error(uploadError.message);

    for (const row of (uploadRows ?? []) as UploadedFileRow[]) {
      const existing = latestUploadByAipId.get(row.aip_id);
      if (!existing || toTimestamp(row.created_at) > toTimestamp(existing.created_at)) {
        latestUploadByAipId.set(row.aip_id, row);
      }
    }
  }

  const uploaderIds = Array.from(
    new Set(
      Array.from(latestUploadByAipId.values())
        .map((row) => row.uploaded_by)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );

  const uploaderNameById = new Map<string, string | null>();
  if (uploaderIds.length > 0) {
    for (const uploaderIdChunk of chunkArray(uploaderIds)) {
      const { data: profileRows, error: profileError } = await client
        .from("profiles")
        .select("id,full_name")
        .in("id", uploaderIdChunk);
      if (profileError) throw new Error(profileError.message);

      for (const profile of (profileRows ?? []) as ProfileRow[]) {
        uploaderNameById.set(profile.id, profile.full_name?.trim() || null);
      }
    }
  }

  for (const [aipId, row] of latestUploadByAipId.entries()) {
    metadataByAipId.set(aipId, {
      uploadedBy: uploaderNameById.get(row.uploaded_by) ?? null,
      uploadedDate: row.created_at,
    });
  }

  return metadataByAipId;
}

async function listProjects(client: SupabaseClient, aipId: string): Promise<DashboardProject[]> {
  const projects: ProjectRow[] = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await client
      .from("projects")
      .select(
        "id,aip_id,aip_ref_code,program_project_description,category,sector_code,total,personal_services,maintenance_and_other_operating_expenses,capital_outlay,errors,is_human_edited,edited_at"
      )
      .eq("aip_id", aipId)
      .order("aip_ref_code", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);

    const batch = (data ?? []) as ProjectRow[];
    projects.push(...batch);
    if (batch.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  const projectIds = Array.from(
    new Set(
      projects
        .map((project) => project.id)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    )
  );

  let healthByProjectId = new Map<string, string>();
  if (projectIds.length > 0) {
    const healthRows: HealthDetailsRow[] = [];
    for (const projectIdChunk of chunkArray(projectIds)) {
      const { data: healthData, error: healthError } = await client
        .from("health_project_details")
        .select("project_id,program_name")
        .in("project_id", projectIdChunk);
      if (healthError) throw new Error(healthError.message);
      healthRows.push(...((healthData ?? []) as HealthDetailsRow[]));
    }
    healthByProjectId = new Map(healthRows.map((row) => [row.project_id, row.program_name]));
  }

  return projects.map((project) => mapProjectRow(project, healthByProjectId.get(project.id) ?? null));
}

async function listSectors(client: SupabaseClient): Promise<DashboardSector[]> {
  const { data, error } = await client.from("sectors").select("code,label").order("code");
  if (error) throw new Error(error.message);
  return ((data ?? []) as SectorRow[]).map((row) => ({ code: row.code, label: row.label }));
}

async function listLatestRuns(client: SupabaseClient, aipId: string): Promise<DashboardRun[]> {
  const { data, error } = await client
    .from("extraction_runs")
    .select("id,aip_id,stage,status,started_at,finished_at,error_code,error_message,created_at")
    .eq("aip_id", aipId)
    .order("started_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  const runs = ((data ?? []) as RunRow[]).map(mapRunRow);
  const latestByStage = new Map<DashboardRun["stage"], DashboardRun>();

  for (const run of runs) {
    if (!latestByStage.has(run.stage)) {
      latestByStage.set(run.stage, run);
    }
  }

  return Array.from(latestByStage.values());
}

async function listAipReviews(client: SupabaseClient, aipId: string): Promise<DashboardReview[]> {
  const { data, error } = await client
    .from("aip_reviews")
    .select("id,aip_id,action,note,reviewer_id,created_at")
    .eq("aip_id", aipId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ReviewRow[]).map(mapReviewRow);
}

async function listFeedback(
  client: SupabaseClient,
  input: { aipId: string; projectIds: string[] }
): Promise<DashboardFeedback[]> {
  const { data: aipFeedback, error: aipFeedbackError } = await client
    .from("feedback")
    .select("id,target_type,aip_id,project_id,parent_feedback_id,kind,source,body,created_at")
    .eq("target_type", "aip")
    .eq("aip_id", input.aipId);
  if (aipFeedbackError) throw new Error(aipFeedbackError.message);

  const rows: FeedbackRow[] = [...((aipFeedback ?? []) as FeedbackRow[])];
  const uniqueProjectIds = Array.from(
    new Set(
      input.projectIds.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      )
    )
  );

  if (uniqueProjectIds.length > 0) {
    for (const projectIdChunk of chunkArray(uniqueProjectIds)) {
      const { data: projectFeedback, error: projectFeedbackError } = await client
        .from("feedback")
        .select("id,target_type,aip_id,project_id,parent_feedback_id,kind,source,body,created_at")
        .eq("target_type", "project")
        .in("project_id", projectIdChunk);
      if (projectFeedbackError) throw new Error(projectFeedbackError.message);
      rows.push(...((projectFeedback ?? []) as FeedbackRow[]));
    }
  }

  return rows.map(mapFeedbackRow);
}

async function listProjectUpdateLogs(
  client: SupabaseClient,
  input: {
    scope: DashboardScope;
    scopeId: string;
    projects: DashboardProject[];
  }
): Promise<DashboardProjectUpdateLog[]> {
  if (input.projects.length === 0) return [];

  const scopeColumn = getScopeColumn(input.scope);
  const projectIdSet = new Set(input.projects.map((project) => project.id));
  const projectRefCodeById = new Map(
    input.projects.map((project) => [project.id, project.aipRefCode])
  );

  const { data, error } = await client
    .from("activity_log")
    .select("id,action,entity_id,entity_table,metadata,created_at")
    .in("action", ["project_info_updated", "project_updated"])
    .eq("entity_table", "projects")
    .eq(scopeColumn, input.scopeId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ActivityLogRow[];
  const logs: DashboardProjectUpdateLog[] = [];

  for (const row of rows) {
    if (!row.entity_id || !projectIdSet.has(row.entity_id)) continue;
    if (!PROJECT_UPDATE_ACTION_SET.has(row.action)) continue;
    const action = row.action as DashboardProjectUpdateLog["action"];
    const projectRefCode = projectRefCodeById.get(row.entity_id);
    if (!projectRefCode) continue;

    const metadata = getMetadataObject(row.metadata);
    const title =
      action === "project_updated"
        ? getMetadataString(metadata, "update_title") ?? "Project update posted"
        : "Project information updated";
    const body =
      action === "project_updated"
        ? getMetadataString(metadata, "update_body") ??
          getMetadataString(metadata, "details") ??
          ""
        : getMetadataString(metadata, "details") ?? "";
    const actorName =
      getMetadataString(metadata, "uploader_name") ??
      getMetadataString(metadata, "actor_name") ??
      "Unknown";

    logs.push({
      id: row.id,
      action,
      entityId: row.entity_id,
      projectRefCode,
      title,
      body,
      actorName,
      createdAt: row.created_at,
    });
  }

  return logs;
}

async function assertFeedbackParentInScope(
  client: SupabaseClient,
  input: { scope: DashboardScope; scopeId: string; parent: FeedbackRow }
): Promise<void> {
  const scopeColumn = getScopeColumn(input.scope);

  if (input.parent.target_type === "aip") {
    if (!input.parent.aip_id) throw new Error("Feedback parent has no AIP target.");
    const { data, error } = await client
      .from("aips")
      .select("id")
      .eq("id", input.parent.aip_id)
      .eq(scopeColumn, input.scopeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Feedback parent is outside your scope.");
    return;
  }

  if (!input.parent.project_id) throw new Error("Feedback parent has no project target.");
  const { data: projectData, error: projectError } = await client
    .from("projects")
    .select("id,aip_id")
    .eq("id", input.parent.project_id)
    .maybeSingle();
  if (projectError) throw new Error(projectError.message);
  if (!projectData) throw new Error("Feedback parent project not found.");

  const project = projectData as ParentProjectRow;
  const { data: aipData, error: aipError } = await client
    .from("aips")
    .select("id")
    .eq("id", project.aip_id)
    .eq(scopeColumn, input.scopeId)
    .maybeSingle();
  if (aipError) throw new Error(aipError.message);
  if (!aipData) throw new Error("Feedback parent is outside your scope.");
}

function sanitizeReplyBody(body: string): string {
  const normalized = body.trim();
  if (!normalized) throw new Error("Reply body is required.");
  if (normalized.length > DASHBOARD_REPLY_MAX_LENGTH) {
    throw new Error(`Reply body must be at most ${DASHBOARD_REPLY_MAX_LENGTH} characters.`);
  }
  return normalized;
}

function assertCitizenRootParent(parent: FeedbackRow): void {
  if (parent.parent_feedback_id) {
    throw new Error("Replies can only be posted to root citizen feedback.");
  }
  if (!CITIZEN_KIND_SET.has(parent.kind)) {
    throw new Error("Replies are only allowed for citizen feedback kinds.");
  }
}

async function createDraftAipInternal(
  client: SupabaseClient,
  input: CreateDashboardDraftInput
): Promise<CreateDashboardDraftResult> {
  if (!Number.isInteger(input.fiscalYear) || input.fiscalYear < 2000 || input.fiscalYear > 2100) {
    throw new Error("Invalid fiscal year.");
  }

  const scopeColumn = getScopeColumn(input.scope);
  const { data: existing, error: existingError } = await client
    .from("aips")
    .select("id")
    .eq(scopeColumn, input.scopeId)
    .eq("fiscal_year", input.fiscalYear)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing?.id) return { created: false, aipId: existing.id };

  const payload: Record<string, unknown> = {
    fiscal_year: input.fiscalYear,
    status: "draft",
    created_by: input.createdBy,
    barangay_id: null,
    city_id: null,
    municipality_id: null,
  };
  payload[scopeColumn] = input.scopeId;

  const { data: created, error: createError } = await client
    .from("aips")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (createError) {
    if (createError.code === "23505") {
      const { data: raceExisting, error: raceError } = await client
        .from("aips")
        .select("id")
        .eq(scopeColumn, input.scopeId)
        .eq("fiscal_year", input.fiscalYear)
        .maybeSingle();
      if (raceError) throw new Error(raceError.message);
      return { created: false, aipId: raceExisting?.id ?? null };
    }

    throw new Error(createError.message);
  }

  return { created: true, aipId: created?.id ?? null };
}

async function replyToFeedbackInternal(
  client: SupabaseClient,
  input: ReplyDashboardFeedbackInput
): Promise<{ replyId: string }> {
  const body = sanitizeReplyBody(input.body);
  const { data: parentData, error: parentError } = await client
    .from("feedback")
    .select("id,target_type,aip_id,project_id,parent_feedback_id,kind,source,body,created_at")
    .eq("id", input.parentFeedbackId)
    .maybeSingle();

  if (parentError) throw new Error(parentError.message);
  if (!parentData) throw new Error("Feedback parent not found.");

  const parent = parentData as FeedbackRow;
  assertCitizenRootParent(parent);
  await assertFeedbackParentInScope(client, {
    scope: input.scope,
    scopeId: input.scopeId,
    parent,
  });

  const threadsRepo = createSupabaseFeedbackThreadsRepo();
  const reply = await threadsRepo.createReply({
    parentId: input.parentFeedbackId,
    body,
    authorId: input.authorId,
  });

  return { replyId: reply.id };
}

export function createSupabaseDashboardRepo(): DashboardRepo {
  return {
    async getDashboardDataByScope(input) {
      const client = await supabaseServer();
      const baseAips = await listAipsByScope(client, {
        scope: input.scope,
        scopeId: input.scopeId,
      });
      const aipTotalsByAipId = await fetchAipFileTotalsByAipIds(
        client,
        baseAips.map((aip) => aip.id)
      );
      const baseAipsWithTotals = baseAips.map((aip) => ({
        ...aip,
        totalInvestmentProgram: aipTotalsByAipId.get(aip.id) ?? null,
      }));

      const aipMetadata = await listAipUploaderMetadata(
        client,
        baseAips.map((aip) => aip.id)
      );
      const allAips = applyAipUploaderMetadata(baseAipsWithTotals, aipMetadata);

      const availableFiscalYears = Array.from(
        new Set(allAips.map((aip) => aip.fiscalYear))
      ).sort((left, right) => right - left);
      const selectedFiscalYear = resolveSelectedFiscalYear({
        requestedFiscalYear: input.requestedFiscalYear,
        availableFiscalYears,
        fallbackFiscalYear: resolveDefaultFiscalYear(allAips),
      });
      const selectedAip = allAips.find((aip) => aip.fiscalYear === selectedFiscalYear) ?? null;

      if (!selectedAip) {
        return {
          scope: input.scope,
          scopeId: input.scopeId,
          selectedFiscalYear,
          selectedAip: null,
          availableFiscalYears,
          allAips,
          projects: [],
          sectors: await listSectors(client),
          latestRuns: [],
          reviews: [],
          feedback: [],
          projectUpdateLogs: [],
        };
      }

      const projects = await listProjects(client, selectedAip.id);
      const projectIds = projects.map((project) => project.id);
      const [sectors, latestRuns, reviews, feedback, projectUpdateLogs] = await Promise.all([
        listSectors(client),
        listLatestRuns(client, selectedAip.id),
        listAipReviews(client, selectedAip.id),
        listFeedback(client, { aipId: selectedAip.id, projectIds }),
        listProjectUpdateLogs(client, {
          scope: input.scope,
          scopeId: input.scopeId,
          projects,
        }),
      ]);

      return {
        scope: input.scope,
        scopeId: input.scopeId,
        selectedFiscalYear,
        selectedAip,
        availableFiscalYears,
        allAips,
        projects,
        sectors,
        latestRuns,
        reviews,
        feedback,
        projectUpdateLogs,
      } satisfies DashboardData;
    },

    async createDraftAip(input) {
      const client = await supabaseServer();
      return createDraftAipInternal(client, input);
    },

    async replyToFeedback(input) {
      const client = await supabaseServer();
      return replyToFeedbackInternal(client, input);
    },
  };
}
