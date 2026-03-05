import type { SupabaseAdminClient } from "@/lib/supabase/admin";
import type { NotificationScopeType } from "./events";

type ProfileRole = "citizen" | "barangay_official" | "city_official" | "municipal_official" | "admin";

type ProfileRecipientRow = {
  id: string;
  role: ProfileRole;
  email: string | null;
  full_name?: string | null;
};

type AipScopeRow = {
  id: string;
  fiscal_year?: number | null;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
};

type ProjectScopeRow = {
  id: string;
  aip_id: string;
  category: "health" | "infrastructure" | "other" | null;
  program_project_description?: string | null;
};

type FeedbackScopeRow = {
  id: string;
  target_type: "aip" | "project";
  aip_id: string | null;
  project_id: string | null;
  parent_feedback_id: string | null;
  author_id: string | null;
  kind?: string | null;
  body?: string | null;
};

type ProjectUpdateScopeRow = {
  id: string;
  project_id: string;
  aip_id: string;
  status: "active" | "hidden";
};

type ProjectUpdateTemplateRow = {
  id: string;
  title: string | null;
  description: string | null;
  status: "active" | "hidden";
};

export type NotificationRecipient = {
  userId: string;
  role: ProfileRole;
  email: string | null;
  scopeType: NotificationScopeType;
};

export type ResolvedAipScope = {
  aipId: string;
  barangayId: string | null;
  cityId: string | null;
  municipalityId: string | null;
};

export type ResolvedFeedbackContext = {
  feedbackId: string;
  authorUserId: string | null;
  rootAuthorUserId: string | null;
  targetType: "aip" | "project";
  aipId: string | null;
  projectId: string | null;
  parentFeedbackId: string | null;
  rootFeedbackId: string | null;
  projectCategory: "health" | "infrastructure" | "other" | null;
  scope: ResolvedAipScope | null;
};

export type ResolvedProjectUpdateContext = {
  updateId: string;
  projectId: string;
  aipId: string;
  status: "active" | "hidden";
  projectCategory: "health" | "infrastructure" | "other" | null;
  scope: ResolvedAipScope | null;
};

export type AipTemplateContext = {
  fiscalYear: number | null;
  lguName: string | null;
  scopeLabel: string | null;
};

export type ProjectTemplateContext = {
  projectName: string | null;
};

export type FeedbackTemplateContext = {
  feedbackKind: string | null;
  feedbackBody: string | null;
  entityLabel: string | null;
  targetLabel: string | null;
  targetType: "aip" | "project" | null;
};

export type ProjectUpdateTemplateContext = {
  updateTitle: string | null;
  updateBody: string | null;
  status: "active" | "hidden" | null;
};

export function toScopeTypeFromRole(role: ProfileRole): NotificationScopeType {
  if (role === "admin") return "admin";
  if (role === "citizen") return "citizen";
  if (role === "barangay_official") return "barangay";
  return "city";
}

function normalizeEmail(value: string | null): string | null {
  if (!value) return null;
  const email = value.trim();
  return email.length > 0 ? email : null;
}

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

async function resolveLguNameFromScope(
  admin: SupabaseAdminClient,
  scope: Pick<ResolvedAipScope, "barangayId" | "cityId" | "municipalityId">
): Promise<{ lguName: string | null; scopeLabel: string | null }> {
  if (scope.barangayId) {
    const { data, error } = await admin
      .from("barangays")
      .select("name")
      .eq("id", scope.barangayId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data ?? null) as { name: string | null } | null;
    return { lguName: normalizeText(row?.name), scopeLabel: "barangay" };
  }

  if (scope.cityId) {
    const { data, error } = await admin
      .from("cities")
      .select("name")
      .eq("id", scope.cityId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data ?? null) as { name: string | null } | null;
    return { lguName: normalizeText(row?.name), scopeLabel: "city" };
  }

  if (scope.municipalityId) {
    const { data, error } = await admin
      .from("municipalities")
      .select("name")
      .eq("id", scope.municipalityId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data ?? null) as { name: string | null } | null;
    return { lguName: normalizeText(row?.name), scopeLabel: "municipality" };
  }

  return { lguName: null, scopeLabel: null };
}

