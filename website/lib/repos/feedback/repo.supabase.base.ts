import type { FeedbackKind, RoleType } from "@/lib/contracts/databasev2";
import { withWorkflowActivityMetadata } from "@/lib/audit/workflow-metadata";
import {
  CITIZEN_INITIATED_FEEDBACK_KINDS,
  isCitizenInitiatedFeedbackKind,
} from "@/lib/constants/feedback-kind";
import {
  buildFeedbackLguLabel,
  toFeedbackAuthorDisplayRole,
  toFeedbackRoleLabel,
} from "@/lib/feedback/author-labels";
import type {
  CommentRepo,
  CommentTargetLookup,
  FeedbackItem,
  FeedbackRepo,
  FeedbackTarget,
  FeedbackThreadRow,
  FeedbackThreadsRepo,
} from "./repo";
import type { CommentMessage, CommentThread } from "./types";

type SupabaseQueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type SupabaseFilterQueryLike = PromiseLike<SupabaseQueryResult> & {
  delete: (...args: unknown[]) => SupabaseFilterQueryLike;
  eq: (...args: unknown[]) => SupabaseFilterQueryLike;
  filter: (...args: unknown[]) => SupabaseFilterQueryLike;
  gte: (...args: unknown[]) => SupabaseFilterQueryLike;
  in: (...args: unknown[]) => SupabaseFilterQueryLike;
  insert: (...args: unknown[]) => SupabaseFilterQueryLike;
  is: (...args: unknown[]) => SupabaseFilterQueryLike;
  limit: (...args: unknown[]) => SupabaseFilterQueryLike;
  maybeSingle: () => Promise<SupabaseQueryResult>;
  or: (...args: unknown[]) => SupabaseFilterQueryLike;
  order: (...args: unknown[]) => SupabaseFilterQueryLike;
  select: (...args: unknown[]) => SupabaseFilterQueryLike;
  single: () => Promise<SupabaseQueryResult>;
  update: (...args: unknown[]) => SupabaseFilterQueryLike;
};

type SupabaseQueryLike = {
  delete: (...args: unknown[]) => SupabaseFilterQueryLike;
  insert: (...args: unknown[]) => SupabaseFilterQueryLike;
  select: (...args: unknown[]) => SupabaseFilterQueryLike;
  update: (...args: unknown[]) => SupabaseFilterQueryLike;
};

type SupabaseClientLike = {
  from: (table: string) => SupabaseQueryLike;
  schema?: (name: string) => {
    from: (table: string) => SupabaseQueryLike;
  };
  rpc?: (fn: string, args: Record<string, unknown>) => Promise<SupabaseQueryResult>;
  auth?: {
    getUser: () => Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
  };
};

type GetClient = () => Promise<SupabaseClientLike>;

