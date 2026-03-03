"use server";

import { getAppEnv, isMockEnabled } from "@/lib/config/appEnv";
import type { ActorContext } from "@/lib/domain/actor-context";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { writeActivityLog, writeWorkflowActivityLog } from "@/lib/audit/activity-log";
import { getAipProjectRepo, getAipRepo } from "@/lib/repos/aip/repo.server";
import { assertActorCanManageBarangayAipWorkflow } from "@/lib/repos/aip/workflow-permissions.server";
import { getFeedbackRepo } from "@/lib/repos/feedback/repo.server";
import {
  __appendMockAipReviewAction,
  __getMockAipReviewsForAipId,
} from "@/lib/repos/submissions/repo.mock";
import { AIPS_TABLE } from "@/mocks/fixtures/aip/aips.table.fixture";
import { notifySafely } from "@/lib/notifications";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

export type AipWorkflowActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; unresolvedAiCount?: number };

function success(message: string): AipWorkflowActionResult {
  return { ok: true, message };
}

function failure(
  message: string,
  unresolvedAiCount?: number
): AipWorkflowActionResult {
  if (typeof unresolvedAiCount === "number") {
    return { ok: false, message, unresolvedAiCount };
  }
  return { ok: false, message };
}

function isDevFallbackAllowed() {
  return getAppEnv() === "dev";
}

type ActorValidationResult = {
  actor: Awaited<ReturnType<typeof getActorContext>>;
  error: AipWorkflowActionResult | null;
};

type FeedbackReplySelectRow = {
  id: string;
  author_id: string | null;
  body: string;
  created_at: string;
};

type ProfileRoleSelectRow = {
  id: string;
  role:
    | "citizen"
    | "barangay_official"
    | "city_official"
    | "municipal_official"
    | "admin";
};

type UploadedFileStorageRefRow = {
  bucket_id: string | null;
  object_name: string | null;
};

type ExtractionArtifactStorageRefRow = {
  artifact_json: unknown;
};

type StorageRefsByBucket = Map<string, Set<string>>;

const DEFAULT_ARTIFACT_BUCKET = "aip-artifacts";
const STORAGE_DELETE_CHUNK_SIZE = 100;
const STORAGE_DELETE_FAILURE_MESSAGE =
  "Failed to delete one or more AIP files from storage. Draft was not deleted.";
const DB_DELETE_AFTER_STORAGE_FAILURE_MESSAGE =
  "Storage files were deleted but draft row deletion failed. Please contact admin.";
const AIP_ACTIVITY_ENTITY_TABLE = "aips";

function toRoleLabel(role: ActorContext["role"] | null | undefined): string | null {
  if (!role) return null;
  if (role === "barangay_official") return "Barangay Official";
  if (role === "city_official") return "City Official";
  if (role === "municipal_official") return "Municipal Official";
  if (role === "admin") return "Admin";
  if (role === "citizen") return "Citizen";
  return null;
}

function toScopeFromActor(
  actor: ActorContext | null
): { barangayId?: string | null; cityId?: string | null; municipalityId?: string | null } {
  if (!actor?.scope.id) return {};
  if (actor.scope.kind === "barangay") return { barangayId: actor.scope.id };
  if (actor.scope.kind === "city") return { cityId: actor.scope.id };
  if (actor.scope.kind === "municipality") return { municipalityId: actor.scope.id };
  return {};
}

