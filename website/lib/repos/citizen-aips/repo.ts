import "server-only";

import type { Json, RoleType } from "@/lib/contracts/databasev2";
import { selectRepo } from "@/lib/repos/_shared/selector";
import { normalizeProjectErrors } from "@/lib/repos/aip/project-review";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { createMockCitizenAipRepo } from "./repo.mock";
import type {
  CitizenAipAccountability,
  CitizenAipAccountabilityPerson,
  CitizenAipDetailProjectRow,
  CitizenAipDetailRecord,
  CitizenAipListRecord,
  CitizenAipProjectDetailRecord,
  CitizenAipProjectSector,
  CitizenAipRepo,
  CitizenAipScopeType,
} from "./types";

type ScopeRow = { name: string | null } | null;

type AipRow = {
  id: string;
  fiscal_year: number;
  status: "draft" | "pending_review" | "under_review" | "for_revision" | "published";
  created_at: string;
  published_at: string | null;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
  barangay: ScopeRow | ScopeRow[];
  city: ScopeRow | ScopeRow[];
  municipality: ScopeRow | ScopeRow[];
};

type ProjectRow = {
  id: string;
  aip_id: string;
  aip_ref_code: string;
  program_project_description: string;
  total: number | null;
  category: "health" | "infrastructure" | "other";
  sector_code: string;
  errors: Json | null;
  implementing_agency: string | null;
  source_of_funds: string | null;
  expected_output: string | null;
  start_date: string | null;
  completion_date: string | null;
};

type UploadedFileRow = {
  aip_id: string;
  bucket_id: string;
  object_name: string;
  original_file_name: string | null;
  uploaded_by: string;
  created_at: string;
  is_current: boolean;
};

type ArtifactRow = {
  aip_id: string;
  artifact_json: Json | null;
  artifact_text: string | null;
  created_at: string;
};

type AipReviewRow = {
  aip_id: string;
  reviewer_id: string | null;
  action: "approve" | "request_revision" | "claim_review";
  created_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: RoleType | null;
};

const AIP_SELECT_COLUMNS =
  "id,fiscal_year,status,created_at,published_at,barangay_id,city_id,municipality_id,barangay:barangays!aips_barangay_id_fkey(name),city:cities!aips_city_id_fkey(name),municipality:municipalities!aips_municipality_id_fkey(name)";

const PROJECT_SELECT_COLUMNS = [
  "id",
  "aip_id",
  "aip_ref_code",
  "program_project_description",
  "total",
  "category",
  "sector_code",
  "errors",
  "implementing_agency",
  "source_of_funds",
  "expected_output",
  "start_date",
  "completion_date",
].join(",");

const DEFAULT_SUMMARY =
  "Development and improvement of community infrastructure, social services, and local economic initiatives are prioritized under this annual plan.";

function scopeNameOf(scope: ScopeRow | ScopeRow[] | undefined): string | null {
  if (!scope) return null;
  if (Array.isArray(scope)) return scope[0]?.name ?? null;
  return scope.name ?? null;
}

function normalizeBarangayName(name: string): string {
  return name.replace(/^(brgy\.?|barangay)\s+/i, "").trim();
}

function normalizeCityName(name: string): string {
  return name.replace(/^city of\s+/i, "").trim();
}

function formatRoleLabel(role: RoleType | null): string {
  if (role === "barangay_official") return "Barangay Official";
  if (role === "city_official") return "City Official";
  if (role === "municipal_official") return "Municipal Official";
  if (role === "admin") return "Admin";
  if (role === "citizen") return "Citizen";
  return "Official";
}

function toSectorLabel(sectorCode: string): CitizenAipProjectSector {
  if (sectorCode.startsWith("1000")) return "General Sector";
  if (sectorCode.startsWith("3000")) return "Social Sector";
  if (sectorCode.startsWith("8000")) return "Economic Sector";
  if (sectorCode.startsWith("9000")) return "Other Services";
  return "Unknown";
}

function toScopeType(row: AipRow): CitizenAipScopeType {
  return row.barangay_id ? "barangay" : "city";
}

function toScopeId(row: AipRow): string {
  return row.barangay_id ?? row.city_id ?? row.municipality_id ?? "";
}

function toLguLabel(row: AipRow): string {
  if (row.barangay_id) {
    const baseName = normalizeBarangayName(scopeNameOf(row.barangay) ?? "");
    return baseName ? `Brgy. ${baseName}` : "Brgy. Unknown";
  }

  const cityName = normalizeCityName(scopeNameOf(row.city) ?? scopeNameOf(row.municipality) ?? "");
  return cityName ? `City of ${cityName}` : "City of Unknown";
}

