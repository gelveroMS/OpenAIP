import "server-only";

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { AipStatus } from "@/lib/contracts/databasev2";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import {
  insertExtractionRun,
  removeAipPdfObject,
  toPrivilegedActorContext,
  uploadAipPdfObject,
} from "@/lib/supabase/privileged-ops";
import { supabaseServer } from "@/lib/supabase/server";
import { UPLOAD_BUCKET_ID } from "./constants";
import { insertUploadValidationLog, resolveUploaderScopeContext } from "./db";
import { validationCodeToHttpStatus } from "./errors";
import { validateAIPUpload } from "./validate-upload";
import type {
  UploadApiFailure,
  UploadApiSuccess,
  ValidationCode,
} from "./types";

type UploadScope = "barangay" | "city";

export type UploadSuccessContext = {
  actorUserId: string;
  aipId: string;
  fiscalYear: number;
  hadExistingAip: boolean;
  aipStatus: AipStatus | null;
  fileName: string;
  scopeId: string;
};

type ProcessScopedUploadOptions = {
  scope: UploadScope;
  onSuccess?: (ctx: UploadSuccessContext) => Promise<void>;
};

function buildFailureResponse(input: {
  code: ValidationCode;
  message: string;
  details?: Record<string, unknown> | null;
  failedCodes?: ValidationCode[];
}): UploadApiFailure {
  return {
    ok: false,
    code: input.code,
    message: input.message,
    details: input.details ?? null,
    failedCodes: input.failedCodes,
  };
}

async function resolveOrCreateAip(input: {
  scope: UploadScope;
  scopeId: string;
  fiscalYear: number;
  existingAip: { id: string; status: AipStatus } | null;
}): Promise<{ aipId: string; aipStatus: AipStatus | null; hadExistingAip: boolean }> {
  if (input.existingAip) {
    return {
      aipId: input.existingAip.id,
      aipStatus: input.existingAip.status,
      hadExistingAip: true,
    };
  }

  const client = await supabaseServer();
  const insertPayload =
    input.scope === "barangay"
      ? {
          fiscal_year: input.fiscalYear,
          barangay_id: input.scopeId,
          city_id: null,
          municipality_id: null,
          status: "draft" as const,
        }
      : {
          fiscal_year: input.fiscalYear,
          barangay_id: null,
          city_id: input.scopeId,
          municipality_id: null,
          status: "draft" as const,
        };

  const { data, error } = await client
    .from("aips")
    .insert(insertPayload)
    .select("id,status")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create AIP record.");
  }

  return {
    aipId: data.id as string,
    aipStatus: data.status as AipStatus,
    hadExistingAip: false,
  };
}