async function resolveActorName(actor: ActorContext | null): Promise<string | null> {
  if (!actor?.userId || isMockEnabled()) return null;
  try {
    const client = await supabaseServer();
    const { data, error } = await client
      .from("profiles")
      .select("full_name")
      .eq("id", actor.userId)
      .maybeSingle();

    if (error || !data) return null;
    const fullName = data.full_name;
    if (typeof fullName !== "string") return null;
    const trimmed = fullName.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

async function logBarangayAipWorkflowEvent(input: {
  actor: ActorContext | null;
  aipId: string;
  action: "submission_created" | "cancelled" | "draft_deleted";
  details: string;
  hideCrudAction?: "aip_updated" | "aip_deleted";
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!input.actor || input.actor.role !== "barangay_official") return;

  const actorName = await resolveActorName(input.actor);
  const actorPosition = toRoleLabel(input.actor.role);

  try {
    await writeWorkflowActivityLog({
      action: input.action,
      entityTable: AIP_ACTIVITY_ENTITY_TABLE,
      entityId: input.aipId,
      scope: toScopeFromActor(input.actor),
      hideCrudAction: input.hideCrudAction ?? null,
      metadata: {
        details: input.details,
        actor_name: actorName,
        actor_position: actorPosition,
        ...(input.metadata ?? {}),
      },
    });
  } catch (error) {
    console.error("[AIP_WORKFLOW] failed to write workflow activity log", {
      aipId: input.aipId,
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function logBarangayAipDeleteCrudEvent(input: {
  actor: ActorContext | null;
  aipId: string;
  details: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (
    !input.actor ||
    (input.actor.role !== "barangay_official" && input.actor.role !== "city_official")
  ) {
    return;
  }

  const actorName = await resolveActorName(input.actor);
  const actorPosition = toRoleLabel(input.actor.role);

  try {
    await writeActivityLog({
      action: "aip_deleted",
      entityTable: AIP_ACTIVITY_ENTITY_TABLE,
      entityId: input.aipId,
      scope: toScopeFromActor(input.actor),
      metadata: {
        source: "crud",
        details: input.details,
        actor_name: actorName,
        actor_position: actorPosition,
        ...(input.metadata ?? {}),
      },
    });
  } catch (error) {
    console.error("[AIP_WORKFLOW] failed to write manual CRUD activity log", {
      aipId: input.aipId,
      action: "aip_deleted",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function assertBarangayActor(): Promise<ActorValidationResult> {
  const actor = await getActorContext();
  if (!actor) {
    if (isDevFallbackAllowed()) return { actor: null, error: null };
    return { actor: null, error: failure("Unauthorized.") };
  }

  if (
    actor.role !== "barangay_official" ||
    actor.scope.kind !== "barangay" ||
    !actor.scope.id
  ) {
    return { actor, error: failure("Unauthorized.") };
  }

  return { actor, error: null };
}

async function assertCityActor(): Promise<ActorValidationResult> {
  const actor = await getActorContext();
  if (!actor) {
    if (isDevFallbackAllowed()) return { actor: null, error: null };
    return { actor: null, error: failure("Unauthorized.") };
  }

  if (actor.role !== "city_official" || actor.scope.kind !== "city" || !actor.scope.id) {
    return { actor, error: failure("Unauthorized.") };
  }

  return { actor, error: null };
}

async function assertLocalOfficialActor(): Promise<ActorValidationResult> {
  const actor = await getActorContext();
  if (!actor) {
    if (isDevFallbackAllowed()) return { actor: null, error: null };
    return { actor: null, error: failure("Unauthorized.") };
  }

  const isBarangayActor =
    actor.role === "barangay_official" &&
    actor.scope.kind === "barangay" &&
    !!actor.scope.id;
  const isCityActor =
    actor.role === "city_official" &&
    actor.scope.kind === "city" &&
    !!actor.scope.id;
  if (!isBarangayActor && !isCityActor) {
    return { actor, error: failure("Unauthorized.") };
  }

  return { actor, error: null };
}

async function loadBarangayAip(aipId: string) {
  const trimmed = aipId.trim();
  if (!trimmed) return null;
  const aipRepo = getAipRepo({ defaultScope: "barangay" });
  const aip = await aipRepo.getAipDetail(trimmed);
  if (!aip || aip.scope !== "barangay") return null;
  return aip;
}

async function assertBarangayAipWorkflowOwnership(
  aipId: string,
  actor: ActorContext | null
): Promise<AipWorkflowActionResult | null> {
  if (!actor) return null;
  try {
    await assertActorCanManageBarangayAipWorkflow({ aipId, actor });
    return null;
  } catch (error) {
    return failure(
      error instanceof Error
        ? error.message
        : "Only the uploader of this AIP can modify this workflow."
    );
  }
}

async function loadCityAip(aipId: string) {
  const trimmed = aipId.trim();
  if (!trimmed) return null;
  const aipRepo = getAipRepo({ defaultScope: "city" });
  const aip = await aipRepo.getAipDetail(trimmed);
  if (!aip || aip.scope !== "city") return null;
  return aip;
}

async function hasRequestRevisionHistory(aipId: string): Promise<boolean> {
  if (isMockEnabled()) {
    return __getMockAipReviewsForAipId(aipId).some(
      (item) => item.action === "request_revision"
    );
  }

  const client = await supabaseServer();
  const { data, error } = await client
    .from("aip_reviews")
    .select("id")
    .eq("aip_id", aipId)
    .eq("action", "request_revision")
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data) && data.length > 0;
}

async function getLatestRequestRevisionCreatedAt(
  aipId: string
): Promise<string | null> {
  if (isMockEnabled()) {
    const requestRows = __getMockAipReviewsForAipId(aipId)
      .filter((item) => item.action === "request_revision")
      .sort((left, right) => {
        const leftAt = new Date(left.createdAt).getTime();
        const rightAt = new Date(right.createdAt).getTime();
        if (leftAt !== rightAt) return rightAt - leftAt;
        return right.id.localeCompare(left.id);
      });
    return requestRows[0]?.createdAt ?? null;
  }

  const client = await supabaseServer();
  const { data, error } = await client
    .from("aip_reviews")
    .select("id,created_at")
    .eq("aip_id", aipId)
    .eq("action", "request_revision")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.created_at ?? null;
}

async function hasSavedBarangayRevisionReply(params: {
  aipId: string;
  requestedAt: string;
}): Promise<boolean> {
  const requestedAtMs = new Date(params.requestedAt).getTime();

  if (isMockEnabled()) {
    const repo = getFeedbackRepo();
    const rows = await repo.listForAip(params.aipId);
    return rows.some((row) => {
      if (row.kind !== "lgu_note") return false;
      if (row.parentFeedbackId !== null) return false;
      if (!row.body.trim()) return false;
      const createdAtMs = new Date(row.createdAt).getTime();
      if (!Number.isFinite(requestedAtMs) || !Number.isFinite(createdAtMs)) {
        return false;
      }
      return createdAtMs >= requestedAtMs;
    });
  }

  const client = await supabaseServer();
  const { data, error } = await client
    .from("feedback")
    .select("id,author_id,body,created_at")
    .eq("target_type", "aip")
    .eq("aip_id", params.aipId)
    .eq("source", "human")
    .eq("kind", "lgu_note")
    .is("parent_feedback_id", null)
    .gte("created_at", params.requestedAt)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as FeedbackReplySelectRow[];
  if (!rows.length) return false;

  const authorIds = Array.from(
    new Set(
      rows
        .map((row) => row.author_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );
  if (!authorIds.length) return false;

  const { data: profiles, error: profileError } = await client
    .from("profiles")
    .select("id,role")
    .in("id", authorIds);
  if (profileError) {
    throw new Error(profileError.message);
  }

  const barangayOfficialIds = new Set(
    ((profiles ?? []) as ProfileRoleSelectRow[])
      .filter((profile) => profile.role === "barangay_official")
      .map((profile) => profile.id)
  );

  return rows.some(
    (row) =>
      typeof row.author_id === "string" &&
      barangayOfficialIds.has(row.author_id) &&
      row.body.trim().length > 0
  );
}

async function saveRevisionReply(params: {
  aipId: string;
  reply: string;
  actorUserId: string | null;
}): Promise<void> {
  const repo = getFeedbackRepo();
  await repo.createForAip(params.aipId, {
    kind: "lgu_note",
    body: params.reply,
    authorId: params.actorUserId ?? (isMockEnabled() ? "official_001" : null),
    isPublic: true,
  });
}

function normalizeStorageValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getArtifactBucketName(): string {
  const raw = process.env.SUPABASE_STORAGE_ARTIFACT_BUCKET;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || DEFAULT_ARTIFACT_BUCKET;
}

function addStorageRef(
  refsByBucket: StorageRefsByBucket,
  bucketValue: unknown,
  objectPathValue: unknown
): void {
  const bucket = normalizeStorageValue(bucketValue);
  const objectPath = normalizeStorageValue(objectPathValue);
  if (!bucket || !objectPath) return;

  const existing = refsByBucket.get(bucket);
  if (existing) {
    existing.add(objectPath);
    return;
  }

  refsByBucket.set(bucket, new Set([objectPath]));
}

function mergeStorageRefs(
  target: StorageRefsByBucket,
  source: StorageRefsByBucket
): void {
  for (const [bucket, objectPaths] of source.entries()) {
    for (const objectPath of objectPaths.values()) {
      addStorageRef(target, bucket, objectPath);
    }
  }
}

async function collectUploadedFileStorageRefs(
  admin: ReturnType<typeof supabaseAdmin>,
  aipId: string
): Promise<StorageRefsByBucket> {
  const refsByBucket: StorageRefsByBucket = new Map();
  const { data, error } = await admin
    .from("uploaded_files")
    .select("bucket_id,object_name")
    .eq("aip_id", aipId);
  if (error) {
    throw new Error(`Failed to collect uploaded file refs: ${error.message}`);
  }

  const rows = (data ?? []) as UploadedFileStorageRefRow[];
  for (const row of rows) {
    addStorageRef(refsByBucket, row.bucket_id, row.object_name);
  }

  return refsByBucket;
}

async function collectArtifactStorageRefs(
  admin: ReturnType<typeof supabaseAdmin>,
  aipId: string
): Promise<StorageRefsByBucket> {
  const refsByBucket: StorageRefsByBucket = new Map();
  const artifactBucket = getArtifactBucketName();

  const { data, error } = await admin
    .from("extraction_artifacts")
    .select("artifact_json")
    .eq("aip_id", aipId);
  if (error) {
    throw new Error(`Failed to collect extraction artifact refs: ${error.message}`);
  }

  const rows = (data ?? []) as ExtractionArtifactStorageRefRow[];
  for (const row of rows) {
    const value = row.artifact_json;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const storagePath = normalizeStorageValue(
      (value as { storage_path?: unknown }).storage_path
    );
    addStorageRef(refsByBucket, artifactBucket, storagePath);
  }

  return refsByBucket;
}

async function collectAllAipStorageRefs(
  admin: ReturnType<typeof supabaseAdmin>,
  aipId: string
): Promise<StorageRefsByBucket> {
  const refsByBucket: StorageRefsByBucket = new Map();
  mergeStorageRefs(refsByBucket, await collectUploadedFileStorageRefs(admin, aipId));
  mergeStorageRefs(refsByBucket, await collectArtifactStorageRefs(admin, aipId));
  return refsByBucket;
}

function getSortedStorageEntries(
  refsByBucket: StorageRefsByBucket
): Array<[string, string[]]> {
  return Array.from(refsByBucket.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([bucket, objectPaths]) => [
      bucket,
      Array.from(objectPaths.values()).sort((left, right) => left.localeCompare(right)),
    ]);
}

async function deleteStorageRefsStrict(
  admin: ReturnType<typeof supabaseAdmin>,
  refsByBucket: StorageRefsByBucket
): Promise<void> {
  const entries = getSortedStorageEntries(refsByBucket);

  for (const [bucket, objectPaths] of entries) {
    for (let start = 0; start < objectPaths.length; start += STORAGE_DELETE_CHUNK_SIZE) {
      const chunk = objectPaths.slice(start, start + STORAGE_DELETE_CHUNK_SIZE);
      if (!chunk.length) continue;

      const { error } = await admin.storage.from(bucket).remove(chunk);
      if (error) {
        throw new Error(
          `Storage deletion failed for bucket "${bucket}" (${chunk.length} item(s)): ${error.message}`
        );
      }
    }
  }
}

async function deleteAipRow(aipId: string) {
  if (isMockEnabled()) {
    const index = AIPS_TABLE.findIndex((row) => row.id === aipId);
    if (index >= 0) {
      AIPS_TABLE.splice(index, 1);
    }
    return;
  }

  const admin = supabaseAdmin();
  const refsByBucket = await collectAllAipStorageRefs(admin, aipId);
  try {
    await deleteStorageRefsStrict(admin, refsByBucket);
  } catch (error) {
    console.error("[AIP_DELETE] strict storage deletion failed", {
      aipId,
      error: error instanceof Error ? error.message : String(error),
      refsByBucket: getSortedStorageEntries(refsByBucket).map(([bucket, paths]) => ({
        bucket,
        count: paths.length,
      })),
    });
    throw new Error(STORAGE_DELETE_FAILURE_MESSAGE);
  }

  const { error } = await admin.from("aips").delete().eq("id", aipId);
  if (error) {
    console.error("[AIP_DELETE] db row deletion failed after storage cleanup", {
      aipId,
      error: error.message,
    });
    throw new Error(DB_DELETE_AFTER_STORAGE_FAILURE_MESSAGE);
  }
}

async function isAipOwnedByActor(
  aipId: string,
  actor: NonNullable<Awaited<ReturnType<typeof getActorContext>>>
): Promise<boolean> {
  if (actor.scope.kind !== "barangay" && actor.scope.kind !== "city") {
    return false;
  }
  if (!actor.scope.id) {
    return false;
  }

  if (isMockEnabled()) {
    const aip = AIPS_TABLE.find((row) => row.id === aipId);
    if (!aip) return false;
    return actor.scope.kind === "barangay"
      ? aip.scope === "barangay"
      : aip.scope === "city";
  }

  const client = await supabaseServer();
  const scopeColumn = actor.scope.kind === "barangay" ? "barangay_id" : "city_id";
  const { data, error } = await client
    .from("aips")
    .select("id")
    .eq("id", aipId)
    .eq(scopeColumn, actor.scope.id)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return Boolean(data);
}

async function recordCityPublishReview(input: {
  aipId: string;
  reviewerId: string | null;
}): Promise<void> {
  if (isMockEnabled()) {
    __appendMockAipReviewAction({
      aipId: input.aipId,
      reviewerId: input.reviewerId ?? "official_001",
      action: "approve",
      note: null,
    });
    return;
  }

  if (!input.reviewerId) {
    throw new Error("Unable to identify the city official who published this AIP.");
  }

  const client = await supabaseServer();
  const { error } = await client.from("aip_reviews").insert({
    aip_id: input.aipId,
    action: "approve",
    note: null,
    reviewer_id: input.reviewerId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function submitAipForReviewAction(input: {
  aipId: string;
  revisionReply?: string;
}): Promise<AipWorkflowActionResult> {
  const { actor, error: actorError } = await assertBarangayActor();
  if (actorError) return actorError;

  try {
    const aip = await loadBarangayAip(input.aipId);
    if (!aip) return failure("AIP not found.");
    const ownershipError = await assertBarangayAipWorkflowOwnership(aip.id, actor);
    if (ownershipError) return ownershipError;

    if (aip.status !== "draft" && aip.status !== "for_revision") {
      return failure(
        "Submit for review is only allowed when the AIP status is Draft or For Revision."
      );
    }

    const projectRepo = getAipProjectRepo("barangay");
    const rows = await projectRepo.listByAip(aip.id);
    const unresolvedAiCount = rows.filter(
      (row) => row.reviewStatus === "ai_flagged"
    ).length;

    if (unresolvedAiCount > 0) {
      return failure(
        `Resolve all AI-flagged projects before submitting. ${unresolvedAiCount} project(s) still need an official response.`,
        unresolvedAiCount
      );
    }

    if (aip.status === "for_revision") {
      const latestRequestRevisionCreatedAt =
        await getLatestRequestRevisionCreatedAt(aip.id);
      const trimmedRevisionReply =
        typeof input.revisionReply === "string" ? input.revisionReply.trim() : "";

      let hasSavedReply = false;
      if (latestRequestRevisionCreatedAt) {
        hasSavedReply = await hasSavedBarangayRevisionReply({
          aipId: aip.id,
          requestedAt: latestRequestRevisionCreatedAt,
        });
      }

      if (!hasSavedReply && !trimmedRevisionReply) {
        return failure("Reply to reviewer remarks is required before resubmitting.");
      }

      if (trimmedRevisionReply) {
        await saveRevisionReply({
          aipId: aip.id,
          reply: trimmedRevisionReply,
          actorUserId: actor?.userId ?? null,
        });
      }
    }

    const aipRepo = getAipRepo({ defaultScope: "barangay" });
    await aipRepo.updateAipStatus(aip.id, "pending_review");
    await notifySafely({
      eventType: aip.status === "for_revision" ? "AIP_RESUBMITTED" : "AIP_SUBMITTED",
      scopeType: "city",
      entityType: "aip",
      entityId: aip.id,
      aipId: aip.id,
      actorUserId: actor?.userId ?? null,
      actorRole: actor?.role ?? null,
      transition:
        aip.status === "for_revision"
          ? "for_revision->pending_review"
          : "draft->pending_review",
    });
    await logBarangayAipWorkflowEvent({
      actor,
      aipId: aip.id,
      action: "submission_created",
      hideCrudAction: "aip_updated",
      details: "Submitted AIP draft for review.",
      metadata: {
        from_status: aip.status,
        to_status: "pending_review",
      },
    });

    return success("AIP submitted for review.");
  } catch (error) {
    return failure(
      error instanceof Error
        ? error.message
        : "Failed to submit AIP for review."
    );
  }
}

export async function submitCityAipForPublishAction(input: {
  aipId: string;
}): Promise<AipWorkflowActionResult> {
  const { actor, error: actorError } = await assertCityActor();
  if (actorError) return actorError;

  try {
    const aip = await loadCityAip(input.aipId);
    if (!aip) return failure("AIP not found.");

    if (aip.status !== "draft" && aip.status !== "for_revision") {
      return failure(
        "Submit & publish is only allowed when the AIP status is Draft or For Revision."
      );
    }

    const projectRepo = getAipProjectRepo("city");
    const rows = await projectRepo.listByAip(aip.id);
    const unresolvedAiCount = rows.filter(
      (row) => row.reviewStatus === "ai_flagged"
    ).length;
    if (unresolvedAiCount > 0) {
      return failure(
        `Resolve all AI-flagged projects before publishing. ${unresolvedAiCount} project(s) still need an official response.`,
        unresolvedAiCount
      );
    }

    const aipRepo = getAipRepo({ defaultScope: "city" });
    await aipRepo.updateAipStatus(aip.id, "published");
    await recordCityPublishReview({
      aipId: aip.id,
      reviewerId: actor?.userId ?? null,
    });
    await notifySafely({
      eventType: "AIP_PUBLISHED",
      scopeType: "city",
      entityType: "aip",
      entityId: aip.id,
      aipId: aip.id,
      actorUserId: actor?.userId ?? null,
      actorRole: actor?.role ?? null,
      transition:
        aip.status === "for_revision" ? "for_revision->published" : "draft->published",
    });

    return success("AIP published successfully.");
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Failed to publish city AIP."
    );
  }
}

export async function saveAipRevisionReplyAction(input: {
  aipId: string;
  reply: string;
}): Promise<AipWorkflowActionResult> {
  const { actor, error: actorError } = await assertBarangayActor();
  if (actorError) return actorError;

  try {
    const aip = await loadBarangayAip(input.aipId);
    if (!aip) return failure("AIP not found.");
    const ownershipError = await assertBarangayAipWorkflowOwnership(aip.id, actor);
    if (ownershipError) return ownershipError;

    const canSaveForRevision = aip.status === "for_revision";
    const canSaveDraftWithRevisionHistory =
      aip.status === "draft" && (await hasRequestRevisionHistory(aip.id));

    if (!canSaveForRevision && !canSaveDraftWithRevisionHistory) {
      return failure(
        "Reply can only be saved when the AIP status is For Revision or a draft with revision history."
      );
    }

    const trimmedReply = input.reply.trim();
    if (!trimmedReply) {
      return failure("Reply message is required.");
    }

    await saveRevisionReply({
      aipId: aip.id,
      reply: trimmedReply,
      actorUserId: actor?.userId ?? null,
    });

    return success("Reply saved successfully.");
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Failed to save revision reply."
    );
  }
}

export async function cancelAipSubmissionAction(input: {
  aipId: string;
}): Promise<AipWorkflowActionResult> {
  const { actor, error: actorError } = await assertBarangayActor();
  if (actorError) return actorError;

  try {
    const aip = await loadBarangayAip(input.aipId);
    if (!aip) return failure("AIP not found.");
    const ownershipError = await assertBarangayAipWorkflowOwnership(aip.id, actor);
    if (ownershipError) return ownershipError;

    if (aip.status !== "pending_review") {
      return failure(
        "Cancel submission is only allowed when the AIP status is Pending Review."
      );
    }

    const hasRevisionHistory = await hasRequestRevisionHistory(aip.id);
    const nextStatus = hasRevisionHistory ? "for_revision" : "draft";
    const aipRepo = getAipRepo({ defaultScope: "barangay" });
    await aipRepo.updateAipStatus(aip.id, nextStatus);
    await logBarangayAipWorkflowEvent({
      actor,
      aipId: aip.id,
      action: "cancelled",
      hideCrudAction: "aip_updated",
      details: "Cancelled AIP submission and returned it to editable status.",
      metadata: {
        from_status: "pending_review",
        to_status: nextStatus,
      },
    });
    return success(
      hasRevisionHistory
        ? "AIP submission was canceled and moved back to For Revision."
        : "AIP submission was canceled and moved back to Draft."
    );
  } catch (error) {
    return failure(
      error instanceof Error
        ? error.message
        : "Failed to cancel AIP submission."
    );
  }
}

export async function deleteAipDraftAction(input: {
  aipId: string;
}): Promise<AipWorkflowActionResult> {
  const { actor, error: actorError } = await assertLocalOfficialActor();
  if (actorError) return actorError;

  try {
    const aip =
      actor?.scope.kind === "city"
        ? await loadCityAip(input.aipId)
        : actor?.scope.kind === "barangay"
          ? await loadBarangayAip(input.aipId)
          : (await loadBarangayAip(input.aipId)) ?? (await loadCityAip(input.aipId));
    if (!aip) return failure("AIP not found.");

    if (actor) {
      const owned = await isAipOwnedByActor(aip.id, actor);
      if (!owned) return failure("AIP not found.");
      if (actor.scope.kind === "barangay") {
        const ownershipError = await assertBarangayAipWorkflowOwnership(aip.id, actor);
        if (ownershipError) return ownershipError;
      }
    }

    if (aip.status !== "draft") {
      return failure(
        "Delete draft is only allowed when the AIP status is Draft."
      );
    }

    const hasRevisionHistory = await hasRequestRevisionHistory(aip.id);
    if (hasRevisionHistory) {
      return failure(
        "This draft cannot be deleted because it was previously returned for revision."
      );
    }

    await deleteAipRow(aip.id);
    await logBarangayAipDeleteCrudEvent({
      actor,
      aipId: aip.id,
      details: "Deleted an AIP draft record.",
      metadata: {
        prior_status: aip.status,
      },
    });
    await logBarangayAipWorkflowEvent({
      actor,
      aipId: aip.id,
      action: "draft_deleted",
      hideCrudAction: "aip_deleted",
      details: "Deleted an AIP draft from the barangay workspace.",
      metadata: {
        prior_status: aip.status,
      },
    });
    return success("Draft AIP deleted successfully.");
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Failed to delete draft AIP."
    );
  }
}