type FeedbackSelectRow = {
  id: string;
  target_type: "aip" | "project";
  aip_id: string | null;
  project_id: string | null;
  parent_feedback_id: string | null;
  source: "human" | "ai";
  kind: FeedbackKind;
  body: string;
  author_id: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

type ProfileSelectRow = {
  id: string;
  role: RoleType | null;
  full_name: string | null;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
  barangay_name?: string | null;
  city_name?: string | null;
  municipality_name?: string | null;
};

type ScopeNameMaps = {
  barangayNameById: Map<string, string>;
  cityNameById: Map<string, string>;
  municipalityNameById: Map<string, string>;
};

type ProjectLookupRow = {
  id: string;
  aip_id: string;
  aip_ref_code: string;
  program_project_description: string;
  category: string;
  start_date: string | null;
  completion_date: string | null;
};

type AipLookupRow = {
  id: string;
  fiscal_year: number;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
};

type InboxScope = "barangay" | "city";

type ResolvedInboxAccess =
  | { mode: "scoped"; scope: InboxScope; scopeId: string }
  | { mode: "deny" }
  | { mode: "unscoped" };

type ScopedProjectLookupRow = {
  id: string;
  aip_id: string;
};

const FEEDBACK_SELECT_COLUMNS = [
  "id",
  "target_type",
  "aip_id",
  "project_id",
  "parent_feedback_id",
  "source",
  "kind",
  "body",
  "author_id",
  "is_public",
  "created_at",
  "updated_at",
].join(",");

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function toCommentAuthorRole(
  role: RoleType | null | undefined
): CommentMessage["authorRole"] {
  if (role === "barangay_official") return "barangay_official";
  if (role === "city_official" || role === "municipal_official") {
    return "city_official";
  }
  if (role === "admin") return "admin";
  return "citizen";
}

function mapFeedbackRowToItem(row: FeedbackSelectRow): FeedbackItem {
  return {
    id: row.id,
    targetType: row.target_type,
    aipId: row.aip_id,
    projectId: row.project_id,
    parentFeedbackId: row.parent_feedback_id,
    kind: row.kind,
    body: row.body,
    authorId: row.author_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isPublic: row.is_public,
  };
}

function mapFeedbackRowToThreadRow(row: FeedbackSelectRow): FeedbackThreadRow {
  return {
    id: row.id,
    target_type: row.target_type,
    aip_id: row.aip_id,
    project_id: row.project_id,
    parent_feedback_id: row.parent_feedback_id,
    body: row.body,
    author_id: row.author_id ?? "system",
    created_at: row.created_at,
  };
}

function toCommentTarget(row: FeedbackSelectRow): CommentThread["target"] {
  if (row.target_type === "project" && row.project_id) {
    return {
      targetKind: "project",
      projectId: row.project_id,
    };
  }

  return {
    targetKind: "aip_item",
    aipId: row.aip_id ?? "unknown",
    aipItemId: row.id,
  };
}

function getYearFromDateString(value?: string | null): number | undefined {
  if (!value) return undefined;
  const year = new Date(value).getFullYear();
  if (!Number.isFinite(year)) return undefined;
  return year;
}

async function listFeedbackRowsByParentIds(
  client: SupabaseClientLike,
  parentIds: string[]
): Promise<FeedbackSelectRow[]> {
  if (parentIds.length === 0) return [];
  const { data, error } = await client
    .from("feedback")
    .select(FEEDBACK_SELECT_COLUMNS)
    .in("parent_feedback_id", parentIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as FeedbackSelectRow[];
}

async function listFeedbackRowsByThreadId(
  client: SupabaseClientLike,
  threadId: string
): Promise<FeedbackSelectRow[]> {
  const { data, error } = await client
    .from("feedback")
    .select(FEEDBACK_SELECT_COLUMNS)
    .or(`id.eq.${threadId},parent_feedback_id.eq.${threadId}`)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as FeedbackSelectRow[];
}

async function listProfilesByIds(
  client: SupabaseClientLike,
  profileIds: string[]
): Promise<Map<string, ProfileSelectRow>> {
  const deduped = Array.from(new Set(profileIds.filter(Boolean)));
  const map = new Map<string, ProfileSelectRow>();
  if (deduped.length === 0) return map;

  const { data, error } = await client
    .from("profiles")
    .select("id,role,full_name,barangay_id,city_id,municipality_id")
    .in("id", deduped);

  if (error && typeof window === "undefined") {
    throw new Error(error.message);
  }

  for (const row of (data ?? []) as ProfileSelectRow[]) {
    map.set(row.id, row);
  }

  const missingProfileIds = deduped.filter((id) => !map.has(id));
  if (missingProfileIds.length > 0 && typeof window !== "undefined") {
    try {
      const params = new URLSearchParams({
        ids: missingProfileIds.join(","),
      });
      const response = await fetch(`/api/internal/feedback/profile-meta?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { items?: ProfileSelectRow[] }
          | null;
        for (const row of payload?.items ?? []) {
          if (!row?.id) continue;
          map.set(row.id, row);
        }
      }
    } catch {
      // Best-effort fallback for browser clients under restrictive profiles RLS.
    }
  }

  return map;
}

async function listScopeNameMapsByProfiles(
  client: SupabaseClientLike,
  profileById: Map<string, ProfileSelectRow>
): Promise<ScopeNameMaps> {
  const profiles = Array.from(profileById.values());
  const barangayNameById = new Map<string, string>();
  const cityNameById = new Map<string, string>();
  const municipalityNameById = new Map<string, string>();

  for (const profile of profiles) {
    if (profile.barangay_id && profile.barangay_name) {
      barangayNameById.set(profile.barangay_id, profile.barangay_name);
    }
    if (profile.city_id && profile.city_name) {
      cityNameById.set(profile.city_id, profile.city_name);
    }
    if (profile.municipality_id && profile.municipality_name) {
      municipalityNameById.set(profile.municipality_id, profile.municipality_name);
    }
  }

  const barangayIds = Array.from(
    new Set(
      profiles
        .map((profile) => profile.barangay_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );
  const cityIds = Array.from(
    new Set(
      profiles
        .map((profile) => profile.city_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );
  const municipalityIds = Array.from(
    new Set(
      profiles
        .map((profile) => profile.municipality_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );
  const unresolvedBarangayIds = barangayIds.filter((id) => !barangayNameById.has(id));
  const unresolvedCityIds = cityIds.filter((id) => !cityNameById.has(id));
  const unresolvedMunicipalityIds = municipalityIds.filter(
    (id) => !municipalityNameById.has(id)
  );

  const [barangayResult, cityResult, municipalityResult] = await Promise.all([
    unresolvedBarangayIds.length
      ? client.from("barangays").select("id,name").in("id", unresolvedBarangayIds)
      : Promise.resolve({ data: [], error: null }),
    unresolvedCityIds.length
      ? client.from("cities").select("id,name").in("id", unresolvedCityIds)
      : Promise.resolve({ data: [], error: null }),
    unresolvedMunicipalityIds.length
      ? client.from("municipalities").select("id,name").in("id", unresolvedMunicipalityIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (barangayResult.error) throw new Error(barangayResult.error.message);
  if (cityResult.error) throw new Error(cityResult.error.message);
  if (municipalityResult.error) throw new Error(municipalityResult.error.message);

  for (const row of (barangayResult.data ?? []) as Array<{ id: string; name: string }>) {
    barangayNameById.set(row.id, row.name);
  }
  for (const row of (cityResult.data ?? []) as Array<{ id: string; name: string }>) {
    cityNameById.set(row.id, row.name);
  }
  for (const row of (municipalityResult.data ?? []) as Array<{ id: string; name: string }>) {
    municipalityNameById.set(row.id, row.name);
  }

  return {
    barangayNameById,
    cityNameById,
    municipalityNameById,
  };
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function maybeLogBarangayOfficialReplyActivity(
  client: SupabaseClientLike,
  inserted: FeedbackSelectRow
): Promise<void> {
  if (!inserted.parent_feedback_id || !inserted.author_id) return;
  if (typeof client.rpc !== "function") return;

  try {
    const profileById = await listProfilesByIds(client, [inserted.author_id]);
    const profile = profileById.get(inserted.author_id);
    if (!profile || profile.role !== "barangay_official") return;

    const actorName = toNonEmptyString(profile.full_name);
    const feedbackTargetLabel =
      inserted.target_type === "project" ? "project feedback thread" : "AIP feedback thread";
    const bodyPreview =
      inserted.body.length > 140 ? `${inserted.body.slice(0, 140)}...` : inserted.body;

    const { error } = await client.rpc("log_activity", {
      p_action: "comment_replied",
      p_entity_table: "feedback",
      p_entity_id: inserted.id,
      p_region_id: null,
      p_province_id: null,
      p_city_id: profile.city_id,
      p_municipality_id: profile.municipality_id,
      p_barangay_id: profile.barangay_id,
      p_metadata: withWorkflowActivityMetadata(
        {
          actor_name: actorName,
          actor_position: "Barangay Official",
          details: `Replied to a ${feedbackTargetLabel}.`,
          parent_feedback_id: inserted.parent_feedback_id,
          feedback_kind: inserted.kind,
          target_type: inserted.target_type,
          target_aip_id: inserted.aip_id,
          target_project_id: inserted.project_id,
          reply_preview: bodyPreview,
        },
        { hideCrudAction: "feedback_created" }
      ),
    });

    if (error) {
      console.error("[FEEDBACK] failed to log barangay official reply activity", {
        feedbackId: inserted.id,
        error: error.message,
      });
    }
  } catch (error) {
    console.error("[FEEDBACK] unexpected comment_replied logging failure", {
      feedbackId: inserted.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function getCurrentUserId(
  client: SupabaseClientLike
): Promise<string | null> {
  if (!client.auth) return null;
  const { data, error } = await client.auth.getUser();
  if (error) throw new Error(error.message);
  return data.user?.id ?? null;
}

function getScopeColumn(scope: InboxScope): "barangay_id" | "city_id" {
  return scope === "city" ? "city_id" : "barangay_id";
}

function chunkArray<T>(values: T[], size = 200): T[][] {
  if (values.length === 0) return [];
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function resolveInboxAccess(
  client: SupabaseClientLike,
  params?: { scope?: InboxScope; lguId?: string }
): Promise<ResolvedInboxAccess> {
  const fallbackScope =
    params?.scope && params.lguId ? { scope: params.scope, scopeId: params.lguId } : null;

  // No auth context available in some local/mock tests; keep a fallback path.
  if (!client.auth) {
    return fallbackScope ? { mode: "scoped", ...fallbackScope } : { mode: "unscoped" };
  }

  const userId = await getCurrentUserId(client);
  if (!userId) return { mode: "deny" };

  const { data, error } = await client
    .from("profiles")
    .select("role,barangay_id,city_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { mode: "deny" };

  const profile = data as Pick<ProfileSelectRow, "role" | "barangay_id" | "city_id">;

  if (profile.role === "barangay_official") {
    return profile.barangay_id
      ? { mode: "scoped", scope: "barangay", scopeId: profile.barangay_id }
      : { mode: "deny" };
  }

  if (profile.role === "city_official") {
    return profile.city_id
      ? { mode: "scoped", scope: "city", scopeId: profile.city_id }
      : { mode: "deny" };
  }

  return { mode: "unscoped" };
}

async function listScopedAipIds(
  client: SupabaseClientLike,
  input: { scope: InboxScope; scopeId: string }
): Promise<string[]> {
  const scopeColumn = getScopeColumn(input.scope);
  const { data, error } = await client
    .from("aips")
    .select("id")
    .eq(scopeColumn, input.scopeId);

  if (error) throw new Error(error.message);

  return Array.from(
    new Set(
      ((data ?? []) as Array<{ id: string }>)
        .map((row) => row.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );
}

async function listScopedProjectIdsByAips(
  client: SupabaseClientLike,
  aipIds: string[]
): Promise<string[]> {
  if (aipIds.length === 0) return [];

  const projectIds = new Set<string>();
  for (const aipChunk of chunkArray(aipIds)) {
    const { data, error } = await client
      .from("projects")
      .select("id,aip_id")
      .in("aip_id", aipChunk);

    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as ScopedProjectLookupRow[]) {
      if (row.id) projectIds.add(row.id);
    }
  }

  return Array.from(projectIds);
}

async function listScopedInboxRoots(
  client: SupabaseClientLike,
  input: { scope: InboxScope; scopeId: string }
): Promise<FeedbackSelectRow[]> {
  const aipIds = await listScopedAipIds(client, input);
  if (aipIds.length === 0) return [];

  const rootsById = new Map<string, FeedbackSelectRow>();

  for (const aipChunk of chunkArray(aipIds)) {
    const { data, error } = await client
      .from("feedback")
      .select(FEEDBACK_SELECT_COLUMNS)
      .is("parent_feedback_id", null)
      .eq("target_type", "aip")
      .in("aip_id", aipChunk)
      .in("kind", [...CITIZEN_INITIATED_FEEDBACK_KINDS]);

    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as FeedbackSelectRow[]) {
      if (isCitizenInitiatedFeedbackKind(row.kind)) {
        rootsById.set(row.id, row);
      }
    }
  }

  const projectIds = await listScopedProjectIdsByAips(client, aipIds);
  for (const projectChunk of chunkArray(projectIds)) {
    const { data, error } = await client
      .from("feedback")
      .select(FEEDBACK_SELECT_COLUMNS)
      .is("parent_feedback_id", null)
      .eq("target_type", "project")
      .in("project_id", projectChunk)
      .in("kind", [...CITIZEN_INITIATED_FEEDBACK_KINDS]);

    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as FeedbackSelectRow[]) {
      if (isCitizenInitiatedFeedbackKind(row.kind)) {
        rootsById.set(row.id, row);
      }
    }
  }

  return Array.from(rootsById.values()).sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
  );
}

async function isRowAccessibleInScope(
  client: SupabaseClientLike,
  row: FeedbackSelectRow,
  input: { scope: InboxScope; scopeId: string }
): Promise<boolean> {
  const scopeColumn = getScopeColumn(input.scope);

  if (row.target_type === "aip") {
    if (!row.aip_id) return false;

    const { data, error } = await client
      .from("aips")
      .select("id")
      .eq("id", row.aip_id)
      .eq(scopeColumn, input.scopeId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return !!data;
  }

  if (!row.project_id) return false;

  const { data: projectData, error: projectError } = await client
    .from("projects")
    .select("id,aip_id")
    .eq("id", row.project_id)
    .maybeSingle();

  if (projectError) throw new Error(projectError.message);
  if (!projectData) return false;

  const project = projectData as ScopedProjectLookupRow;
  const { data: aipData, error: aipError } = await client
    .from("aips")
    .select("id")
    .eq("id", project.aip_id)
    .eq(scopeColumn, input.scopeId)
    .maybeSingle();

  if (aipError) throw new Error(aipError.message);
  return !!aipData;
}

async function resolveAuthorId(
  client: SupabaseClientLike,
  preferredAuthorId?: string | null
): Promise<string> {
  if (preferredAuthorId) return preferredAuthorId;
  const authId = await getCurrentUserId(client);
  if (!authId) {
    throw new Error("Unable to resolve feedback author.");
  }
  return authId;
}

function isOfficialRole(role: RoleType | null | undefined): boolean {
  return (
    role === "barangay_official" ||
    role === "city_official" ||
    role === "municipal_official"
  );
}

function hasOfficialReply(
  replies: FeedbackSelectRow[],
  profileById: Map<string, ProfileSelectRow>
): boolean {
  return replies.some((reply) => {
    if (!reply.author_id) return false;
    return isOfficialRole(profileById.get(reply.author_id)?.role);
  });
}

function toThreadPreviewStatus(officialReplyExists: boolean) {
  return officialReplyExists ? "responded" : "no_response";
}

async function getFeedbackRowById(
  client: SupabaseClientLike,
  feedbackId: string
): Promise<FeedbackSelectRow | null> {
  const { data, error } = await client
    .from("feedback")
    .select(FEEDBACK_SELECT_COLUMNS)
    .eq("id", feedbackId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as FeedbackSelectRow | null) ?? null;
}

function toThreadMessage(
  row: FeedbackSelectRow,
  profileById: Map<string, ProfileSelectRow>,
  threadId: string
): CommentMessage {
  const profile = row.author_id ? profileById.get(row.author_id) : null;
  return {
    id: row.id,
    threadId: row.parent_feedback_id ?? threadId,
    authorRole: toCommentAuthorRole(profile?.role),
    authorId: row.author_id ?? "system",
    kind: row.kind,
    text: row.body,
    createdAt: row.created_at,
  };
}

function toThread(
  root: FeedbackSelectRow,
  replies: FeedbackSelectRow[],
  profileById: Map<string, ProfileSelectRow>,
  scopeNameMaps: ScopeNameMaps
): CommentThread {
  const rootProfile = root.author_id ? profileById.get(root.author_id) : null;
  const role = toFeedbackAuthorDisplayRole(rootProfile?.role);
  const roleLabel = toFeedbackRoleLabel(role);
  const authorName = rootProfile?.full_name?.trim() || roleLabel;
  const authorLguLabel = buildFeedbackLguLabel({
    role: rootProfile?.role,
    barangayName: rootProfile?.barangay_id
      ? scopeNameMaps.barangayNameById.get(rootProfile.barangay_id)
      : null,
    cityName: rootProfile?.city_id ? scopeNameMaps.cityNameById.get(rootProfile.city_id) : null,
    municipalityName: rootProfile?.municipality_id
      ? scopeNameMaps.municipalityNameById.get(rootProfile.municipality_id)
      : null,
  });
  const latestRow = replies[replies.length - 1] ?? root;
  return {
    id: root.id,
    createdAt: root.created_at,
    createdByUserId: root.author_id ?? "system",
    target: toCommentTarget(root),
    preview: {
      text: root.body,
      updatedAt: latestRow.created_at,
      status: toThreadPreviewStatus(hasOfficialReply(replies, profileById)),
      kind: root.kind,
      authorName,
      authorRoleLabel: roleLabel,
      authorLguLabel,
      authorScopeLabel: authorLguLabel,
    },
  };
}

async function insertFeedbackRow(
  client: SupabaseClientLike,
  payload: {
    target_type: "aip" | "project";
    aip_id: string | null;
    project_id: string | null;
    parent_feedback_id: string | null;
    kind: FeedbackKind;
    body: string;
    author_id: string;
    is_public: boolean;
  }
): Promise<FeedbackSelectRow> {
  const isBlocked = await isAuthorBlockedFromSettings(client, payload.author_id);
  if (isBlocked) {
    throw new Error("Your account is currently blocked from posting feedback.");
  }

  const rateLimit = await resolveCommentRateLimitFromSettings(client);
  const recentCount = await countRecentFeedbackByAuthor(client, {
    authorId: payload.author_id,
    timeWindow: rateLimit.timeWindow,
  });
  if (recentCount >= rateLimit.maxComments) {
    throw new Error("Comment rate limit exceeded. Please try again later.");
  }

  const { data, error } = await client
    .from("feedback")
    .insert({
      target_type: payload.target_type,
      aip_id: payload.aip_id,
      project_id: payload.project_id,
      parent_feedback_id: payload.parent_feedback_id,
      source: "human",
      kind: payload.kind,
      extraction_run_id: null,
      extraction_artifact_id: null,
      field_key: null,
      severity: null,
      body: payload.body,
      is_public: payload.is_public,
      author_id: payload.author_id,
    })
    .select(FEEDBACK_SELECT_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create feedback.");
  }

  const inserted = data as FeedbackSelectRow;
  await maybeLogBarangayOfficialReplyActivity(client, inserted);
  return inserted;
}

async function readAppSettingRaw(
  client: SupabaseClientLike,
  key: string
): Promise<string | null> {
  if (typeof client.schema !== "function") {
    return null;
  }

  try {
    const { data, error } = await client
      .schema("app")
      .from("settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (error) return null;
    const row = (data as { value?: unknown } | null) ?? null;
    return typeof row?.value === "string" ? row.value : null;
  } catch {
    return null;
  }
}

async function resolveCommentRateLimitFromSettings(client: SupabaseClientLike): Promise<{
  maxComments: number;
  timeWindow: "hour" | "day";
}> {
  const raw = await readAppSettingRaw(client, "controls.comment_rate_limit");
  if (!raw) {
    return { maxComments: 5, timeWindow: "hour" };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<{
      maxComments: number;
      timeWindow: "hour" | "day";
    }>;
    const maxComments =
      typeof parsed.maxComments === "number" && Number.isFinite(parsed.maxComments)
        ? Math.max(1, Math.floor(parsed.maxComments))
        : 5;
    const timeWindow = parsed.timeWindow === "day" ? "day" : "hour";
    return { maxComments, timeWindow };
  } catch {
    return { maxComments: 5, timeWindow: "hour" };
  }
}

async function isAuthorBlockedFromSettings(
  client: SupabaseClientLike,
  userId: string
): Promise<boolean> {
  const raw = await readAppSettingRaw(client, "controls.blocked_users");
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw) as Record<string, { blockedUntil?: string | null }>;
    const blockedUntil = parsed?.[userId]?.blockedUntil;
    if (typeof blockedUntil !== "string" || blockedUntil.length === 0) return false;
    const blockedUntilMs = new Date(blockedUntil).getTime();
    if (!Number.isFinite(blockedUntilMs)) return false;
    return blockedUntilMs > Date.now();
  } catch {
    return false;
  }
}

async function countRecentFeedbackByAuthor(
  client: SupabaseClientLike,
  input: { authorId: string; timeWindow: "hour" | "day" }
): Promise<number> {
  const start = new Date();
  if (input.timeWindow === "day") {
    start.setHours(0, 0, 0, 0);
  } else {
    start.setTime(start.getTime() - 60 * 60 * 1000);
  }

  const { data, error } = await client
    .from("feedback")
    .select("id")
    .eq("author_id", input.authorId)
    .eq("source", "human")
    .gte("created_at", start.toISOString());

  if (error) {
    return 0;
  }

  return Array.isArray(data) ? data.length : 0;
}

function sanitizeFeedbackBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error("Feedback body is required.");
  }
  return trimmed;
}

function buildFeedbackUpdatePatch(
  patch: Partial<Pick<FeedbackItem, "body" | "kind" | "isPublic">>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (typeof patch.body === "string") payload.body = sanitizeFeedbackBody(patch.body);
  if (typeof patch.kind === "string") payload.kind = patch.kind;
  if (typeof patch.isPublic === "boolean") payload.is_public = patch.isPublic;
  return payload;
}

async function getAipScopeName(
  client: SupabaseClientLike,
  aip: AipLookupRow
): Promise<string | null> {
  if (aip.barangay_id) {
    const { data, error } = await client
      .from("barangays")
      .select("name")
      .eq("id", aip.barangay_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data as { name?: unknown } | null) ?? null;
    return typeof row?.name === "string" ? row.name : null;
  }

  if (aip.city_id) {
    const { data, error } = await client
      .from("cities")
      .select("name")
      .eq("id", aip.city_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data as { name?: unknown } | null) ?? null;
    return typeof row?.name === "string" ? row.name : null;
  }

  if (aip.municipality_id) {
    const { data, error } = await client
      .from("municipalities")
      .select("name")
      .eq("id", aip.municipality_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data as { name?: unknown } | null) ?? null;
    return typeof row?.name === "string" ? row.name : null;
  }

  return null;
}

export function createCommentRepoFromClient(getClient: GetClient): CommentRepo {
  return {
    async listThreadsForInbox(params) {
      const client = await getClient();
      const access = await resolveInboxAccess(client, params);

      if (access.mode === "deny") {
        return [];
      }

      const roots =
        access.mode === "scoped"
          ? await listScopedInboxRoots(client, {
              scope: access.scope,
              scopeId: access.scopeId,
            })
          : await (async () => {
              const { data, error } = await client
                .from("feedback")
                .select(FEEDBACK_SELECT_COLUMNS)
                .is("parent_feedback_id", null)
                .in("kind", [...CITIZEN_INITIATED_FEEDBACK_KINDS])
                .order("updated_at", { ascending: false });

              if (error) {
                throw new Error(error.message);
              }

              return ((data ?? []) as FeedbackSelectRow[]).filter((row) =>
                isCitizenInitiatedFeedbackKind(row.kind)
              );
            })();

      const replies = await listFeedbackRowsByParentIds(
        client,
        roots.map((row) => row.id)
      );

      const repliesByParent = new Map<string, FeedbackSelectRow[]>();
      for (const row of replies) {
        if (!row.parent_feedback_id) continue;
        const list = repliesByParent.get(row.parent_feedback_id) ?? [];
        list.push(row);
        repliesByParent.set(row.parent_feedback_id, list);
      }

      const profileById = await listProfilesByIds(
        client,
        [
          ...roots.map((row) => row.author_id ?? ""),
          ...replies.map((row) => row.author_id ?? ""),
        ].filter(Boolean)
      );
      const scopeNameMaps = await listScopeNameMapsByProfiles(client, profileById);

      return roots
        .map((root) =>
          toThread(root, repliesByParent.get(root.id) ?? [], profileById, scopeNameMaps)
        )
        .sort(
          (left, right) =>
            new Date(right.preview.updatedAt).getTime() -
            new Date(left.preview.updatedAt).getTime()
        );
    },

    async getThread({ threadId }) {
      const client = await getClient();
      const access = await resolveInboxAccess(client);
      if (access.mode === "deny") return null;

      const root = await getFeedbackRowById(client, threadId);
      if (!root || root.parent_feedback_id) return null;
      if (
        access.mode === "scoped" &&
        !(await isRowAccessibleInScope(client, root, {
          scope: access.scope,
          scopeId: access.scopeId,
        }))
      ) {
        return null;
      }

      const replies = await listFeedbackRowsByParentIds(client, [threadId]);
      const profileById = await listProfilesByIds(
        client,
        [
          root.author_id ?? "",
          ...replies.map((row) => row.author_id ?? ""),
        ].filter(Boolean)
      );
      const scopeNameMaps = await listScopeNameMapsByProfiles(client, profileById);

      return toThread(root, replies, profileById, scopeNameMaps);
    },

    async listMessages({ threadId }) {
      const client = await getClient();
      const access = await resolveInboxAccess(client);
      if (access.mode === "deny") return [];

      const root = await getFeedbackRowById(client, threadId);
      if (!root || root.parent_feedback_id) return [];
      if (
        access.mode === "scoped" &&
        !(await isRowAccessibleInScope(client, root, {
          scope: access.scope,
          scopeId: access.scopeId,
        }))
      ) {
        return [];
      }

      const rows = await listFeedbackRowsByThreadId(client, threadId);
      const profileById = await listProfilesByIds(
        client,
        rows.map((row) => row.author_id ?? "").filter(Boolean)
      );

      return rows.map((row) => toThreadMessage(row, profileById, threadId));
    },

    async addReply({ threadId, text }) {
      const client = await getClient();
      const access = await resolveInboxAccess(client);
      if (access.mode === "deny") {
        throw new Error("Thread not found.");
      }

      const parent = await getFeedbackRowById(client, threadId);
      if (!parent || parent.parent_feedback_id) {
        throw new Error("Thread not found.");
      }
      if (
        access.mode === "scoped" &&
        !(await isRowAccessibleInScope(client, parent, {
          scope: access.scope,
          scopeId: access.scopeId,
        }))
      ) {
        throw new Error("Thread not found.");
      }

      const authorId = await resolveAuthorId(client);
      const inserted = await insertFeedbackRow(client, {
        target_type: parent.target_type,
        aip_id: parent.target_type === "aip" ? parent.aip_id : null,
        project_id: parent.target_type === "project" ? parent.project_id : null,
        parent_feedback_id: parent.id,
        kind: "lgu_note",
        body: sanitizeFeedbackBody(text),
        author_id: authorId,
        is_public: true,
      });

      const profileById = await listProfilesByIds(client, [authorId]);
      return toThreadMessage(inserted, profileById, threadId);
    },

    async resolveThread() {
      return;
    },
  };
}

export function createFeedbackRepoFromClient(getClient: GetClient): FeedbackRepo {
  return {
    async listForAip(aipId) {
      const client = await getClient();
      const { data, error } = await client
        .from("feedback")
        .select(FEEDBACK_SELECT_COLUMNS)
        .eq("target_type", "aip")
        .eq("aip_id", aipId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (data as unknown[] | null) ?? [];
      return rows.map((row: unknown) =>
        mapFeedbackRowToItem(row as FeedbackSelectRow)
      );
    },

    async listForProject(projectId) {
      const client = await getClient();
      const { data, error } = await client
        .from("feedback")
        .select(FEEDBACK_SELECT_COLUMNS)
        .eq("target_type", "project")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (data as unknown[] | null) ?? [];
      return rows.map((row: unknown) =>
        mapFeedbackRowToItem(row as FeedbackSelectRow)
      );
    },

    async createForAip(aipId, payload) {
      const client = await getClient();
      const authorId = await resolveAuthorId(client, payload.authorId ?? null);
      const inserted = await insertFeedbackRow(client, {
        target_type: "aip",
        aip_id: aipId,
        project_id: null,
        parent_feedback_id: null,
        kind: payload.kind,
        body: sanitizeFeedbackBody(payload.body),
        author_id: authorId,
        is_public: payload.isPublic ?? true,
      });
      return mapFeedbackRowToItem(inserted);
    },

    async createForProject(projectId, payload) {
      const client = await getClient();
      const authorId = await resolveAuthorId(client, payload.authorId ?? null);
      const inserted = await insertFeedbackRow(client, {
        target_type: "project",
        aip_id: null,
        project_id: projectId,
        parent_feedback_id: null,
        kind: payload.kind,
        body: sanitizeFeedbackBody(payload.body),
        author_id: authorId,
        is_public: payload.isPublic ?? true,
      });
      return mapFeedbackRowToItem(inserted);
    },

    async reply(parentFeedbackId, payload) {
      const client = await getClient();
      const parent = await getFeedbackRowById(client, parentFeedbackId);
      if (!parent) {
        throw new Error("Feedback parent not found.");
      }

      const authorId = await resolveAuthorId(client, payload.authorId ?? null);
      const inserted = await insertFeedbackRow(client, {
        target_type: parent.target_type,
        aip_id: parent.target_type === "aip" ? parent.aip_id : null,
        project_id: parent.target_type === "project" ? parent.project_id : null,
        parent_feedback_id: parent.id,
        kind: payload.kind,
        body: sanitizeFeedbackBody(payload.body),
        author_id: authorId,
        is_public: payload.isPublic ?? true,
      });

      return mapFeedbackRowToItem(inserted);
    },

    async update(feedbackId, patch) {
      const client = await getClient();
      const payload = buildFeedbackUpdatePatch(patch);
      if (Object.keys(payload).length === 0) {
        const existing = await getFeedbackRowById(client, feedbackId);
        return existing ? mapFeedbackRowToItem(existing) : null;
      }

      const { data, error } = await client
        .from("feedback")
        .update(payload)
        .eq("id", feedbackId)
        .select(FEEDBACK_SELECT_COLUMNS)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) return null;

      return mapFeedbackRowToItem(data as FeedbackSelectRow);
    },

    async remove(feedbackId) {
      const client = await getClient();
      const { data, error } = await client
        .from("feedback")
        .delete()
        .eq("id", feedbackId)
        .select("id");

      if (error) throw new Error(error.message);
      return Array.isArray(data) && data.length > 0;
    },
  };
}

function toTargetFilterQuery(baseQuery: SupabaseFilterQueryLike, target: FeedbackTarget) {
  if (target.target_type === "project") {
    let query = baseQuery.eq("target_type", "project");
    if (target.project_id) query = query.eq("project_id", target.project_id);
    return query;
  }

  let query = baseQuery.eq("target_type", "aip");
  if (target.aip_id) query = query.eq("aip_id", target.aip_id);
  return query;
}

export function createFeedbackThreadsRepoFromClient(
  getClient: GetClient
): FeedbackThreadsRepo {
  return {
    async listThreadRootsByTarget(target) {
      const client = await getClient();
      const base = client
        .from("feedback")
        .select(FEEDBACK_SELECT_COLUMNS)
        .is("parent_feedback_id", null);
      const { data, error } = await toTargetFilterQuery(base, target).order(
        "created_at",
        { ascending: true }
      );
      if (error) throw new Error(error.message);
      const rows = (data as unknown[] | null) ?? [];
      return rows.map((row: unknown) =>
        mapFeedbackRowToThreadRow(row as FeedbackSelectRow)
      );
    },

    async listThreadMessages(rootId) {
      const client = await getClient();
      const rows = await listFeedbackRowsByThreadId(client, rootId);
      return rows.map(mapFeedbackRowToThreadRow);
    },

    async createRoot(input) {
      const client = await getClient();
      const inserted = await insertFeedbackRow(client, {
        target_type: input.target.target_type,
        aip_id: input.target.target_type === "aip" ? input.target.aip_id ?? null : null,
        project_id:
          input.target.target_type === "project"
            ? input.target.project_id ?? null
            : null,
        parent_feedback_id: null,
        kind: "question",
        body: sanitizeFeedbackBody(input.body),
        author_id: input.authorId,
        is_public: true,
      });
      return mapFeedbackRowToThreadRow(inserted);
    },

    async createReply(input) {
      const client = await getClient();
      const parent = await getFeedbackRowById(client, input.parentId);
      if (!parent) throw new Error("parent feedback not found");

      if (input.target) {
        const sameTarget =
          input.target.target_type === parent.target_type &&
          (input.target.aip_id ?? null) === (parent.aip_id ?? null) &&
          (input.target.project_id ?? null) === (parent.project_id ?? null);
        if (!sameTarget) throw new Error("reply feedback must match parent target");
      }

      const inserted = await insertFeedbackRow(client, {
        target_type: parent.target_type,
        aip_id: parent.target_type === "aip" ? parent.aip_id : null,
        project_id: parent.target_type === "project" ? parent.project_id : null,
        parent_feedback_id: parent.id,
        kind: "lgu_note",
        body: sanitizeFeedbackBody(input.body),
        author_id: input.authorId,
        is_public: true,
      });

      return mapFeedbackRowToThreadRow(inserted);
    },
  };
}

export function createCommentTargetLookupFromClient(
  getClient: GetClient
): CommentTargetLookup {
  return {
    async getProject(id) {
      const client = await getClient();
      let query = client
        .from("projects")
        .select(
          "id,aip_id,aip_ref_code,program_project_description,category,start_date,completion_date"
        )
        .limit(1);

      if (isUuid(id)) {
        query = query.or(`id.eq.${id},aip_ref_code.eq.${id}`);
      } else {
        query = query.eq("aip_ref_code", id);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;

      const row = data as ProjectLookupRow;
      return {
        id: row.id,
        aipId: row.aip_id,
        title: row.program_project_description || "Project",
        year:
          getYearFromDateString(row.start_date) ??
          getYearFromDateString(row.completion_date),
        kind:
          row.category === "health"
            ? "health"
            : row.category === "infrastructure"
              ? "infrastructure"
              : row.category === "other"
                ? "other"
                : undefined,
      };
    },

    async getAip(id) {
      const client = await getClient();
      const { data, error } = await client
        .from("aips")
        .select("id,fiscal_year,barangay_id,city_id,municipality_id")
        .eq("id", id)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) return null;

      const aip = data as AipLookupRow;
      const scopeName = await getAipScopeName(client, aip);
      return {
        id: aip.id,
        title: `AIP ${aip.fiscal_year}`,
        year: aip.fiscal_year,
        barangayName: scopeName,
      };
    },

    async getAipItem(aipId, aipItemId) {
      const client = await getClient();

      let query = client
        .from("projects")
        .select("id,aip_id,aip_ref_code,program_project_description")
        .eq("aip_id", aipId)
        .limit(1);

      if (isUuid(aipItemId)) {
        query = query.or(`id.eq.${aipItemId},aip_ref_code.eq.${aipItemId}`);
      } else {
        query = query.eq("aip_ref_code", aipItemId);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;

      const row = data as ProjectLookupRow;
      return {
        id: row.id,
        aipId: row.aip_id,
        projectRefCode: row.aip_ref_code ?? undefined,
        aipDescription: row.program_project_description ?? "AIP Item",
      };
    },

    async findAipItemByProjectRefCode(projectRefCode) {
      const client = await getClient();
      const { data, error } = await client
        .from("projects")
        .select("id,aip_id,aip_ref_code,program_project_description")
        .eq("aip_ref_code", projectRefCode)
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) return null;

      const row = data as ProjectLookupRow;
      return {
        id: row.id,
        aipId: row.aip_id,
        projectRefCode: row.aip_ref_code ?? undefined,
        aipDescription: row.program_project_description ?? "AIP Item",
      };
    },
  };
}
