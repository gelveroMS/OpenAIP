import type { SupabaseAdminClient } from "@/lib/supabase/admin";
import type { NotificationScopeType } from "./events";

type ProfileRole = "citizen" | "barangay_official" | "city_official" | "municipal_official" | "admin";

type ProfileRecipientRow = {
  id: string;
  role: ProfileRole;
  email: string | null;
};

type AipScopeRow = {
  id: string;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
};

type ProjectScopeRow = {
  id: string;
  aip_id: string;
};

type FeedbackScopeRow = {
  id: string;
  target_type: "aip" | "project";
  aip_id: string | null;
  project_id: string | null;
  author_id: string | null;
};

type ProjectUpdateScopeRow = {
  id: string;
  project_id: string;
  aip_id: string;
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
  targetType: "aip" | "project";
  aipId: string | null;
  projectId: string | null;
  scope: ResolvedAipScope | null;
};

export type ResolvedProjectUpdateContext = {
  updateId: string;
  projectId: string;
  aipId: string;
  status: "active" | "hidden";
  scope: ResolvedAipScope | null;
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

export async function resolveProjectScope(
  admin: SupabaseAdminClient,
  projectId: string
): Promise<{ projectId: string; aipId: string; scope: ResolvedAipScope | null } | null> {
  const { data, error } = await admin
    .from("projects")
    .select("id,aip_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const project = data as ProjectScopeRow;
  const scope = await resolveAipScope(admin, project.aip_id);
  return {
    projectId: project.id,
    aipId: project.aip_id,
    scope,
  };
}

export async function resolveFeedbackContext(
  admin: SupabaseAdminClient,
  feedbackId: string
): Promise<ResolvedFeedbackContext | null> {
  const { data, error } = await admin
    .from("feedback")
    .select("id,target_type,aip_id,project_id,author_id")
    .eq("id", feedbackId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as FeedbackScopeRow;
  if (row.target_type === "aip" && row.aip_id) {
    const scope = await resolveAipScope(admin, row.aip_id);
    return {
      feedbackId: row.id,
      authorUserId: row.author_id,
      targetType: row.target_type,
      aipId: row.aip_id,
      projectId: null,
      scope,
    };
  }
  if (row.target_type === "project" && row.project_id) {
    const projectScope = await resolveProjectScope(admin, row.project_id);
    return {
      feedbackId: row.id,
      authorUserId: row.author_id,
      targetType: row.target_type,
      aipId: projectScope?.aipId ?? null,
      projectId: row.project_id,
      scope: projectScope?.scope ?? null,
    };
  }

  return {
    feedbackId: row.id,
    authorUserId: row.author_id,
    targetType: row.target_type,
    aipId: row.aip_id,
    projectId: row.project_id,
    scope: null,
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
  return {
    updateId: row.id,
    projectId: row.project_id,
    aipId: row.aip_id,
    status: row.status,
    scope: await resolveAipScope(admin, row.aip_id),
  };
}

export function mergeRecipients(...groups: NotificationRecipient[][]): NotificationRecipient[] {
  return dedupeRecipients(groups.flat());
}