async function safeInsertValidationLog(input: {
  status: "accepted" | "rejected";
  code: ValidationCode | null;
  details: Record<string, unknown>;
  audit: {
    selectedYear: number | null;
    fileHashSha256: string | null;
    fileSizeBytes: number | null;
    originalFileName: string | null;
    sanitizedFileName: string | null;
    detectedYear: number | null;
    detectedLGU: string | null;
    detectedLGULevel: "barangay" | "city" | null;
    pageCount: number | null;
  };
  storagePath?: string | null;
}): Promise<void> {
  try {
    const actor = await getActorContext();
    const scope = actor ? await resolveUploaderScopeContext(actor) : null;
    await insertUploadValidationLog({
      actor,
      scope,
      status: input.status,
      code: input.code,
      details: input.details,
      audit: input.audit,
      storagePath: input.storagePath ?? null,
    });
  } catch (error) {
    console.error("[AIP_UPLOAD][VALIDATION_LOG_FAILED]", {
      status: input.status,
      code: input.code,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function processScopedAipUpload(
  request: Request,
  options: ProcessScopedUploadOptions
): Promise<Response> {
  try {
    const csrf = enforceCsrfProtection(request, { requireToken: true });
    if (!csrf.ok) {
      return csrf.response;
    }

    const actor = await getActorContext();
    const form = await request.formData();
    const fileValue = form.get("file");
    const file = fileValue instanceof File ? fileValue : null;
    const selectedYearRaw = form.get("year");
    const debug =
      new URL(request.url).searchParams.get("debug") === "1" ||
      request.headers.get("x-upload-debug") === "1";

    const validation = await validateAIPUpload({
      actor,
      expectedScope: options.scope,
      file,
      selectedYearRaw,
      debug,
    });

    if (!validation.ok) {
      const validationLogDetails =
        validation.logDetails && Object.keys(validation.logDetails).length > 0
          ? validation.logDetails
          : validation.details ?? {};

      await safeInsertValidationLog({
        status: "rejected",
        code: validation.code,
        details: {
          ...validationLogDetails,
          failedCodes: validation.failedCodes ?? [validation.code],
        },
        audit: validation.audit,
      });
      const failurePayload = buildFailureResponse({
        code: validation.code,
        message: validation.message,
        details: validation.details && Object.keys(validation.details).length > 0
          ? validation.details
          : null,
        failedCodes: validation.failedCodes,
      });
      return NextResponse.json(failurePayload, {
        status: validationCodeToHttpStatus(validation.code),
      });
    }

    if (!actor) {
      const failurePayload = buildFailureResponse({
        code: "UPLOAD_UNAUTHENTICATED",
        message: "You must be signed in to upload a file.",
      });
      return NextResponse.json(failurePayload, { status: 401 });
    }

    const uploaderLevel = validation.data.expectedLGULevel;
    const lguId = validation.data.expectedLGUId;
    const privilegedActor = toPrivilegedActorContext(actor);
    if (!privilegedActor) {
      const failurePayload = buildFailureResponse({
        code: "UPLOAD_INTERNAL_VALIDATION_ERROR",
        message:
          "The upload could not be validated due to a system error. Please try again.",
      });
      return NextResponse.json(failurePayload, { status: 500 });
    }

    const { aipId, aipStatus, hadExistingAip } = await resolveOrCreateAip({
      scope: options.scope,
      scopeId: lguId,
      fiscalYear: validation.data.selectedYear,
      existingAip: validation.data.existingAip,
    });

    const client = await supabaseServer();
    const { data: canUpload, error: canUploadError } = await client.rpc(
      "can_upload_aip_pdf",
      { p_aip_id: aipId }
    );
    if (canUploadError) {
      const failurePayload = buildFailureResponse({
        code: "UPLOAD_INTERNAL_VALIDATION_ERROR",
        message:
          "The upload could not be validated due to a system error. Please try again.",
      });
      return NextResponse.json(failurePayload, { status: 500 });
    }
    if (!canUpload) {
      const failurePayload = buildFailureResponse({
        code: "UPLOAD_NOT_ALLOWED_IN_STATE",
        message:
          "A new upload is not allowed for this LGU and year in the current workflow state.",
      });
      await safeInsertValidationLog({
        status: "rejected",
        code: "UPLOAD_NOT_ALLOWED_IN_STATE",
        details: { aipId },
        audit: validation.audit,
      });
      return NextResponse.json(failurePayload, {
        status: validationCodeToHttpStatus("UPLOAD_NOT_ALLOWED_IN_STATE"),
      });
    }

    const objectName = `accepted/${uploaderLevel}/${lguId}/${
      validation.data.selectedYear
    }/${randomUUID()}.pdf`;

    try {
      await uploadAipPdfObject({
        actor: privilegedActor,
        aipId,
        bucketId: UPLOAD_BUCKET_ID,
        objectName,
        fileBuffer: validation.data.fileBuffer,
        contentType: "application/pdf",
      });
    } catch {
      const failurePayload = buildFailureResponse({
        code: "UPLOAD_INTERNAL_VALIDATION_ERROR",
        message:
          "The upload could not be validated due to a system error. Please try again.",
      });
      return NextResponse.json(failurePayload, { status: 500 });
    }

    const { data: fileRow, error: fileInsertError } = await client
      .from("uploaded_files")
      .insert({
        aip_id: aipId,
        bucket_id: UPLOAD_BUCKET_ID,
        object_name: objectName,
        original_file_name: validation.data.originalFileName,
        mime_type: "application/pdf",
        size_bytes: validation.data.fileSizeBytes,
        sha256_hex: validation.data.fileHashSha256,
        is_current: true,
        uploaded_by: actor.userId,
      })
      .select("id")
      .single();

    if (fileInsertError || !fileRow) {
      await removeAipPdfObject({
        actor: privilegedActor,
        aipId,
        bucketId: UPLOAD_BUCKET_ID,
        objectNames: [objectName],
      }).catch(() => undefined);
      const failurePayload = buildFailureResponse({
        code: "UPLOAD_INTERNAL_VALIDATION_ERROR",
        message:
          "The upload could not be validated due to a system error. Please try again.",
      });
      return NextResponse.json(failurePayload, { status: 500 });
    }

    let runRow: { id: string; status: string } | null = null;
    try {
      runRow = await insertExtractionRun({
        actor: privilegedActor,
        aipId,
        uploadedFileId: fileRow.id as string,
        createdBy: actor.userId,
        modelName: "gpt-5.2",
      });
    } catch {
      await removeAipPdfObject({
        actor: privilegedActor,
        aipId,
        bucketId: UPLOAD_BUCKET_ID,
        objectNames: [objectName],
      }).catch(() => undefined);
      try {
        await client
          .from("uploaded_files")
          .delete()
          .eq("id", fileRow.id as string);
      } catch {
        // best-effort cleanup
      }
      const failurePayload = buildFailureResponse({
        code: "UPLOAD_INTERNAL_VALIDATION_ERROR",
        message:
          "The upload could not be validated due to a system error. Please try again.",
      });
      return NextResponse.json(failurePayload, { status: 500 });
    }

    await safeInsertValidationLog({
      status: "accepted",
      code: null,
      details: {
        aipId,
        uploadId: fileRow.id,
        runId: runRow.id,
      },
      audit: validation.audit,
      storagePath: objectName,
    });

    if (options.onSuccess) {
      await options.onSuccess({
        actorUserId: actor.userId,
        aipId,
        fiscalYear: validation.data.selectedYear,
        hadExistingAip,
        aipStatus,
        fileName: validation.data.originalFileName,
        scopeId: lguId,
      });
    }

    const payload: UploadApiSuccess = {
      ok: true,
      message: "Upload accepted.",
      data: {
        uploadId: fileRow.id as string,
        aipId,
        runId: runRow.id,
        status: runRow.status,
        detectedYear: validation.data.detectedYear,
        detectedLGU: validation.data.detectedLGU,
        detectedLGULevel: validation.data.detectedLGULevel,
        pageCount: validation.data.pageCount,
      },
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("[AIP_UPLOAD][UNHANDLED]", {
      scope: options.scope,
      error: error instanceof Error ? error.message : String(error),
    });
    const payload = buildFailureResponse({
      code: "UPLOAD_INTERNAL_VALIDATION_ERROR",
      message:
        "The upload could not be validated due to a system error. Please try again.",
    });
    return NextResponse.json(payload, { status: 500 });
  }
}
