import type { RoleType } from "@/lib/contracts/databasev2";
import {
  buildFeedbackLguLabel,
  toFeedbackAuthorDisplayRole,
  toFeedbackRoleLabel,
  type FeedbackAuthorDisplayRole,
} from "@/lib/feedback/author-labels";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const CITIZEN_AIP_FEEDBACK_KINDS = [
  "commend",
  "suggestion",
  "concern",
  "question",
] as const;

export const AIP_FEEDBACK_DISPLAY_KINDS = [
  ...CITIZEN_AIP_FEEDBACK_KINDS,
  "lgu_note",
] as const;

export const AIP_FEEDBACK_MAX_LENGTH = 1000;
export const HIDDEN_FEEDBACK_PLACEHOLDER =
  "This comment has been hidden due to policy violation.";

export type CitizenAipFeedbackKind = (typeof CITIZEN_AIP_FEEDBACK_KINDS)[number];
export type AipFeedbackDisplayKind = (typeof AIP_FEEDBACK_DISPLAY_KINDS)[number];

export type AipFeedbackAuthorRole = FeedbackAuthorDisplayRole;

export type AipFeedbackApiItem = {
  id: string;
  aipId: string;
  parentFeedbackId: string | null;
  kind: AipFeedbackDisplayKind;
  isHidden: boolean;
  body: string;
  hiddenReason?: string | null;
  violationCategory?: string | null;
  createdAt: string;
  author: {
    id: string | null;
    fullName: string;
    role: AipFeedbackAuthorRole;
    roleLabel: string;
    lguLabel: string;
  };
};

type SupabaseServerClient = Awaited<ReturnType<typeof supabaseServer>>;

type AipLookupRow = {
  id: string;
  status: "draft" | "pending_review" | "under_review" | "for_revision" | "published";
};

type FeedbackSelectRow = {
  id: string;
  target_type: "aip" | "project";
  aip_id: string | null;
  parent_feedback_id: string | null;
  kind: AipFeedbackDisplayKind;
  body: string;
  author_id: string | null;
  is_public: boolean;
  created_at: string;
};

type ProfileLookupRow = {
  id: string;
  full_name: string | null;
  role: RoleType | null;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
};

type NameLookupRow = {
  id: string;
  name: string;
};

type FeedbackAuthorMeta = {
  id: string;
  fullName: string;
  role: AipFeedbackAuthorRole;
  roleLabel: string;
  lguLabel: string;
};

type HiddenModerationMeta = {
  hiddenReason: string | null;
  violationCategory: string | null;
};

export class CitizenAipFeedbackApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function buildLguLabel(params: {
  role: RoleType | null | undefined;
  barangayId: string | null;
  cityId: string | null;
  municipalityId: string | null;
  barangayNameById: Map<string, string>;
  cityNameById: Map<string, string>;
  municipalityNameById: Map<string, string>;
}): string {
  const barangayName = params.barangayId
    ? params.barangayNameById.get(params.barangayId)
    : null;
  const cityName = params.cityId ? params.cityNameById.get(params.cityId) : null;
  const municipalityName = params.municipalityId
    ? params.municipalityNameById.get(params.municipalityId)
    : null;
  return buildFeedbackLguLabel({
    role: params.role,
    barangayName,
    cityName,
    municipalityName,
  });
}

function toAuthorMeta(
  profile: ProfileLookupRow,
  barangayNameById: Map<string, string>,
  cityNameById: Map<string, string>,
  municipalityNameById: Map<string, string>
): FeedbackAuthorMeta {
  const normalizedRole = toFeedbackAuthorDisplayRole(profile.role);
  const roleLabel = toFeedbackRoleLabel(normalizedRole);
  const fullName = profile.full_name?.trim() || roleLabel;
  const lguLabel = buildLguLabel({
    role: profile.role,
    barangayId: profile.barangay_id,
    cityId: profile.city_id,
    municipalityId: profile.municipality_id,
    barangayNameById,
    cityNameById,
    municipalityNameById,
  });

  return {
    id: profile.id,
    fullName,
    role: normalizedRole,
    roleLabel,
    lguLabel,
  };
}

