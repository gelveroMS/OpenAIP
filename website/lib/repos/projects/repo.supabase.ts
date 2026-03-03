import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import {
  toProjectCoverProxyUrl,
  toProjectUpdateMediaProxyUrl,
} from "@/lib/projects/media";
import type {
  HealthProjectDetailsRow,
  InfrastructureProjectDetailsRow,
  ProjectUpdateMediaRow,
  ProjectUpdateRow,
  ProjectRow,
} from "./db.types";
import { mapProjectRowToUiModel } from "./mappers";
import type { ProjectsRepo } from "./repo";
import type {
  HealthProject,
  InfrastructureProject,
  ProjectUpdate,
  ProjectReadOptions,
  ProjectBundle,
  UiProject,
} from "./types";

type ProjectRowWithMeta = ProjectRow;

type AipScopeRow = {
  id: string;
};

type AipMetaRow = {
  id: string;
  fiscal_year: number;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
};

type NameLookupRow = {
  id: string;
  name: string;
};

type ProjectUpdateSelectRow = Pick<
  ProjectUpdateRow,
  | "id"
  | "project_id"
  | "title"
  | "description"
  | "progress_percent"
  | "attendance_count"
  | "status"
  | "hidden_reason"
  | "hidden_violation_category"
  | "created_at"
>;

type ProjectUpdateMediaSelectRow = Pick<
  ProjectUpdateMediaRow,
  "id" | "update_id" | "project_id" | "created_at"
>;

type ProjectUpdateWithoutRef = Omit<ProjectUpdate, "projectRefCode">;

const HIDDEN_PROJECT_UPDATE_PLACEHOLDER =
  "This project update has been hidden due to policy violation.";

