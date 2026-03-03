import { randomUUID, createHash } from "crypto";
import { NextResponse } from "next/server";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import {
  assertActorPresent,
  assertPrivilegedWriteAccess,
  isInvariantError,
} from "@/lib/security/invariants";
import {
  insertExtractionRun,
  removeAipPdfObject,
  toPrivilegedActorContext,
  uploadAipPdfObject,
} from "@/lib/supabase/privileged-ops";
import { supabaseServer } from "@/lib/supabase/server";

const BUCKET_ID = "aip-pdfs";
const PDF_MAGIC_BYTES = Buffer.from("%PDF-", "ascii");

const AIP_UPLOAD_MAX_BYTES = readPositiveIntEnv("AIP_UPLOAD_MAX_BYTES", 15 * 1024 * 1024);
const AIP_UPLOAD_FAILURE_THRESHOLD = readPositiveIntEnv("AIP_UPLOAD_FAILURE_THRESHOLD", 5);
const AIP_UPLOAD_FAILURE_WINDOW_MINUTES = readPositiveIntEnv("AIP_UPLOAD_FAILURE_WINDOW_MINUTES", 60);
const AIP_UPLOAD_FAILURE_COOLDOWN_MINUTES = readPositiveIntEnv("AIP_UPLOAD_FAILURE_COOLDOWN_MINUTES", 15);

/*
Security proof:
- Caps/env:
  - AIP_UPLOAD_MAX_BYTES (default 15728640 / 15MB)
  - AIP_UPLOAD_FAILURE_THRESHOLD (default 5)
  - AIP_UPLOAD_FAILURE_WINDOW_MINUTES (default 60)
  - AIP_UPLOAD_FAILURE_COOLDOWN_MINUTES (default 15)
- Example errors:
  - 400 {"message":"Invalid PDF file header. Expected %PDF- magic bytes."}
  - 400 {"message":"File too large. Maximum file size is 15MB."}
  - 429 {"message":"Upload temporarily throttled after repeated failed processing runs. Try again later.","code":"upload_throttled","retryAfterSeconds":300}
*/

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bytesToMbLabel(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return mb.endsWith(".0") ? mb.slice(0, -2) : mb;
}

function isPdfFile(file: File): boolean {
  if (file.type === "application/pdf") return true;
  return file.name.toLowerCase().endsWith(".pdf");
}

function hasPdfMagicBytes(fileBuffer: Buffer): boolean {
  return fileBuffer.length >= PDF_MAGIC_BYTES.length && fileBuffer.subarray(0, PDF_MAGIC_BYTES.length).equals(PDF_MAGIC_BYTES);
}

