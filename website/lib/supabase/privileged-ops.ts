import "server-only";

import type { Json, RoleType } from "@/lib/contracts/databasev2";
import type { ActorContext } from "@/lib/domain/actor-context";
import { getProjectMediaBucketName } from "@/lib/projects/media";
import {
  InvariantError,
  assertActorPresent,
  assertActorRole,
  assertNonEmptyString,
  assertPositiveInteger,
  assertPublishedOnlyUnlessScopedStaffAdmin,
  assertScopedStaffOrAdminAccess,
  assertInvariant,
  type InvariantScopeKind,
} from "@/lib/security/invariants";
import { supabaseAdmin, type SupabaseAdminClient } from "@/lib/supabase/admin";

type PrivilegedScope = "none" | "barangay" | "city" | "municipality";

type ProjectUpdateMediaLookupRow = {
  id: string;
  bucket_id: string;
  object_name: string;
  mime_type: string;
  project_id: string;
  update_id: string;
};

type ProjectUpdateLookupRow = {
  id: string;
  project_id: string;
  aip_id: string;
  status: "active" | "hidden";
};

type AipMediaLookupRow = {
  id: string;
  status: "draft" | "pending_review" | "under_review" | "for_revision" | "published";
  city_id: string | null;
  municipality_id: string | null;
  barangay_id: string | null;
};

type ProjectLookupRow = {
  id: string;
  aip_id: string;
  image_url: string | null;
};

type AipCoverLookupRow = {
  id: string;
  status: "draft" | "pending_review" | "under_review" | "for_revision" | "published";
  city_id: string | null;
  municipality_id: string | null;
  barangay_id: string | null;
};

type ExtractionRunStatusRow = {
  id: string;
  aip_id: string;
  uploaded_file_id: string | null;
  retry_of_run_id?: string | null;
  stage: string;
  resume_from_stage?: string | null;
  status: string;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  overall_progress_pct?: number | null;
  stage_progress_pct?: number | null;
  progress_message?: string | null;
  progress_updated_at?: string | null;
};

type AipScopeLookupRow = {
  id: string;
  barangay_id: string | null;
};

type AssistantChatMessageRow = {
  id: string;
  session_id: string;
  role: "assistant" | "system" | "user";
  content: string;
  citations: Json | null;
  retrieval_meta: Json | null;
  created_at: string;
};

export type PrivilegedActorContext = {
  role: RoleType;
  user_id: string;
  lgu_id: string | null;
  lgu_scope: PrivilegedScope;
};

export type PrivilegedProfileActorInput = {
  userId: string;
  role: RoleType;
  barangayId?: string | null;
  cityId?: string | null;
  municipalityId?: string | null;
};

export type ConsumeChatQuotaInput = {
  actor: PrivilegedActorContext | null;
  userId: string;
  maxRequests: number;
  timeWindow: "per_hour" | "per_day";
  route: string;
};

export type ConsumeChatQuotaResult = {
  allowed: boolean;
  reason: string;
  perHour: number;
  perDay: number;
};

export type UploadProjectMediaObjectInput = {
  actor: PrivilegedActorContext | null;
  aipId: string;
  projectId: string;
  bucketId: string;
  objectName: string;
  fileBuffer: Buffer;
  contentType: string;
  sizeBytes: number;
  updateId?: string;
};

export type UploadProjectMediaObjectResult = {
  bucketId: string;
  objectName: string;
  mimeType: string;
  sizeBytes: number;
};

type RetryResumeStage = "extract" | "validate" | "scale_amounts" | "summarize" | "categorize";
const RESUME_STAGE_SET = new Set<RetryResumeStage>([
  "extract",
  "validate",
  "scale_amounts",
  "summarize",
  "categorize",
]);

function getAdminClient(): SupabaseAdminClient {
  return supabaseAdmin();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function normalizeRetryResumeStage(
  value: string | null | undefined
): RetryResumeStage | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (!RESUME_STAGE_SET.has(normalized as RetryResumeStage)) return null;
  return normalized as RetryResumeStage;
}

