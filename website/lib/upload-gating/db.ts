import "server-only";

import type { AipStatus } from "@/lib/contracts/databasev2";
import type { ActorContext } from "@/lib/domain/actor-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SupportedLGULevel } from "./constants";
import type {
  ExistingAipState,
  UploadValidationAuditContext,
  UploaderScopeContext,
  ValidationCode,
} from "./types";

type AipScopeLookupRow = {
  id: string;
  status: AipStatus;
};

type LocalityNameRow = {
  id: string;
  name: string | null;
};

type BarangayLookupRow = {
  id: string;
  name: string | null;
  city_id: string | null;
  municipality_id: string | null;
};

type UploadValidationLogInsert = {
  user_id: string | null;
  lgu_id: string | null;
  lgu_level: SupportedLGULevel | null;
  selected_year: number | null;
  detected_year: number | null;
  detected_lgu_name: string | null;
  detected_lgu_level: SupportedLGULevel | null;
  file_name: string | null;
  sanitized_file_name: string | null;
  file_size: number | null;
  file_hash_sha256: string | null;
  page_count: number | null;
  storage_path: string | null;
  status: "accepted" | "rejected";
  rejection_code: ValidationCode | null;
  rejection_details_json: Record<string, unknown>;
};

export async function resolveUploaderScopeContext(
  actor: ActorContext
): Promise<UploaderScopeContext | null> {
  if (!actor.scope.id) return null;
  const admin = supabaseAdmin();

  if (actor.scope.kind === "city") {
    const { data, error } = await admin
      .from("cities")
      .select("id,name")
      .eq("id", actor.scope.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as LocalityNameRow;
    const name = row.name?.trim();
    if (!name) return null;
    return {
      level: "city",
      lguId: row.id,
      lguName: name,
      parentCityName: null,
    };
  }

  if (actor.scope.kind === "barangay") {
    const { data, error } = await admin
      .from("barangays")
      .select("id,name,city_id,municipality_id")
      .eq("id", actor.scope.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const barangay = data as BarangayLookupRow;
    const barangayName = barangay.name?.trim();
    if (!barangayName) return null;

    let parentCityName: string | null = null;
    if (barangay.city_id) {
      const { data: cityData, error: cityError } = await admin
        .from("cities")
        .select("id,name")
        .eq("id", barangay.city_id)
        .maybeSingle();
      if (cityError) throw new Error(cityError.message);
      parentCityName =
        ((cityData ?? null) as LocalityNameRow | null)?.name?.trim() ?? null;
    } else if (barangay.municipality_id) {
      const { data: municipalityData, error: municipalityError } = await admin
        .from("municipalities")
        .select("id,name")
        .eq("id", barangay.municipality_id)
        .maybeSingle();
      if (municipalityError) throw new Error(municipalityError.message);
      parentCityName =
        ((municipalityData ?? null) as LocalityNameRow | null)?.name?.trim() ??
        null;
    }

    return {
      level: "barangay",
      lguId: barangay.id,
      lguName: barangayName,
      parentCityName,
    };
  }

  return null;
}

export async function findExistingAipForScope(input: {
  lguLevel: SupportedLGULevel;
  lguId: string;
  selectedYear: number;
}): Promise<ExistingAipState> {
  const admin = supabaseAdmin();
  const scopeColumn = input.lguLevel === "barangay" ? "barangay_id" : "city_id";
  const { data, error } = await admin
    .from("aips")
    .select("id,status")
    .eq(scopeColumn, input.lguId)
    .eq("fiscal_year", input.selectedYear)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as AipScopeLookupRow;
  return { id: row.id, status: row.status };
}

export async function isDuplicateFileHash(fileHashSha256: string): Promise<boolean> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("uploaded_files")
    .select("id")
    .eq("sha256_hex", fileHashSha256)
    .limit(1);
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}

export async function countRecentRejectedUploadAttempts(input: {
  userId: string;
  createdAtGteIso: string;
}): Promise<number> {
  const admin = supabaseAdmin();
  const { count, error } = await admin
    .from("aip_upload_validation_logs")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", input.userId)
    .eq("status", "rejected")
    .gte("created_at", input.createdAtGteIso);
  if (error) throw new Error(error.message);
  return Number.isFinite(count) ? Number(count) : 0;
}

export async function insertUploadValidationLog(input: {
  actor: ActorContext | null;
  scope: UploaderScopeContext | null;
  status: "accepted" | "rejected";
  code: ValidationCode | null;
  details: Record<string, unknown>;
  audit: UploadValidationAuditContext;
  storagePath?: string | null;
}): Promise<void> {
  const admin = supabaseAdmin();
  const payload: UploadValidationLogInsert = {
    user_id: input.actor?.userId ?? null,
    lgu_id: input.scope?.lguId ?? input.actor?.scope.id ?? null,
    lgu_level: input.scope?.level ?? null,
    selected_year: input.audit.selectedYear,
    detected_year: input.audit.detectedYear,
    detected_lgu_name: input.audit.detectedLGU,
    detected_lgu_level: input.audit.detectedLGULevel,
    file_name: input.audit.originalFileName,
    sanitized_file_name: input.audit.sanitizedFileName,
    file_size: input.audit.fileSizeBytes,
    file_hash_sha256: input.audit.fileHashSha256,
    page_count: input.audit.pageCount,
    storage_path: input.storagePath ?? null,
    status: input.status,
    rejection_code: input.code,
    rejection_details_json: input.details,
  };

  const { error } = await admin.from("aip_upload_validation_logs").insert(payload);
  if (error) {
    throw new Error(error.message);
  }
}