export async function POST(request: Request) {
  try {
    const csrf = enforceCsrfProtection(request, { requireToken: true });
    if (!csrf.ok) {
      return csrf.response;
    }

    const actor = await getActorContext();
    assertActorPresent(actor, "Unauthorized.");
    assertPrivilegedWriteAccess({
      actor,
      allowlistedRoles: ["city_official"],
      scopeByRole: { city_official: "city" },
      requireScopeId: true,
      message: "Unauthorized.",
    });

    const form = await request.formData();
    const file = form.get("file");
    const yearRaw = form.get("year");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { message: "Please upload an AIP PDF file." },
        { status: 400 }
      );
    }
    if (!isPdfFile(file)) {
      return NextResponse.json(
        { message: "PDF only. Please upload a .pdf file." },
        { status: 400 }
      );
    }
    if (file.size > AIP_UPLOAD_MAX_BYTES) {
      return NextResponse.json(
        { message: `File too large. Maximum file size is ${bytesToMbLabel(AIP_UPLOAD_MAX_BYTES)}MB.` },
        { status: 400 }
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    if (!hasPdfMagicBytes(fileBuffer)) {
      return NextResponse.json({ message: "Invalid PDF file header. Expected %PDF- magic bytes." }, { status: 400 });
    }

    const fiscalYear = Number(yearRaw);
    if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
      return NextResponse.json({ message: "Invalid AIP year." }, { status: 400 });
    }

    const client = await supabaseServer();
    const failureWindowStart = new Date(Date.now() - AIP_UPLOAD_FAILURE_WINDOW_MINUTES * 60_000).toISOString();
    const { data: recentFailures, error: recentFailuresError } = await client
      .from("extraction_runs")
      .select("created_at")
      .eq("created_by", actor.userId)
      .eq("status", "failed")
      .gte("created_at", failureWindowStart)
      .order("created_at", { ascending: false })
      .limit(Math.max(AIP_UPLOAD_FAILURE_THRESHOLD, 20));
    if (recentFailuresError) {
      return NextResponse.json({ message: recentFailuresError.message }, { status: 400 });
    }

    const failures = Array.isArray(recentFailures) ? recentFailures : [];
    if (failures.length >= AIP_UPLOAD_FAILURE_THRESHOLD) {
      const newestFailureAt = Date.parse(String(failures[0]?.created_at ?? ""));
      if (Number.isFinite(newestFailureAt)) {
        const cooldownUntil = newestFailureAt + AIP_UPLOAD_FAILURE_COOLDOWN_MINUTES * 60_000;
        const now = Date.now();
        if (cooldownUntil > now) {
          const retryAfterSeconds = Math.max(1, Math.ceil((cooldownUntil - now) / 1000));
          return NextResponse.json(
            {
              message: "Upload temporarily throttled after repeated failed processing runs. Try again later.",
              code: "upload_throttled",
              retryAfterSeconds,
            },
            { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
          );
        }
      }
    }

    const { data: existing, error: existingError } = await client
      .from("aips")
      .select("id,status")
      .eq("city_id", actor.scope.id)
      .eq("fiscal_year", fiscalYear)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ message: existingError.message }, { status: 400 });
    }

    let aipId = existing?.id ?? null;
    let aipStatus = existing?.status ?? null;

    if (existing && existing.status !== "draft" && existing.status !== "for_revision") {
      return NextResponse.json(
        { message: "This fiscal year already has a non-editable AIP record." },
        { status: 409 }
      );
    }

    if (!aipId) {
      const { data: created, error: createError } = await client
        .from("aips")
        .insert({
          fiscal_year: fiscalYear,
          barangay_id: null,
          city_id: actor.scope.id,
          municipality_id: null,
          status: "draft",
        })
        .select("id,status")
        .single();

      if (createError || !created) {
        return NextResponse.json(
          { message: createError?.message ?? "Failed to create AIP record." },
          { status: 400 }
        );
      }

      aipId = created.id;
      aipStatus = created.status;
    }

    const { data: canUpload, error: canUploadError } = await client.rpc(
      "can_upload_aip_pdf",
      {
        p_aip_id: aipId,
      }
    );
    if (canUploadError) {
      return NextResponse.json({ message: canUploadError.message }, { status: 400 });
    }
    if (!canUpload) {
      return NextResponse.json(
        { message: "You cannot upload for this AIP right now." },
        { status: 403 }
      );
    }

    const sha256Hex = createHash("sha256").update(fileBuffer).digest("hex");
    const objectName = `${aipId}/${randomUUID()}.pdf`;
    const privilegedActor = toPrivilegedActorContext(actor);

    try {
      await uploadAipPdfObject({
        actor: privilegedActor,
        aipId,
        bucketId: BUCKET_ID,
        objectName,
        fileBuffer,
        contentType: "application/pdf",
      });
    } catch (error) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Failed to upload PDF." },
        { status: 400 }
      );
    }

    const { data: fileRow, error: fileInsertError } = await client
      .from("uploaded_files")
      .insert({
        aip_id: aipId,
        bucket_id: BUCKET_ID,
        object_name: objectName,
        original_file_name: file.name,
        mime_type: "application/pdf",
        size_bytes: file.size,
        sha256_hex: sha256Hex,
        is_current: true,
        uploaded_by: actor.userId,
      })
      .select("id")
      .single();

    if (fileInsertError || !fileRow) {
      await removeAipPdfObject({
        actor: privilegedActor,
        aipId,
        bucketId: BUCKET_ID,
        objectNames: [objectName],
      }).catch(() => undefined);
      return NextResponse.json(
        { message: fileInsertError?.message ?? "Failed to insert upload metadata." },
        { status: 400 }
      );
    }

    let runRow: { id: string; status: string };
    try {
      runRow = await insertExtractionRun({
        actor: privilegedActor,
        aipId,
        uploadedFileId: fileRow.id,
        createdBy: actor.userId,
        modelName: "gpt-5.2",
      });
    } catch (error) {
      return NextResponse.json(
        {
          message:
            error instanceof Error
              ? error.message
              : "Failed to queue extraction run.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        aipId,
        status: runRow.status,
        runId: runRow.id,
        aipStatus,
      },
      { status: 200 }
    );
  } catch (error) {
    if (isInvariantError(error)) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected upload error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