function sumProjectBudget(projects: ProjectRow[]): number {
  return projects.reduce((sum, row) => {
    const value = typeof row.total === "number" && Number.isFinite(row.total) ? row.total : 0;
    return sum + value;
  }, 0);
}

function parseSummary(row: ArtifactRow | undefined): string | null {
  if (!row) return null;
  if (typeof row.artifact_text === "string" && row.artifact_text.trim()) {
    return row.artifact_text.trim();
  }

  if (row.artifact_json && typeof row.artifact_json === "object" && !Array.isArray(row.artifact_json)) {
    const summary = (row.artifact_json as Record<string, unknown>).summary;
    if (typeof summary === "string" && summary.trim()) return summary.trim();
    if (summary && typeof summary === "object" && !Array.isArray(summary)) {
      const text = (summary as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) return text.trim();
    }
  }

  return null;
}

function toProjectRow(row: ProjectRow, hasLguNote: boolean): CitizenAipDetailProjectRow {
  return {
    id: row.id,
    aipId: row.aip_id,
    category: row.category,
    sector: toSectorLabel(row.sector_code),
    projectRefCode: row.aip_ref_code,
    programDescription: row.program_project_description,
    totalAmount: typeof row.total === "number" && Number.isFinite(row.total) ? row.total : 0,
    hasLguNote,
  };
}

function toAccountabilityPerson(profile: ProfileRow | undefined | null): CitizenAipAccountabilityPerson | null {
  if (!profile) return null;
  const roleLabel = formatRoleLabel(profile.role ?? null);
  return {
    id: profile.id,
    name: profile.full_name?.trim() || roleLabel,
    role: profile.role ?? null,
    roleLabel,
  };
}

function toDetailedBullets(projectRows: ProjectRow[]): string[] {
  const bullets = projectRows
    .map((project) => project.program_project_description?.trim())
    .filter((value): value is string => !!value)
    .slice(0, 5);
  return bullets.length ? bullets : [];
}

function buildListRecord(input: {
  aip: AipRow;
  projects: ProjectRow[];
  summary: string | null;
}): CitizenAipListRecord {
  const lguLabel = toLguLabel(input.aip);
  const fiscalYear = input.aip.fiscal_year;

  return {
    id: input.aip.id,
    scopeType: toScopeType(input.aip),
    scopeId: toScopeId(input.aip),
    lguLabel,
    title: `${lguLabel} - Annual Investment Plan (AIP) ${fiscalYear}`,
    description:
      input.summary?.slice(0, 280) ??
      `Annual Investment Plan for ${lguLabel} covering fiscal year ${fiscalYear}.`,
    fiscalYear,
    publishedAt: input.aip.published_at,
    budgetTotal: sumProjectBudget(input.projects),
    projectsCount: input.projects.length,
  };
}

async function getProfilesByIds(userIds: string[]): Promise<Map<string, ProfileRow>> {
  const uniqueIds = Array.from(new Set(userIds.filter((value) => value.trim().length > 0)));
  if (!uniqueIds.length) return new Map();

  try {
    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("profiles")
      .select("id,full_name,role")
      .in("id", uniqueIds);

    if (error) throw new Error(error.message);
    return new Map(((data ?? []) as ProfileRow[]).map((row) => [row.id, row]));
  } catch {
    const client = await supabaseServer();
    const { data, error } = await client
      .from("profiles")
      .select("id,full_name,role")
      .in("id", uniqueIds);

    if (error) throw new Error(error.message);
    return new Map(((data ?? []) as ProfileRow[]).map((row) => [row.id, row]));
  }
}

async function getProjectsByAipIds(aipIds: string[]): Promise<Map<string, ProjectRow[]>> {
  if (!aipIds.length) return new Map();
  const client = await supabaseServer();

  const { data, error } = await client
    .from("projects")
    .select(PROJECT_SELECT_COLUMNS)
    .in("aip_id", aipIds)
    .order("aip_ref_code", { ascending: true });

  if (error) throw new Error(error.message);

  const map = new Map<string, ProjectRow[]>();
  for (const row of (data ?? []) as unknown as ProjectRow[]) {
    const list = map.get(row.aip_id) ?? [];
    list.push(row);
    map.set(row.aip_id, list);
  }
  return map;
}

