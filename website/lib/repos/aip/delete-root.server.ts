import "server-only";

import { supabaseAdmin, type SupabaseAdminClient } from "@/lib/supabase/admin";

type UploadedFileStorageRefRow = {
  bucket_id: string | null;
  object_name: string | null;
};

type ExtractionArtifactStorageRefRow = {
  artifact_json: unknown;
};

type StorageRefsByBucket = Map<string, Set<string>>;

export type AipStorageDeletionSummary = {
  bucket: string;
  count: number;
};

export type DeleteAipRootResult = {
  aipId: string;
  storageDeleted: AipStorageDeletionSummary[];
};

const DEFAULT_ARTIFACT_BUCKET = "aip-artifacts";
const STORAGE_DELETE_CHUNK_SIZE = 100;

export const AIP_STORAGE_DELETE_FAILURE_MESSAGE =
  "Failed to delete one or more AIP files from storage. Draft was not deleted.";
export const AIP_DB_DELETE_AFTER_STORAGE_FAILURE_MESSAGE =
  "Storage files were deleted but draft row deletion failed. Please contact admin.";

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

function mergeStorageRefs(target: StorageRefsByBucket, source: StorageRefsByBucket): void {
  for (const [bucket, objectPaths] of source.entries()) {
    for (const objectPath of objectPaths.values()) {
      addStorageRef(target, bucket, objectPath);
    }
  }
}

async function collectUploadedFileStorageRefs(
  admin: SupabaseAdminClient,
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
  admin: SupabaseAdminClient,
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
  admin: SupabaseAdminClient,
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
  admin: SupabaseAdminClient,
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

function toStorageDeletionSummary(
  refsByBucket: StorageRefsByBucket
): AipStorageDeletionSummary[] {
  return getSortedStorageEntries(refsByBucket).map(([bucket, objectPaths]) => ({
    bucket,
    count: objectPaths.length,
  }));
}

export async function deleteAipRootWithStorageCleanup(input: {
  aipId: string;
  admin?: SupabaseAdminClient;
}): Promise<DeleteAipRootResult> {
  const aipId = input.aipId.trim();
  if (!aipId) {
    throw new Error("AIP ID is required for root deletion.");
  }

  const admin = input.admin ?? supabaseAdmin();
  const refsByBucket = await collectAllAipStorageRefs(admin, aipId);
  const storageDeleted = toStorageDeletionSummary(refsByBucket);

  try {
    await deleteStorageRefsStrict(admin, refsByBucket);
  } catch (error) {
    console.error("[AIP_DELETE] strict storage deletion failed", {
      aipId,
      error: error instanceof Error ? error.message : String(error),
      refsByBucket: storageDeleted,
    });
    throw new Error(AIP_STORAGE_DELETE_FAILURE_MESSAGE);
  }

  const { error } = await admin.from("aips").delete().eq("id", aipId);
  if (error) {
    console.error("[AIP_DELETE] db row deletion failed after storage cleanup", {
      aipId,
      error: error.message,
    });
    throw new Error(AIP_DB_DELETE_AFTER_STORAGE_FAILURE_MESSAGE);
  }

  return {
    aipId,
    storageDeleted,
  };
}