const PROJECT_SELECT_COLUMNS = [
  "id",
  "aip_id",
  "extraction_artifact_id",
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
  "errors",
  "category",
  "status",
  "image_url",
  "sector_code",
  "is_human_edited",
  "edited_by",
  "edited_at",
  "created_at",
  "updated_at",
].join(",");

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function toDateLabel(value: string): string {
  return new Date(value).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function hasBarangayScopeHint(options?: ProjectReadOptions): boolean {
  if (!options) return false;
  return options.barangayId !== undefined || options.barangayScopeName !== undefined;
}

function hasCityScopeHint(options?: ProjectReadOptions): boolean {
  if (!options) return false;
  return options.cityId !== undefined || options.cityScopeName !== undefined;
}

async function resolveReadableAipIds(
  client: Awaited<ReturnType<typeof supabaseServer>>,
  options?: ProjectReadOptions
): Promise<Set<string> | null> {
  const enforcePublishedOnly = options?.publishedOnly === true;
  const hasBarangayScope = hasBarangayScopeHint(options);
  const hasCityScope = hasCityScopeHint(options);
  const scoped = hasBarangayScope || hasCityScope;

  if (!enforcePublishedOnly && !scoped) return null;
  if (hasBarangayScope && !options?.barangayId) return new Set<string>();
  if (hasCityScope && !options?.cityId) return new Set<string>();

  let query = client.from("aips").select("id");

  if (enforcePublishedOnly) {
    query = query.eq("status", "published");
  }

  if (options?.barangayId) {
    query = query.eq("barangay_id", options.barangayId);
  }

  if (options?.cityId) {
    query = query.eq("city_id", options.cityId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return new Set(((data ?? []) as AipScopeRow[]).map((row) => row.id));
}

async function loadDetailsByProjectIds(projectIds: string[]) {
  const healthByProjectId = new Map<string, HealthProjectDetailsRow>();
  const infraByProjectId = new Map<string, InfrastructureProjectDetailsRow>();

  if (projectIds.length === 0) {
    return { healthByProjectId, infraByProjectId };
  }

  const client = await supabaseServer();
  const [healthResult, infraResult] = await Promise.all([
    client
      .from("health_project_details")
      .select(
        "project_id,program_name,description,target_participants,total_target_participants,updated_by,updated_at,created_at"
      )
      .in("project_id", projectIds),
    client
      .from("infrastructure_project_details")
      .select(
        "project_id,project_name,contractor_name,contract_cost,start_date,target_completion_date,updated_by,updated_at,created_at"
      )
      .in("project_id", projectIds),
  ]);

  if (healthResult.error) {
    throw new Error(healthResult.error.message);
  }

  if (infraResult.error) {
    throw new Error(infraResult.error.message);
  }

  for (const row of (healthResult.data ?? []) as HealthProjectDetailsRow[]) {
    healthByProjectId.set(row.project_id, row);
  }

  for (const row of (infraResult.data ?? []) as InfrastructureProjectDetailsRow[]) {
    infraByProjectId.set(row.project_id, row);
  }

  return { healthByProjectId, infraByProjectId };
}

async function loadUpdatesByProjectIds(projectIds: string[], options?: ProjectReadOptions) {
  const updatesByProjectId = new Map<string, ProjectUpdateWithoutRef[]>();
  if (projectIds.length === 0) {
    return updatesByProjectId;
  }
  const showHiddenContent = hasBarangayScopeHint(options) || hasCityScopeHint(options);

  const client = await supabaseServer();
  const { data: updatesData, error: updatesError } = await client
    .from("project_updates")
    .select(
      "id,project_id,title,description,progress_percent,attendance_count,status,hidden_reason,hidden_violation_category,created_at"
    )
    .in("project_id", projectIds)
    .in("status", ["active", "hidden"])
    .order("created_at", { ascending: false });
  if (updatesError) {
    throw new Error(updatesError.message);
  }

  const updateRows = (updatesData ?? []) as ProjectUpdateSelectRow[];
  const updateIds = updateRows
    .filter((row) => row.status !== "hidden" || showHiddenContent)
    .map((row) => row.id);

  const mediaByUpdateId = new Map<string, ProjectUpdateMediaSelectRow[]>();
  if (updateIds.length > 0) {
    const { data: mediaData, error: mediaError } = await client
      .from("project_update_media")
      .select("id,update_id,project_id,created_at")
      .in("update_id", updateIds)
      .order("created_at", { ascending: true });
    if (mediaError) {
      throw new Error(mediaError.message);
    }

    for (const row of (mediaData ?? []) as ProjectUpdateMediaSelectRow[]) {
      const list = mediaByUpdateId.get(row.update_id) ?? [];
      list.push(row);
      mediaByUpdateId.set(row.update_id, list);
    }
  }

  for (const row of updateRows) {
    const isHidden = row.status === "hidden";
    const isRedacted = isHidden && !showHiddenContent;
    if (isHidden && !showHiddenContent) {
      const nextHiddenUpdate: ProjectUpdateWithoutRef = {
        id: row.id,
        title: row.title,
        date: toDateLabel(row.created_at),
        description: HIDDEN_PROJECT_UPDATE_PLACEHOLDER,
        progressPercent: row.progress_percent,
        attendanceCount: row.attendance_count ?? undefined,
        photoUrls: undefined,
        isHidden: true,
        isRedacted: true,
        hiddenReason: null,
        violationCategory: null,
      };

      const hiddenList = updatesByProjectId.get(row.project_id) ?? [];
      hiddenList.push(nextHiddenUpdate);
      updatesByProjectId.set(row.project_id, hiddenList);
      continue;
    }

    const mediaRows = mediaByUpdateId.get(row.id) ?? [];
    const nextUpdate: ProjectUpdateWithoutRef = {
      id: row.id,
      title: row.title,
      date: toDateLabel(row.created_at),
      description: row.description,
      progressPercent: row.progress_percent,
      attendanceCount: row.attendance_count ?? undefined,
      photoUrls:
        mediaRows.length > 0
          ? mediaRows.map((mediaRow) => toProjectUpdateMediaProxyUrl(mediaRow.id))
          : undefined,
      isHidden,
      isRedacted,
      hiddenReason: isHidden ? row.hidden_reason : null,
      violationCategory: isHidden ? row.hidden_violation_category : null,
    };

    const list = updatesByProjectId.get(row.project_id) ?? [];
    list.push(nextUpdate);
    updatesByProjectId.set(row.project_id, list);
  }

  return updatesByProjectId;
}

function normalizeBarangayName(name: string): string {
  return name.replace(/^(brgy\.?|barangay)\s+/i, "").trim();
}

function normalizeCityName(name: string): string {
  return name.replace(/^city of\s+/i, "").trim();
}

async function loadAipMetaByAipIds(aipIds: string[]) {
  const fiscalYearByAipId = new Map<string, number>();
  const lguLabelByAipId = new Map<string, string>();
  if (aipIds.length === 0) {
    return { fiscalYearByAipId, lguLabelByAipId };
  }

  const client = await supabaseServer();
  const { data, error } = await client
    .from("aips")
    .select("id,fiscal_year,barangay_id,city_id,municipality_id")
    .in("id", aipIds);

  if (error) {
    throw new Error(error.message);
  }

  const aipRows = (data ?? []) as AipMetaRow[];
  const barangayIds = Array.from(
    new Set(
      aipRows
        .map((row) => row.barangay_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );
  const cityIds = Array.from(
    new Set(
      aipRows
        .map((row) => row.city_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );
  const municipalityIds = Array.from(
    new Set(
      aipRows
        .map((row) => row.municipality_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );

  const [barangayResult, cityResult, municipalityResult] = await Promise.all([
    barangayIds.length
      ? client.from("barangays").select("id,name").in("id", barangayIds)
      : Promise.resolve({ data: [], error: null }),
    cityIds.length
      ? client.from("cities").select("id,name").in("id", cityIds)
      : Promise.resolve({ data: [], error: null }),
    municipalityIds.length
      ? client.from("municipalities").select("id,name").in("id", municipalityIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (barangayResult.error) {
    throw new Error(barangayResult.error.message);
  }
  if (cityResult.error) {
    throw new Error(cityResult.error.message);
  }
  if (municipalityResult.error) {
    throw new Error(municipalityResult.error.message);
  }

  const barangayNameById = new Map<string, string>();
  const cityNameById = new Map<string, string>();
  const municipalityNameById = new Map<string, string>();

  for (const row of (barangayResult.data ?? []) as NameLookupRow[]) {
    const normalizedName = normalizeBarangayName(row.name);
    if (normalizedName) {
      barangayNameById.set(row.id, normalizedName);
    }
  }

  for (const row of (cityResult.data ?? []) as NameLookupRow[]) {
    const normalizedName = normalizeCityName(row.name);
    if (normalizedName) {
      cityNameById.set(row.id, normalizedName);
    }
  }

  for (const row of (municipalityResult.data ?? []) as NameLookupRow[]) {
    const normalizedName = normalizeCityName(row.name);
    if (normalizedName) {
      municipalityNameById.set(row.id, normalizedName);
    }
  }

  for (const row of aipRows) {
    fiscalYearByAipId.set(row.id, row.fiscal_year);

    if (row.barangay_id) {
      const name = barangayNameById.get(row.barangay_id);
      if (name) {
        lguLabelByAipId.set(row.id, `Brgy. ${name}`);
        continue;
      }
    }

    if (row.city_id) {
      const name = cityNameById.get(row.city_id);
      if (name) {
        lguLabelByAipId.set(row.id, `City of ${name}`);
        continue;
      }
    }

    if (row.municipality_id) {
      const name = municipalityNameById.get(row.municipality_id);
      if (name) {
        lguLabelByAipId.set(row.id, `City of ${name}`);
        continue;
      }
    }

    lguLabelByAipId.set(row.id, "Unknown LGU");
  }

  return { fiscalYearByAipId, lguLabelByAipId };
}

function mapProjectToUiModel(
  row: ProjectRowWithMeta,
  details: {
    healthByProjectId: Map<string, HealthProjectDetailsRow>;
    infraByProjectId: Map<string, InfrastructureProjectDetailsRow>;
  },
  updatesByProjectId: Map<string, ProjectUpdateWithoutRef[]>,
  aipFiscalYearByAipId: Map<string, number>,
  aipLguLabelByAipId: Map<string, string>
): UiProject {
  const health = details.healthByProjectId.get(row.id) ?? null;
  const infra = details.infraByProjectId.get(row.id) ?? null;
  const updates = (updatesByProjectId.get(row.id) ?? []).map((update) => ({
    ...update,
    projectRefCode: row.aip_ref_code,
  }));

  const mapped = mapProjectRowToUiModel(row, health, infra, {
    status: row.status,
    imageUrl: row.image_url ? toProjectCoverProxyUrl(row.id) : null,
    year: aipFiscalYearByAipId.get(row.aip_id) ?? null,
    lguLabel: aipLguLabelByAipId.get(row.aip_id) ?? "Unknown LGU",
  });

  return {
    ...mapped,
    updates,
  };
}

async function listProjectsInternal(input?: {
  aipId?: string;
  category?: "health" | "infrastructure";
  options?: ProjectReadOptions;
}): Promise<UiProject[]> {
  const client = await supabaseServer();
  const scopedAipIds = await resolveReadableAipIds(client, input?.options);
  if (scopedAipIds && scopedAipIds.size === 0) {
    return [];
  }

  let query = client.from("projects").select(PROJECT_SELECT_COLUMNS);

  if (input?.aipId) {
    query = query.eq("aip_id", input.aipId);
  }

  if (input?.category) {
    query = query.eq("category", input.category);
  }

  if (scopedAipIds) {
    query = query.in("aip_id", Array.from(scopedAipIds));
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as ProjectRowWithMeta[];
  const projectIds = rows.map((row) => row.id);
  const aipIds = Array.from(new Set(rows.map((row) => row.aip_id)));
  const [details, updatesByProjectId, aipMeta] = await Promise.all([
    loadDetailsByProjectIds(projectIds),
    loadUpdatesByProjectIds(projectIds, input?.options),
    loadAipMetaByAipIds(aipIds),
  ]);

  return rows.map((row) =>
    mapProjectToUiModel(
      row,
      details,
      updatesByProjectId,
      aipMeta.fiscalYearByAipId,
      aipMeta.lguLabelByAipId
    )
  );
}

async function getProjectByRefOrId(
  projectIdOrRefCode: string,
  options?: ProjectReadOptions
): Promise<UiProject | null> {
  const client = await supabaseServer();
  const scopedAipIds = await resolveReadableAipIds(client, options);
  if (scopedAipIds && scopedAipIds.size === 0) {
    return null;
  }

  let row: ProjectRowWithMeta | null = null;

  if (isUuid(projectIdOrRefCode)) {
    let byId = client
      .from("projects")
      .select(PROJECT_SELECT_COLUMNS)
      .eq("id", projectIdOrRefCode);
    if (scopedAipIds) {
      byId = byId.in("aip_id", Array.from(scopedAipIds));
    }
    const byIdResult = await byId.maybeSingle();

    if (byIdResult.error) {
      throw new Error(byIdResult.error.message);
    }

    row = (byIdResult.data as ProjectRowWithMeta | null) ?? null;
  }

  if (!row) {
    let byRefCode = client
      .from("projects")
      .select(PROJECT_SELECT_COLUMNS)
      .eq("aip_ref_code", projectIdOrRefCode)
      .order("created_at", { ascending: false })
      .limit(2);
    if (scopedAipIds) {
      byRefCode = byRefCode.in("aip_id", Array.from(scopedAipIds));
    }
    const byRefCodeResult = await byRefCode;

    if (byRefCodeResult.error) {
      throw new Error(byRefCodeResult.error.message);
    }

    const rows = ((byRefCodeResult.data ?? []) as unknown) as ProjectRowWithMeta[];
    row = rows[0] ?? null;
  }

  if (!row) {
    return null;
  }

  if (scopedAipIds && !scopedAipIds.has(row.aip_id)) {
    return null;
  }

  const [details, updatesByProjectId, aipMeta] = await Promise.all([
    loadDetailsByProjectIds([row.id]),
    loadUpdatesByProjectIds([row.id], options),
    loadAipMetaByAipIds([row.aip_id]),
  ]);
  return mapProjectToUiModel(
    row,
    details,
    updatesByProjectId,
    aipMeta.fiscalYearByAipId,
    aipMeta.lguLabelByAipId
  );
}

export function createSupabaseProjectsRepo(): ProjectsRepo {
  return {
    async listByAip(aipId: string, options?: ProjectReadOptions): Promise<UiProject[]> {
      return listProjectsInternal({ aipId, options });
    },

    async getById(projectId: string, options?: ProjectReadOptions): Promise<UiProject | null> {
      return getProjectByRefOrId(projectId, options);
    },

    async listHealth(options?: ProjectReadOptions): Promise<HealthProject[]> {
      const projects = await listProjectsInternal({ category: "health", options });
      return projects.filter((project) => project.kind === "health") as HealthProject[];
    },

    async listInfrastructure(options?: ProjectReadOptions): Promise<InfrastructureProject[]> {
      const projects = await listProjectsInternal({ category: "infrastructure", options });
      return projects.filter((project) => project.kind === "infrastructure") as InfrastructureProject[];
    },

    async getByRefCode(
      projectRefCode: string,
      options?: ProjectReadOptions
    ): Promise<ProjectBundle | null> {
      const project = await getProjectByRefOrId(projectRefCode, options);
      if (!project) return null;
      if (project.kind !== "health" && project.kind !== "infrastructure") {
        return null;
      }
      return project as ProjectBundle;
    },
  };
}