async function getProjectIdsWithPublicLguNotes(projectIds: string[]): Promise<Set<string>> {
  const uniqueProjectIds = Array.from(new Set(projectIds.filter((value) => value.trim().length > 0)));
  if (!uniqueProjectIds.length) return new Set();

  const client = await supabaseServer();
  const { data, error } = await client
    .from("feedback")
    .select("project_id")
    .eq("target_type", "project")
    .eq("kind", "lgu_note")
    .in("project_id", uniqueProjectIds);

  if (error) throw new Error(error.message);

  const projectIdsWithLguNotes = new Set<string>();
  for (const row of (data ?? []) as Array<{ project_id: string | null }>) {
    if (typeof row.project_id === "string" && row.project_id.length > 0) {
      projectIdsWithLguNotes.add(row.project_id);
    }
  }

  return projectIdsWithLguNotes;
}

async function getLatestSummariesByAipIds(aipIds: string[]): Promise<Map<string, ArtifactRow>> {
  if (!aipIds.length) return new Map();
  const client = await supabaseServer();

  const { data, error } = await client
    .from("extraction_artifacts")
    .select("aip_id,artifact_json,artifact_text,created_at")
    .eq("artifact_type", "summarize")
    .in("aip_id", aipIds)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const map = new Map<string, ArtifactRow>();
  for (const row of (data ?? []) as ArtifactRow[]) {
    if (!map.has(row.aip_id)) map.set(row.aip_id, row);
  }
  return map;
}

async function getCurrentFilesByAipIds(aipIds: string[]): Promise<Map<string, UploadedFileRow>> {
  if (!aipIds.length) return new Map();
  const client = await supabaseServer();

  const { data, error } = await client
    .from("uploaded_files")
    .select("aip_id,bucket_id,object_name,original_file_name,uploaded_by,created_at,is_current")
    .eq("is_current", true)
    .in("aip_id", aipIds)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const map = new Map<string, UploadedFileRow>();
  for (const row of (data ?? []) as UploadedFileRow[]) {
    if (!map.has(row.aip_id)) map.set(row.aip_id, row);
  }
  return map;
}