async function loadAuthorMetaById(
  rows: FeedbackSelectRow[]
): Promise<Map<string, FeedbackAuthorMeta>> {
  const authorIds = Array.from(
    new Set(
      rows
        .map((row) => row.author_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );

  const authorMetaById = new Map<string, FeedbackAuthorMeta>();
  if (authorIds.length === 0) {
    return authorMetaById;
  }

  const admin = supabaseAdmin();
  const { data: profileData, error: profileError } = await admin
    .from("profiles")
    .select("id,full_name,role,barangay_id,city_id,municipality_id")
    .in("id", authorIds);

  if (profileError) {
    throw new CitizenAipFeedbackApiError(500, profileError.message);
  }

  const profiles = (profileData ?? []) as ProfileLookupRow[];
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

  const [barangayResult, cityResult, municipalityResult] = await Promise.all([
    barangayIds.length
      ? admin.from("barangays").select("id,name").in("id", barangayIds)
      : Promise.resolve({ data: [], error: null }),
    cityIds.length
      ? admin.from("cities").select("id,name").in("id", cityIds)
      : Promise.resolve({ data: [], error: null }),
    municipalityIds.length
      ? admin.from("municipalities").select("id,name").in("id", municipalityIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (barangayResult.error) {
    throw new CitizenAipFeedbackApiError(500, barangayResult.error.message);
  }
  if (cityResult.error) {
    throw new CitizenAipFeedbackApiError(500, cityResult.error.message);
  }
  if (municipalityResult.error) {
    throw new CitizenAipFeedbackApiError(500, municipalityResult.error.message);
  }

  const barangayNameById = new Map(
    ((barangayResult.data ?? []) as NameLookupRow[]).map((row) => [row.id, row.name])
  );
  const cityNameById = new Map(
    ((cityResult.data ?? []) as NameLookupRow[]).map((row) => [row.id, row.name])
  );
  const municipalityNameById = new Map(
    ((municipalityResult.data ?? []) as NameLookupRow[]).map((row) => [row.id, row.name])
  );

  for (const profile of profiles) {
    authorMetaById.set(
      profile.id,
      toAuthorMeta(profile, barangayNameById, cityNameById, municipalityNameById)
    );
  }

  return authorMetaById;
}

function mapFeedbackRowToApiItem(
  row: FeedbackSelectRow,
  authorMetaById: Map<string, FeedbackAuthorMeta>,
  input?: {
    viewerUserId?: string | null;
    hiddenMetaByFeedbackId?: Map<string, HiddenModerationMeta>;
  }
): AipFeedbackApiItem {
  const author = row.author_id ? authorMetaById.get(row.author_id) : null;
  const fallbackRole: AipFeedbackAuthorRole = "citizen";
  const isHidden = !row.is_public;
  const isAuthorViewer =
    isHidden &&
    !!input?.viewerUserId &&
    !!row.author_id &&
    input.viewerUserId === row.author_id;
  const hiddenMeta = isHidden ? input?.hiddenMetaByFeedbackId?.get(row.id) : undefined;

  return {
    id: row.id,
    aipId: row.aip_id ?? "",
    parentFeedbackId: row.parent_feedback_id,
    kind: row.kind,
    isHidden,
    body: isHidden ? (isAuthorViewer ? row.body : HIDDEN_FEEDBACK_PLACEHOLDER) : row.body,
    hiddenReason: isAuthorViewer ? hiddenMeta?.hiddenReason ?? null : null,
    violationCategory: isAuthorViewer ? hiddenMeta?.violationCategory ?? null : null,
    createdAt: row.created_at,
    author: {
      id: author?.id ?? row.author_id,
      fullName: author?.fullName ?? "Citizen",
      role: author?.role ?? fallbackRole,
      roleLabel: author?.roleLabel ?? toFeedbackRoleLabel(fallbackRole),
      lguLabel: author?.lguLabel ?? "Brgy. Unknown",
    },
  };
}

function readHiddenMetaFromActivityRow(row: { metadata: unknown }): HiddenModerationMeta {
  const metadata = row.metadata;
  if (!metadata || typeof metadata !== "object") {
    return { hiddenReason: null, violationCategory: null };
  }
  const record = metadata as Record<string, unknown>;
  return {
    hiddenReason: typeof record.reason === "string" ? record.reason : null,
    violationCategory:
      typeof record.violation_category === "string" ? record.violation_category : null,
  };
}

async function loadHiddenModerationMetaByFeedbackId(
  rows: FeedbackSelectRow[],
  viewerUserId?: string | null
): Promise<Map<string, HiddenModerationMeta>> {
  if (!viewerUserId) {
    return new Map<string, HiddenModerationMeta>();
  }

  const hiddenFeedbackIds = Array.from(
    new Set(
      rows
        .filter((row) => !row.is_public && row.author_id === viewerUserId)
        .map((row) => row.id)
    )
  );
  const hiddenMetaByFeedbackId = new Map<string, HiddenModerationMeta>();
  if (hiddenFeedbackIds.length === 0) {
    return hiddenMetaByFeedbackId;
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("activity_log")
    .select("entity_id,metadata,created_at")
    .eq("entity_table", "feedback")
    .eq("action", "feedback_hidden")
    .in("entity_id", hiddenFeedbackIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new CitizenAipFeedbackApiError(500, error.message);
  }

  for (const row of data ?? []) {
    const entityId = (row as { entity_id?: unknown }).entity_id;
    if (typeof entityId !== "string" || hiddenMetaByFeedbackId.has(entityId)) continue;
    hiddenMetaByFeedbackId.set(
      entityId,
      readHiddenMetaFromActivityRow(row as { metadata: unknown })
    );
  }

  return hiddenMetaByFeedbackId;
}

export async function hydrateAipFeedbackItems(
  rows: FeedbackSelectRow[],
  input?: { viewerUserId?: string | null }
): Promise<AipFeedbackApiItem[]> {
  const authorMetaById = await loadAuthorMetaById(rows);
  const hiddenMetaByFeedbackId = await loadHiddenModerationMetaByFeedbackId(
    rows,
    input?.viewerUserId ?? null
  );
  return rows.map((row) =>
    mapFeedbackRowToApiItem(row, authorMetaById, {
      viewerUserId: input?.viewerUserId ?? null,
      hiddenMetaByFeedbackId,
    })
  );
}

export async function listPublicAipFeedback(
  client: SupabaseServerClient,
  aipId: string,
  input?: { viewerUserId?: string | null }
): Promise<AipFeedbackApiItem[]> {
  const { data, error } = await client
    .from("feedback")
    .select("id,target_type,aip_id,parent_feedback_id,kind,body,author_id,is_public,created_at")
    .eq("target_type", "aip")
    .eq("aip_id", aipId)
    .in("kind", [...AIP_FEEDBACK_DISPLAY_KINDS])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw new CitizenAipFeedbackApiError(500, error.message);
  }

  return hydrateAipFeedbackItems((data ?? []) as FeedbackSelectRow[], input);
}

export async function resolveViewerUserId(
  client: SupabaseServerClient
): Promise<string | null> {
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

export function sanitizeFeedbackBody(value: unknown): string {
  if (typeof value !== "string") {
    throw new CitizenAipFeedbackApiError(400, "Feedback content is required.");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new CitizenAipFeedbackApiError(400, "Feedback content is required.");
  }

  if (trimmed.length > AIP_FEEDBACK_MAX_LENGTH) {
    throw new CitizenAipFeedbackApiError(
      400,
      `Feedback content must be at most ${AIP_FEEDBACK_MAX_LENGTH} characters.`
    );
  }

  return trimmed;
}

export function sanitizeCitizenFeedbackKind(value: unknown): CitizenAipFeedbackKind {
  if (typeof value !== "string") {
    throw new CitizenAipFeedbackApiError(400, "Feedback kind is required.");
  }

  if (!(CITIZEN_AIP_FEEDBACK_KINDS as readonly string[]).includes(value)) {
    throw new CitizenAipFeedbackApiError(400, "Invalid feedback kind.");
  }

  return value as CitizenAipFeedbackKind;
}

export async function requireCitizenActor(
  client: SupabaseServerClient
): Promise<{ userId: string }> {
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user?.id) {
    throw new CitizenAipFeedbackApiError(401, "Please sign in to post feedback.");
  }

  const userId = authData.user.id;
  const { data: profileData, error: profileError } = await client
    .from("profiles")
    .select("id,role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw new CitizenAipFeedbackApiError(500, profileError.message);
  }

  if (!profileData || profileData.role !== "citizen") {
    throw new CitizenAipFeedbackApiError(403, "Only citizens can post feedback.");
  }

  return { userId };
}

export async function resolveAipById(
  client: SupabaseServerClient,
  aipId: string
): Promise<{ id: string; status: AipLookupRow["status"] }> {
  const normalized = aipId.trim();
  if (!normalized) {
    throw new CitizenAipFeedbackApiError(400, "AIP ID is required.");
  }

  const { data, error } = await client
    .from("aips")
    .select("id,status")
    .eq("id", normalized)
    .maybeSingle();

  if (error) {
    throw new CitizenAipFeedbackApiError(500, error.message);
  }

  if (!data) {
    throw new CitizenAipFeedbackApiError(404, "AIP not found.");
  }

  const aip = data as AipLookupRow;
  return {
    id: aip.id,
    status: aip.status,
  };
}

export function assertPublishedAipStatus(aipStatus: AipLookupRow["status"]): void {
  if (aipStatus !== "published") {
    throw new CitizenAipFeedbackApiError(403, "Feedback is only available for published AIPs.");
  }
}

export async function loadAipFeedbackRowById(
  client: SupabaseServerClient,
  feedbackId: string
): Promise<FeedbackSelectRow | null> {
  const { data, error } = await client
    .from("feedback")
    .select("id,target_type,aip_id,parent_feedback_id,kind,body,author_id,is_public,created_at")
    .eq("id", feedbackId)
    .maybeSingle();

  if (error) {
    throw new CitizenAipFeedbackApiError(500, error.message);
  }

  return (data as FeedbackSelectRow | null) ?? null;
}

export function toErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof CitizenAipFeedbackApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}