function dedupeRecipients(input: NotificationRecipient[]): NotificationRecipient[] {
  const seen = new Set<string>();
  const unique: NotificationRecipient[] = [];
  for (const recipient of input) {
    if (seen.has(recipient.userId)) continue;
    seen.add(recipient.userId);
    unique.push(recipient);
  }
  return unique;
}

async function queryProfiles(
  admin: SupabaseAdminClient,
  queryBuilder: PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<NotificationRecipient[]> {
  const { data, error } = await queryBuilder;
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as ProfileRecipientRow[];
  return rows.map((row) => ({
    userId: row.id,
    role: row.role,
    email: normalizeEmail(row.email),
    scopeType: toScopeTypeFromRole(row.role),
  }));
}

export async function getCitizenRecipientsForBarangay(
  admin: SupabaseAdminClient,
  barangayId: string
): Promise<NotificationRecipient[]> {
  return queryProfiles(
    admin,
    admin
      .from("profiles")
      .select("id,role,email")
      .eq("role", "citizen")
      .eq("is_active", true)
      .eq("barangay_id", barangayId)
  );
}

export async function getCitizenRecipientsForCity(
  admin: SupabaseAdminClient,
  cityId: string
): Promise<NotificationRecipient[]> {
  const { data: barangayData, error: barangayError } = await admin
    .from("barangays")
    .select("id")
    .eq("city_id", cityId)
    .eq("is_active", true);
  if (barangayError) {
    throw new Error(barangayError.message);
  }

  const barangayIds = ((barangayData ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (barangayIds.length === 0) return [];

  return queryProfiles(
    admin,
    admin
      .from("profiles")
      .select("id,role,email")
      .eq("role", "citizen")
      .eq("is_active", true)
      .in("barangay_id", barangayIds)
  );
}

export async function getBarangayOfficialRecipients(
  admin: SupabaseAdminClient,
  barangayId: string
): Promise<NotificationRecipient[]> {
  return queryProfiles(
    admin,
    admin
      .from("profiles")
      .select("id,role,email")
      .eq("role", "barangay_official")
      .eq("is_active", true)
      .eq("barangay_id", barangayId)
  );
}

export async function getCityOfficialRecipients(
  admin: SupabaseAdminClient,
  cityId: string
): Promise<NotificationRecipient[]> {
  return queryProfiles(
    admin,
    admin
      .from("profiles")
      .select("id,role,email")
      .eq("role", "city_official")
      .eq("is_active", true)
      .eq("city_id", cityId)
  );
}

export async function getAdminRecipients(
  admin: SupabaseAdminClient
): Promise<NotificationRecipient[]> {
  return queryProfiles(
    admin,
    admin
      .from("profiles")
      .select("id,role,email")
      .eq("role", "admin")
      .eq("is_active", true)
  );
}

export async function getRecipientByUserId(
  admin: SupabaseAdminClient,
  userId: string
): Promise<NotificationRecipient | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("id,role,email")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as ProfileRecipientRow;
  return {
    userId: row.id,
    role: row.role,
    email: normalizeEmail(row.email),
    scopeType: toScopeTypeFromRole(row.role),
  };
}

export async function resolveAipScope(
  admin: SupabaseAdminClient,
  aipId: string
): Promise<ResolvedAipScope | null> {
  const { data, error } = await admin
    .from("aips")
    .select("id,barangay_id,city_id,municipality_id")
    .eq("id", aipId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as AipScopeRow;
  let cityId = row.city_id;
  if (!cityId && row.barangay_id) {
    const { data: barangay, error: barangayError } = await admin
      .from("barangays")
      .select("city_id")
      .eq("id", row.barangay_id)
      .maybeSingle();
    if (barangayError) throw new Error(barangayError.message);
    cityId = ((barangay ?? null) as { city_id: string | null } | null)?.city_id ?? null;
  }

  return {
    aipId: row.id,
    barangayId: row.barangay_id,
    cityId,
    municipalityId: row.municipality_id,
  };
}

export async function resolveAipTemplateContext(
  admin: SupabaseAdminClient,
  aipId: string
): Promise<AipTemplateContext | null> {
  const { data, error } = await admin
    .from("aips")
    .select("id,fiscal_year,barangay_id,city_id,municipality_id")
    .eq("id", aipId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as AipScopeRow;
  const scope = await resolveAipScope(admin, aipId);
  const lgu = await resolveLguNameFromScope(admin, {
    barangayId: scope?.barangayId ?? row.barangay_id,
    cityId: scope?.cityId ?? row.city_id,
    municipalityId: scope?.municipalityId ?? row.municipality_id,
  });

  return {
    fiscalYear: typeof row.fiscal_year === "number" ? row.fiscal_year : null,
    lguName: lgu.lguName,
    scopeLabel: lgu.scopeLabel,
  };
}

export async function resolveProjectScope(
  admin: SupabaseAdminClient,
  projectId: string
): Promise<{
  projectId: string;
  aipId: string;
  projectCategory: "health" | "infrastructure" | "other" | null;
  scope: ResolvedAipScope | null;
} | null> {
  const { data, error } = await admin
    .from("projects")
    .select("id,aip_id,category")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const project = data as ProjectScopeRow;
  const scope = await resolveAipScope(admin, project.aip_id);
  return {
    projectId: project.id,
    aipId: project.aip_id,
    projectCategory: project.category,
    scope,
  };
}

export async function resolveProjectTemplateContext(
  admin: SupabaseAdminClient,
  projectId: string
): Promise<ProjectTemplateContext | null> {
  const { data, error } = await admin
    .from("projects")
    .select("id,category,program_project_description")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const project = data as ProjectScopeRow;
  let projectName: string | null = null;

  if (project.category === "infrastructure") {
    const { data: detail, error: detailError } = await admin
      .from("infrastructure_project_details")
      .select("project_name")
      .eq("project_id", projectId)
      .maybeSingle();
    if (detailError) throw new Error(detailError.message);
    projectName = normalizeText(
      ((detail ?? null) as { project_name: string | null } | null)?.project_name
    );
  } else if (project.category === "health") {
    const { data: detail, error: detailError } = await admin
      .from("health_project_details")
      .select("program_name")
      .eq("project_id", projectId)
      .maybeSingle();
    if (detailError) throw new Error(detailError.message);
    projectName = normalizeText(
      ((detail ?? null) as { program_name: string | null } | null)?.program_name
    );
  }

  if (!projectName) {
    projectName = normalizeText(project.program_project_description ?? null);
  }

  return { projectName };
}

export async function resolveFeedbackContext(
  admin: SupabaseAdminClient,
  feedbackId: string
): Promise<ResolvedFeedbackContext | null> {
  const { data, error } = await admin
    .from("feedback")
    .select("id,target_type,aip_id,project_id,parent_feedback_id,author_id")
    .eq("id", feedbackId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as FeedbackScopeRow;
  const rootFeedbackId = row.parent_feedback_id ?? row.id;
  let rootAuthorUserId: string | null = row.parent_feedback_id ? null : row.author_id;

  if (row.parent_feedback_id) {
    const { data: rootData, error: rootError } = await admin
      .from("feedback")
      .select("id,author_id")
      .eq("id", rootFeedbackId)
      .maybeSingle();
    if (rootError) throw new Error(rootError.message);

    const rootRow = (rootData ?? null) as { id: string; author_id: string | null } | null;
    rootAuthorUserId = rootRow?.author_id ?? null;
  }

  if (row.target_type === "aip" && row.aip_id) {
    const scope = await resolveAipScope(admin, row.aip_id);
    return {
      feedbackId: row.id,
      authorUserId: row.author_id,
      rootAuthorUserId,
      targetType: row.target_type,
      aipId: row.aip_id,
      projectId: null,
      parentFeedbackId: row.parent_feedback_id,
      rootFeedbackId,
      projectCategory: null,
      scope,
    };
  }
  if (row.target_type === "project" && row.project_id) {
    const projectScope = await resolveProjectScope(admin, row.project_id);
    return {
      feedbackId: row.id,
      authorUserId: row.author_id,
      rootAuthorUserId,
      targetType: row.target_type,
      aipId: projectScope?.aipId ?? null,
      projectId: row.project_id,
      parentFeedbackId: row.parent_feedback_id,
      rootFeedbackId,
      projectCategory: projectScope?.projectCategory ?? null,
      scope: projectScope?.scope ?? null,
    };
  }

  return {
    feedbackId: row.id,
    authorUserId: row.author_id,
    rootAuthorUserId,
    targetType: row.target_type,
    aipId: row.aip_id,
    projectId: row.project_id,
    parentFeedbackId: row.parent_feedback_id,
    rootFeedbackId,
    projectCategory: null,
    scope: null,
  };
}

export async function resolveFeedbackTemplateContext(
  admin: SupabaseAdminClient,
  feedbackId: string
): Promise<FeedbackTemplateContext | null> {
  const { data, error } = await admin
    .from("feedback")
    .select("id,target_type,aip_id,project_id,kind,body")
    .eq("id", feedbackId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as FeedbackScopeRow;
  let entityLabel: string | null = null;
  let targetLabel: string | null = null;

  if (row.target_type === "aip" && row.aip_id) {
    const aipContext = await resolveAipTemplateContext(admin, row.aip_id);
    targetLabel =
      typeof aipContext?.fiscalYear === "number" ? `AIP FY ${aipContext.fiscalYear}` : "AIP";
    entityLabel = targetLabel;
  } else if (row.target_type === "project" && row.project_id) {
    const projectContext = await resolveProjectTemplateContext(admin, row.project_id);
    targetLabel = projectContext?.projectName ?? "Project";
    entityLabel = targetLabel;
  }

  return {
    feedbackKind: normalizeText(row.kind ?? null),
    feedbackBody: normalizeText(row.body ?? null),
    entityLabel,
    targetLabel,
    targetType: row.target_type ?? null,
  };
}

export async function resolveProjectUpdateContext(
  admin: SupabaseAdminClient,
  updateId: string
): Promise<ResolvedProjectUpdateContext | null> {
  const { data, error } = await admin
    .from("project_updates")
    .select("id,project_id,aip_id,status")
    .eq("id", updateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as ProjectUpdateScopeRow;
  const projectScope = await resolveProjectScope(admin, row.project_id);
  return {
    updateId: row.id,
    projectId: row.project_id,
    aipId: row.aip_id,
    status: row.status,
    projectCategory: projectScope?.projectCategory ?? null,
    scope: projectScope?.scope ?? (await resolveAipScope(admin, row.aip_id)),
  };
}

export async function resolveProjectUpdateTemplateContext(
  admin: SupabaseAdminClient,
  updateId: string
): Promise<ProjectUpdateTemplateContext | null> {
  const { data, error } = await admin
    .from("project_updates")
    .select("id,title,description,status")
    .eq("id", updateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as ProjectUpdateTemplateRow;
  return {
    updateTitle: normalizeText(row.title ?? null),
    updateBody: normalizeText(row.description ?? null),
    status: row.status ?? null,
  };
}

export async function resolveActorDisplayName(
  admin: SupabaseAdminClient,
  userId: string | null | undefined
): Promise<string | null> {
  const normalizedUserId = normalizeText(userId ?? null);
  if (!normalizedUserId) return null;

  const { data, error } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", normalizedUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const row = (data ?? null) as { full_name: string | null } | null;
  return normalizeText(row?.full_name);
}

export function mergeRecipients(...groups: NotificationRecipient[][]): NotificationRecipient[] {
  return dedupeRecipients(groups.flat());
}