function toJsonObject(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

function toActivityScopeColumns(actor: PrivilegedActorContext): {
  city_id: string | null;
  municipality_id: string | null;
  barangay_id: string | null;
} {
  if (actor.lgu_scope === "city") {
    return { city_id: actor.lgu_id, municipality_id: null, barangay_id: null };
  }
  if (actor.lgu_scope === "municipality") {
    return { city_id: null, municipality_id: actor.lgu_id, barangay_id: null };
  }
  if (actor.lgu_scope === "barangay") {
    return { city_id: null, municipality_id: null, barangay_id: actor.lgu_id };
  }
  return { city_id: null, municipality_id: null, barangay_id: null };
}

async function writePrivilegedAudit(input: {
  actor: PrivilegedActorContext;
  action: string;
  entityTable?: string | null;
  entityId?: string | null;
  metadata?: Json | Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = getAdminClient();
    const scope = toActivityScopeColumns(input.actor);
    const { error } = await admin.from("activity_log").insert({
      actor_id: input.actor.user_id,
      actor_role: input.actor.role,
      action: input.action,
      entity_table: input.entityTable ?? null,
      entity_id: input.entityId ?? null,
      region_id: null,
      province_id: null,
      city_id: scope.city_id,
      municipality_id: scope.municipality_id,
      barangay_id: scope.barangay_id,
      metadata: toJsonObject(input.metadata),
    });
    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    console.error("[PRIVILEGED_OPS][AUDIT_FAILED]", {
      action: input.action,
      entityTable: input.entityTable ?? null,
      entityId: input.entityId ?? null,
      actorUserId: input.actor.user_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function resolveAipScope(input: {
  cityId: string | null;
  municipalityId: string | null;
  barangayId: string | null;
}): { scopeKind: InvariantScopeKind; scopeId: string | null } {
  if (input.barangayId) {
    return { scopeKind: "barangay", scopeId: input.barangayId };
  }
  if (input.cityId) {
    return { scopeKind: "city", scopeId: input.cityId };
  }
  if (input.municipalityId) {
    return { scopeKind: "municipality", scopeId: input.municipalityId };
  }
  return { scopeKind: "none", scopeId: null };
}

function toPerHourAndPerDay(
  maxRequests: number,
  timeWindow: "per_hour" | "per_day"
): { perHour: number; perDay: number } {
  const neutralHourlyQuota = 100000;
  const perHour = Math.max(
    1,
    Math.floor(timeWindow === "per_hour" ? maxRequests : neutralHourlyQuota)
  );
  const perDay =
    timeWindow === "per_day"
      ? Math.max(1, Math.floor(maxRequests))
      : Math.max(1, Math.floor(maxRequests * 24));
  return { perHour, perDay };
}

export function toPrivilegedActorContext(
  actor: ActorContext | null
): PrivilegedActorContext | null {
  if (!actor) return null;
  if (!actor.userId || !actor.role) return null;

  if (actor.role === "admin") {
    return {
      role: actor.role,
      user_id: actor.userId,
      lgu_id: null,
      lgu_scope: "none",
    };
  }

  if (actor.role === "city_official") {
    return {
      role: actor.role,
      user_id: actor.userId,
      lgu_id: actor.scope.kind === "city" ? actor.scope.id ?? null : null,
      lgu_scope: "city",
    };
  }

  if (actor.role === "municipal_official") {
    return {
      role: actor.role,
      user_id: actor.userId,
      lgu_id: actor.scope.kind === "municipality" ? actor.scope.id ?? null : null,
      lgu_scope: "municipality",
    };
  }

  return {
    role: actor.role,
    user_id: actor.userId,
    lgu_id: actor.scope.kind === "barangay" ? actor.scope.id ?? null : null,
    lgu_scope: "barangay",
  };
}

export function toPrivilegedActorContextFromProfile(
  input: PrivilegedProfileActorInput
): PrivilegedActorContext | null {
  assertNonEmptyString(input.userId, "Unauthorized.");
  if (input.role === "admin") {
    return {
      role: input.role,
      user_id: input.userId,
      lgu_id: null,
      lgu_scope: "none",
    };
  }
  if (input.role === "city_official") {
    return {
      role: input.role,
      user_id: input.userId,
      lgu_id: input.cityId ?? null,
      lgu_scope: "city",
    };
  }
  if (input.role === "municipal_official") {
    return {
      role: input.role,
      user_id: input.userId,
      lgu_id: input.municipalityId ?? null,
      lgu_scope: "municipality",
    };
  }
  return {
    role: input.role,
    user_id: input.userId,
    lgu_id: input.barangayId ?? null,
    lgu_scope: "barangay",
  };
}

export async function readProjectMediaBlob(input: {
  actor: PrivilegedActorContext | null;
  mediaId: string;
}): Promise<{ imageData: Blob; objectName: string; mimeType: string } | null> {
  assertNonEmptyString(input.mediaId, "Media id is required.");
  const mediaId = input.mediaId.trim();
  const admin = getAdminClient();

  const { data: mediaData, error: mediaError } = await admin
    .from("project_update_media")
    .select("id,bucket_id,object_name,mime_type,project_id,update_id")
    .eq("id", mediaId)
    .maybeSingle();
  if (mediaError || !mediaData) {
    return null;
  }
  const media = mediaData as ProjectUpdateMediaLookupRow;

  const { data: updateData, error: updateError } = await admin
    .from("project_updates")
    .select("id,project_id,aip_id,status")
    .eq("id", media.update_id)
    .maybeSingle();
  if (updateError || !updateData) {
    return null;
  }
  const update = updateData as ProjectUpdateLookupRow;
  if (update.project_id !== media.project_id) {
    return null;
  }

  const { data: aipData, error: aipError } = await admin
    .from("aips")
    .select("id,status,city_id,municipality_id,barangay_id")
    .eq("id", update.aip_id)
    .maybeSingle();
  if (aipError || !aipData) {
    return null;
  }
  const aip = aipData as AipMediaLookupRow;
  const aipScope = resolveAipScope({
    cityId: aip.city_id,
    municipalityId: aip.municipality_id,
    barangayId: aip.barangay_id,
  });

  if (update.status === "active") {
    assertPublishedOnlyUnlessScopedStaffAdmin({
      actor: input.actor,
      isPublished: aip.status === "published",
      resourceScopeKind: aipScope.scopeKind,
      resourceScopeId: aipScope.scopeId,
      message: "Unauthorized.",
    });
  }
  if (update.status === "hidden") {
    assertScopedStaffOrAdminAccess({
      actor: input.actor,
      resourceScopeKind: aipScope.scopeKind,
      resourceScopeId: aipScope.scopeId,
      message: "Unauthorized.",
    });
  }

  const { data: imageData, error: downloadError } = await admin.storage
    .from(media.bucket_id)
    .download(media.object_name);
  if (downloadError || !imageData) {
    return null;
  }

  return {
    imageData,
    objectName: media.object_name,
    mimeType: media.mime_type,
  };
}

export async function readProjectCoverBlob(input: {
  actor: PrivilegedActorContext | null;
  projectIdOrRef: string;
}): Promise<{ imageData: Blob; imagePath: string } | null> {
  assertNonEmptyString(input.projectIdOrRef, "Project identifier is required.");
  const normalized = input.projectIdOrRef.trim();
  const admin = getAdminClient();

  let projectRows: ProjectLookupRow[] = [];
  if (isUuid(normalized)) {
    const { data, error } = await admin
      .from("projects")
      .select("id,aip_id,image_url")
      .eq("id", normalized)
      .limit(2);
    if (error) return null;
    projectRows = (data ?? []) as ProjectLookupRow[];
  } else {
    const { data, error } = await admin
      .from("projects")
      .select("id,aip_id,image_url")
      .eq("aip_ref_code", normalized)
      .limit(2);
    if (error) return null;
    projectRows = (data ?? []) as ProjectLookupRow[];
  }

  if (projectRows.length !== 1) {
    return null;
  }
  const project = projectRows[0];
  const imagePath = project.image_url?.trim() ?? "";
  if (!imagePath) {
    return null;
  }

  const { data: aipData, error: aipError } = await admin
    .from("aips")
    .select("id,status,city_id,municipality_id,barangay_id")
    .eq("id", project.aip_id)
    .maybeSingle();
  if (aipError || !aipData) {
    return null;
  }
  const aip = aipData as AipCoverLookupRow;
  const aipScope = resolveAipScope({
    cityId: aip.city_id,
    municipalityId: aip.municipality_id,
    barangayId: aip.barangay_id,
  });
  assertPublishedOnlyUnlessScopedStaffAdmin({
    actor: input.actor,
    isPublished: aip.status === "published",
    resourceScopeKind: aipScope.scopeKind,
    resourceScopeId: aipScope.scopeId,
    message: "Unauthorized.",
  });

  const bucketId = getProjectMediaBucketName();
  const { data: imageData, error: downloadError } = await admin.storage
    .from(bucketId)
    .download(imagePath);
  if (downloadError || !imageData) {
    return null;
  }

  return {
    imageData,
    imagePath,
  };
}

export async function createCitizenReferenceSignedUrl(input: {
  actor: PrivilegedActorContext | null;
  bucketId: string;
  objectName: string;
  ttlSeconds: number;
}): Promise<{ signedUrl: string | null; errorMessage: string | null }> {
  assertNonEmptyString(input.bucketId, "Bucket id is required.");
  assertNonEmptyString(input.objectName, "Object name is required.");
  assertPositiveInteger(input.ttlSeconds, "Signed URL TTL must be a positive integer.");

  const admin = getAdminClient();
  const { data, error } = await admin.storage
    .from(input.bucketId)
    .createSignedUrl(input.objectName, input.ttlSeconds);

  return {
    signedUrl: data?.signedUrl ?? null,
    errorMessage: error?.message ?? null,
  };
}

export async function readExtractionRunStatusForBarangay(input: {
  actor: PrivilegedActorContext | null;
  runId: string;
}): Promise<ExtractionRunStatusRow | null> {
  assertActorPresent(input.actor, "Unauthorized.");
  assertActorRole(input.actor, ["barangay_official", "admin"], "Unauthorized.");
  assertNonEmptyString(input.runId, "Run id is required.");
  const runId = input.runId.trim();
  const admin = getAdminClient();

  const { data: runData, error: runError } = await admin
    .from("extraction_runs")
    .select(
      "id,aip_id,uploaded_file_id,stage,status,error_code,error_message,started_at,finished_at,created_at,overall_progress_pct,stage_progress_pct,progress_message,progress_updated_at"
    )
    .eq("id", runId)
    .maybeSingle();

  if (runError) {
    throw new InvariantError(400, runError.message);
  }
  if (!runData) {
    return null;
  }
  const run = runData as ExtractionRunStatusRow;

  if (input.actor.role === "admin") {
    return run;
  }

  assertInvariant(
    input.actor.lgu_scope === "barangay" && !!input.actor.lgu_id,
    403,
    "Unauthorized."
  );

  const { data: aipData, error: aipError } = await admin
    .from("aips")
    .select("id,barangay_id")
    .eq("id", run.aip_id)
    .maybeSingle();
  if (aipError) {
    throw new InvariantError(400, aipError.message);
  }
  if (!aipData) {
    return null;
  }
  const aip = aipData as AipScopeLookupRow;
  if (aip.barangay_id !== input.actor.lgu_id) {
    return null;
  }

  return run;
}

export async function uploadAipPdfObject(input: {
  actor: PrivilegedActorContext | null;
  aipId: string;
  bucketId: string;
  objectName: string;
  fileBuffer: Buffer;
  contentType: string;
}): Promise<void> {
  assertActorPresent(input.actor, "Unauthorized.");
  assertActorRole(
    input.actor,
    ["admin", "city_official", "municipal_official", "barangay_official"],
    "Unauthorized."
  );
  assertNonEmptyString(input.aipId, "AIP id is required.");
  assertNonEmptyString(input.bucketId, "Bucket id is required.");
  assertNonEmptyString(input.objectName, "Object name is required.");

  const admin = getAdminClient();
  const { error } = await admin.storage.from(input.bucketId).upload(input.objectName, input.fileBuffer, {
    contentType: input.contentType || "application/pdf",
    upsert: false,
  });
  if (error) {
    throw new Error(error.message);
  }

  await writePrivilegedAudit({
    actor: input.actor,
    action: "privileged_aip_pdf_uploaded",
    entityTable: "aips",
    entityId: input.aipId,
    metadata: {
      bucket_id: input.bucketId,
      object_name: input.objectName,
      size_bytes: input.fileBuffer.byteLength,
      content_type: input.contentType || "application/pdf",
    },
  });
}

export async function removeAipPdfObject(input: {
  actor: PrivilegedActorContext | null;
  aipId: string | null;
  bucketId: string;
  objectNames: string[];
}): Promise<void> {
  assertActorPresent(input.actor, "Unauthorized.");
  assertActorRole(
    input.actor,
    ["admin", "city_official", "municipal_official", "barangay_official"],
    "Unauthorized."
  );
  assertNonEmptyString(input.bucketId, "Bucket id is required.");

  const filtered = input.objectNames.filter((name) => typeof name === "string" && name.trim().length > 0);
  if (filtered.length === 0) return;

  const admin = getAdminClient();
  const { error } = await admin.storage.from(input.bucketId).remove(filtered);
  if (error) {
    throw new Error(error.message);
  }

  await writePrivilegedAudit({
    actor: input.actor,
    action: "privileged_aip_pdf_removed",
    entityTable: "aips",
    entityId: input.aipId,
    metadata: {
      bucket_id: input.bucketId,
      object_names: filtered,
      object_count: filtered.length,
    },
  });
}

export async function insertExtractionRun(input: {
  actor: PrivilegedActorContext | null;
  aipId: string;
  uploadedFileId: string | null;
  createdBy: string;
  modelName?: string;
  retryOfRunId?: string | null;
  resumeFromStage?: RetryResumeStage | null;
}): Promise<{ id: string; status: string }> {
  assertActorPresent(input.actor, "Unauthorized.");
  assertActorRole(
    input.actor,
    ["admin", "city_official", "municipal_official", "barangay_official"],
    "Unauthorized."
  );
  assertNonEmptyString(input.aipId, "AIP id is required.");
  assertNonEmptyString(input.createdBy, "Actor user id is required.");
  assertInvariant(input.actor.user_id === input.createdBy, 403, "Unauthorized.");
  const normalizedResumeFromStage = normalizeRetryResumeStage(input.resumeFromStage);
  const normalizedRetryOfRunId = input.retryOfRunId?.trim() || null;
  if (normalizedRetryOfRunId && !isUuid(normalizedRetryOfRunId)) {
    throw new InvariantError(400, "Retry run id must be a valid UUID.");
  }
  if (normalizedResumeFromStage && !normalizedRetryOfRunId) {
    throw new InvariantError(400, "Resume stage requires retry lineage.");
  }
  const queuedStage = normalizedResumeFromStage ?? "extract";

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("extraction_runs")
    .insert({
      aip_id: input.aipId,
      uploaded_file_id: input.uploadedFileId,
      retry_of_run_id: normalizedRetryOfRunId,
      stage: queuedStage,
      resume_from_stage: normalizedResumeFromStage,
      status: "queued",
      model_name: input.modelName ?? "gpt-5.2",
      created_by: input.createdBy,
    })
    .select("id,status")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to insert extraction run.");
  }

  const run = data as { id: string; status: string };
  await writePrivilegedAudit({
    actor: input.actor,
    action: "privileged_extraction_run_queued",
    entityTable: "extraction_runs",
    entityId: run.id,
    metadata: {
      aip_id: input.aipId,
      uploaded_file_id: input.uploadedFileId,
      model_name: input.modelName ?? "gpt-5.2",
      retry_of_run_id: normalizedRetryOfRunId,
      resume_from_stage: normalizedResumeFromStage,
    },
  });

  return run;
}

export async function dispatchEmbedCategorize(input: {
  actor: PrivilegedActorContext | null;
  aipId: string;
}): Promise<unknown> {
  assertActorPresent(input.actor, "Unauthorized.");
  assertActorRole(
    input.actor,
    ["admin", "city_official", "municipal_official", "barangay_official"],
    "Unauthorized."
  );
  assertNonEmptyString(input.aipId, "AIP id is required.");

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("dispatch_embed_categorize_for_aip", {
    p_aip_id: input.aipId,
  });
  if (error) {
    throw new Error(error.message);
  }

  if (data !== null) {
    await writePrivilegedAudit({
      actor: input.actor,
      action: "privileged_embed_dispatch_requested",
      entityTable: "aips",
      entityId: input.aipId,
      metadata: {
        dispatch_request_id: data,
      },
    });
  }

  return data;
}

export async function consumeChatQuota(
  input: ConsumeChatQuotaInput
): Promise<ConsumeChatQuotaResult> {
  assertActorPresent(input.actor, "Unauthorized.");
  assertActorRole(
    input.actor,
    ["citizen", "admin", "city_official", "municipal_official", "barangay_official"],
    "Unauthorized."
  );
  assertNonEmptyString(input.userId, "User id is required.");
  assertPositiveInteger(input.maxRequests, "Chat maxRequests must be a positive integer.");
  assertNonEmptyString(input.route, "Route is required.");

  const { perHour, perDay } = toPerHourAndPerDay(input.maxRequests, input.timeWindow);
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("consume_chat_quota", {
    p_user_id: input.userId,
    p_per_hour: perHour,
    p_per_day: perDay,
    p_route: input.route,
  });
  if (error) {
    throw new Error(error.message);
  }

  const payload = (data ?? {}) as { allowed?: unknown; reason?: unknown };
  const result: ConsumeChatQuotaResult = {
    allowed: payload.allowed === true,
    reason: typeof payload.reason === "string" ? payload.reason : "unknown",
    perHour,
    perDay,
  };

  await writePrivilegedAudit({
    actor: input.actor,
    action: "privileged_chat_quota_consumed",
    entityTable: "profiles",
    entityId: input.userId,
    metadata: {
      route: input.route,
      per_hour: perHour,
      per_day: perDay,
      allowed: result.allowed,
      reason: result.reason,
      target_user_id: input.userId,
    },
  });

  return result;
}

export async function insertAssistantChatMessage(input: {
  actor: PrivilegedActorContext | null;
  sessionId: string;
  content: string;
  citations: Json;
  retrievalMeta: Json;
}): Promise<AssistantChatMessageRow> {
  assertActorPresent(input.actor, "Unauthorized.");
  assertActorRole(
    input.actor,
    ["citizen", "admin", "city_official", "municipal_official", "barangay_official"],
    "Unauthorized."
  );
  assertNonEmptyString(input.sessionId, "Session id is required.");
  assertNonEmptyString(input.content, "Assistant content is required.");

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("chat_messages")
    .insert({
      session_id: input.sessionId,
      role: "assistant",
      content: input.content,
      citations: input.citations,
      retrieval_meta: input.retrievalMeta,
    })
    .select("id,session_id,role,content,citations,retrieval_meta,created_at")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to insert assistant message.");
  }

  const inserted = data as AssistantChatMessageRow;
  await writePrivilegedAudit({
    actor: input.actor,
    action: "privileged_chat_assistant_message_inserted",
    entityTable: "chat_messages",
    entityId: inserted.id,
    metadata: {
      session_id: input.sessionId,
      content_length: input.content.length,
    },
  });

  return inserted;
}

export async function uploadProjectMediaObject(
  input: UploadProjectMediaObjectInput
): Promise<UploadProjectMediaObjectResult> {
  assertActorPresent(input.actor, "Unauthorized.");
  assertActorRole(
    input.actor,
    ["admin", "city_official", "municipal_official", "barangay_official"],
    "Unauthorized."
  );
  assertNonEmptyString(input.aipId, "AIP id is required.");
  assertNonEmptyString(input.projectId, "Project id is required.");
  assertNonEmptyString(input.bucketId, "Bucket id is required.");
  assertNonEmptyString(input.objectName, "Object name is required.");

  const admin = getAdminClient();
  const { error } = await admin.storage.from(input.bucketId).upload(input.objectName, input.fileBuffer, {
    contentType: input.contentType || "application/octet-stream",
    upsert: false,
  });
  if (error) {
    throw new Error(error.message);
  }

  await writePrivilegedAudit({
    actor: input.actor,
    action: "privileged_project_media_uploaded",
    entityTable: "projects",
    entityId: input.projectId,
    metadata: {
      aip_id: input.aipId,
      project_id: input.projectId,
      update_id: input.updateId ?? null,
      bucket_id: input.bucketId,
      object_name: input.objectName,
      size_bytes: input.sizeBytes,
      content_type: input.contentType || "application/octet-stream",
    },
  });

  return {
    bucketId: input.bucketId,
    objectName: input.objectName,
    mimeType: input.contentType || "application/octet-stream",
    sizeBytes: input.sizeBytes,
  };
}

export async function removeProjectMediaObjects(input: {
  actor: PrivilegedActorContext | null;
  aipId: string | null;
  projectId: string | null;
  bucketId: string;
  objectNames: string[];
}): Promise<void> {
  assertActorPresent(input.actor, "Unauthorized.");
  assertActorRole(
    input.actor,
    ["admin", "city_official", "municipal_official", "barangay_official"],
    "Unauthorized."
  );
  assertNonEmptyString(input.bucketId, "Bucket id is required.");
  const objectNames = input.objectNames.filter((item) => item && item.trim().length > 0);
  if (objectNames.length === 0) return;

  const admin = getAdminClient();
  const { error } = await admin.storage.from(input.bucketId).remove(objectNames);
  if (error) {
    throw new Error(error.message);
  }

  await writePrivilegedAudit({
    actor: input.actor,
    action: "privileged_project_media_removed",
    entityTable: "projects",
    entityId: input.projectId,
    metadata: {
      aip_id: input.aipId,
      project_id: input.projectId,
      bucket_id: input.bucketId,
      object_names: objectNames,
      object_count: objectNames.length,
    },
  });
}

export function getProjectMediaBucketIdForPrivilegedOps(): string {
  return getProjectMediaBucketName();
}