async function getReviewsByAipId(aipId: string): Promise<AipReviewRow[]> {
  const client = await supabaseServer();
  const { data, error } = await client
    .from("aip_reviews")
    .select("aip_id,reviewer_id,action,created_at")
    .eq("aip_id", aipId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as AipReviewRow[];
}

async function createSignedPdfUrl(file: UploadedFileRow | undefined): Promise<string | null> {
  if (!file) return null;
  const admin = supabaseAdmin();
  const { data, error } = await admin.storage
    .from(file.bucket_id)
    .createSignedUrl(file.object_name, 60 * 60);

  if (error) return null;
  return data.signedUrl ?? null;
}

function buildAccountability(input: {
  uploader: ProfileRow | null;
  uploadedAt: string | null;
  reviews: AipReviewRow[];
  profilesById: Map<string, ProfileRow>;
  publishedAt: string | null;
}): CitizenAipAccountability {
  const latestReviewed = input.reviews.find((review) => !!review.reviewer_id) ?? null;
  const latestApproved = input.reviews.find((review) => review.action === "approve" && !!review.reviewer_id) ?? null;

  return {
    uploadedBy: toAccountabilityPerson(input.uploader),
    reviewedBy: toAccountabilityPerson(
      latestReviewed?.reviewer_id ? input.profilesById.get(latestReviewed.reviewer_id) : null
    ),
    approvedBy: toAccountabilityPerson(
      latestApproved?.reviewer_id ? input.profilesById.get(latestApproved.reviewer_id) : null
    ),
    uploadDate: input.uploadedAt,
    approvalDate: latestApproved?.created_at ?? input.publishedAt,
  };
}

function createSupabaseCitizenAipRepo(): CitizenAipRepo {
  return {
    async listPublishedAips() {
      const client = await supabaseServer();
      const { data, error } = await client
        .from("aips")
        .select(AIP_SELECT_COLUMNS)
        .eq("status", "published")
        .order("fiscal_year", { ascending: false })
        .order("published_at", { ascending: false });

      if (error) throw new Error(error.message);

      const aips = (data ?? []) as AipRow[];
      const aipIds = aips.map((row) => row.id);
      const [projectsByAipId, summariesByAipId] = await Promise.all([
        getProjectsByAipIds(aipIds),
        getLatestSummariesByAipIds(aipIds),
      ]);

      return aips.map((aip) =>
        buildListRecord({
          aip,
          projects: projectsByAipId.get(aip.id) ?? [],
          summary: parseSummary(summariesByAipId.get(aip.id)),
        })
      );
    },

    async getPublishedAipDetail(aipId) {
      const client = await supabaseServer();
      const { data, error } = await client
        .from("aips")
        .select(AIP_SELECT_COLUMNS)
        .eq("id", aipId)
        .eq("status", "published")
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) return null;

      const aip = data as AipRow;

      const [projectsByAipId, summariesByAipId, currentFilesByAipId, reviews, feedbackCountResult] = await Promise.all([
        getProjectsByAipIds([aip.id]),
        getLatestSummariesByAipIds([aip.id]),
        getCurrentFilesByAipIds([aip.id]),
        getReviewsByAipId(aip.id),
        client
          .from("feedback")
          .select("id", { count: "exact", head: true })
          .eq("target_type", "aip")
          .eq("aip_id", aip.id)
          .is("parent_feedback_id", null),
      ]);

      if (feedbackCountResult.error) throw new Error(feedbackCountResult.error.message);

      const projects = projectsByAipId.get(aip.id) ?? [];
      const projectIdsWithLguNotes = await getProjectIdsWithPublicLguNotes(
        projects.map((project) => project.id)
      );
      const summaryText = parseSummary(summariesByAipId.get(aip.id));
      const file = currentFilesByAipId.get(aip.id);
      const uploaderId = file?.uploaded_by ?? null;
      const reviewerIds = reviews
        .map((review) => review.reviewer_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0);

      const profilesById = await getProfilesByIds([...(uploaderId ? [uploaderId] : []), ...reviewerIds]);
      const accountability = buildAccountability({
        uploader: uploaderId ? profilesById.get(uploaderId) ?? null : null,
        uploadedAt: file?.created_at ?? aip.created_at,
        reviews,
        profilesById,
        publishedAt: aip.published_at,
      });

      const listRecord = buildListRecord({
        aip,
        projects,
        summary: summaryText,
      });

      return {
        ...listRecord,
        fileName:
          file?.original_file_name?.trim() ||
          (file?.object_name ? file.object_name.split("/").pop() || `AIP_${aip.fiscal_year}.pdf` : `AIP_${aip.fiscal_year}.pdf`),
        pdfUrl: await createSignedPdfUrl(file),
        summaryText: summaryText ?? DEFAULT_SUMMARY,
        detailedBullets: toDetailedBullets(projects),
        projectRows: projects.map((project) =>
          toProjectRow(project, projectIdsWithLguNotes.has(project.id))
        ),
        accountability,
        feedbackCount: feedbackCountResult.count ?? 0,
      } satisfies CitizenAipDetailRecord;
    },

    async getPublishedAipProjectDetail(input) {
      const client = await supabaseServer();
      const { data: aipData, error: aipError } = await client
        .from("aips")
        .select("id,status")
        .eq("id", input.aipId)
        .eq("status", "published")
        .maybeSingle();

      if (aipError) throw new Error(aipError.message);
      if (!aipData) return null;

      const { data: projectData, error: projectError } = await client
        .from("projects")
        .select(PROJECT_SELECT_COLUMNS)
        .eq("id", input.projectId)
        .eq("aip_id", input.aipId)
        .maybeSingle();

      if (projectError) throw new Error(projectError.message);
      if (!projectData) return null;

      const row = projectData as unknown as ProjectRow;
      return {
        aipId: input.aipId,
        projectId: row.id,
        category: row.category,
        sector: toSectorLabel(row.sector_code),
        projectRefCode: row.aip_ref_code,
        title: row.program_project_description,
        description: row.program_project_description,
        implementingAgency: row.implementing_agency,
        sourceOfFunds: row.source_of_funds,
        expectedOutput: row.expected_output,
        startDate: row.start_date,
        completionDate: row.completion_date,
        totalAmount: typeof row.total === "number" && Number.isFinite(row.total) ? row.total : 0,
        aiIssues: normalizeProjectErrors(row.errors) ?? [],
      } satisfies CitizenAipProjectDetailRecord;
    },
  };
}

export function getCitizenAipRepo(): CitizenAipRepo {
  return selectRepo({
    label: "CitizenAipRepo",
    mock: () => createMockCitizenAipRepo(),
    supabase: () => createSupabaseCitizenAipRepo(),
  });
}

