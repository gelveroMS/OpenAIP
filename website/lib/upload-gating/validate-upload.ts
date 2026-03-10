import "server-only";

import { Buffer } from "node:buffer";
import { createHash } from "crypto";
import { assertActorCanManageBarangayAipWorkflow } from "@/lib/repos/aip/workflow-permissions.server";
import {
  IDENTITY_SCAN_PAGES,
  MAX_FISCAL_YEAR,
  MAX_TEXTLESS_PAGES_ALLOWED,
  MAX_UPLOAD_PAGES,
  MAX_UPLOAD_SIZE_BYTES,
  MIN_EXTRACTED_TEXT_CHARS,
  MIN_FISCAL_YEAR,
  MIN_REQUIRED_COLUMN_MATCHES,
  PDF_PARSE_TIMEOUT_MS,
  STRUCTURE_SCAN_PAGES,
  TEXT_SCAN_PAGES,
  UPLOAD_RATE_LIMIT_MAX_ATTEMPTS,
  UPLOAD_RATE_LIMIT_WINDOW_MINUTES,
} from "./constants";
import {
  countRecentRejectedUploadAttempts,
  findExistingAipForScope,
  isDuplicateFileHash,
  resolveUploaderScopeContext,
} from "./db";
import { toValidationFailure } from "./errors";
import {
  compareLGUIdentity,
  compareLGULevel,
  normalizeLGULevel,
} from "./normalize";
import { detectDocumentIdentity } from "./pdf/identity";
import { inspectPdf, PdfInspectError } from "./pdf/inspect";
import {
  hasPdfExtension,
  hasPdfMagicBytes,
  hasStrictPdfMime,
  sanitizeFileName,
} from "./pdf/signature";
import { detectAipStructure, evaluateAipPlausibility } from "./pdf/structure";
import { extractPdfTextPreview } from "./pdf/text";
import type {
  UploadGateResult,
  UploadValidationAuditContext,
  ValidateAIPUploadInput,
  ValidationCode,
} from "./types";

const MIN_SUBSTANTIAL_TEXT_CHARS = 120;
type UploadStage = "file_read" | "pdf_inspect" | "pdf_text_extract";
const PARSER_INCOMPATIBILITY_PATTERNS: RegExp[] = [
  /\bunsupported\b/i,
  /\bunknown font\b/i,
  /\bcmap\b/i,
  /\bglyph\b/i,
  /\btruetype\b/i,
  /\bopentype\b/i,
  /\btt:\b/i,
  /\bstandardfontdataurl\b/i,
  /\bfake worker failed\b/i,
  /\bpdf\.worker\.mjs\b/i,
  /\bcannot find module\b/i,
];

class FileReadError extends Error {
  readonly reason: "binary_read_unavailable" | "binary_read_failed";

  constructor(reason: "binary_read_unavailable" | "binary_read_failed", message: string) {
    super(message);
    this.reason = reason;
  }
}

function parseSelectedYear(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const year = Number.parseInt(value, 10);
  if (!Number.isInteger(year)) return null;
  return year;
}

async function readFileBuffer(file: File): Promise<Buffer> {
  const maybeArrayBuffer = (file as File & {
    arrayBuffer?: () => Promise<ArrayBuffer>;
  }).arrayBuffer;
  if (typeof maybeArrayBuffer === "function") {
    try {
      return Buffer.from(await maybeArrayBuffer.call(file));
    } catch (error) {
      throw new FileReadError(
        "binary_read_failed",
        error instanceof Error ? error.message : "Failed to read file arrayBuffer."
      );
    }
  }

  const maybeStream = (file as File & {
    stream?: () => ReadableStream<Uint8Array>;
  }).stream;

  if (typeof maybeStream === "function") {
    const stream = maybeStream.call(file);
    if (!stream || typeof stream.getReader !== "function") {
      throw new FileReadError(
        "binary_read_failed",
        "File stream is not readable."
      );
    }
    try {
      const reader = stream.getReader();
      const chunks: Buffer[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(Buffer.from(value));
        }
      }
      return Buffer.concat(chunks);
    } catch (error) {
      throw new FileReadError(
        "binary_read_failed",
        error instanceof Error ? error.message : "Failed to read file stream."
      );
    }
  }

  throw new FileReadError(
    "binary_read_unavailable",
    "No binary file read method is available."
  );
}

function isLikelyParserIncompatibility(
  sourceName?: string,
  sourceMessage?: string
): boolean {
  if (!sourceName && !sourceMessage) return false;
  if (sourceName && /PasswordException/i.test(sourceName)) return false;
  const haystack = `${sourceName ?? ""} ${sourceMessage ?? ""}`.trim();
  return PARSER_INCOMPATIBILITY_PATTERNS.some((pattern) => pattern.test(haystack));
}

function buildPdfFailureDiagnosticDetails(input: {
  stage: Extract<UploadStage, "pdf_inspect" | "pdf_text_extract">;
  reason: string;
  audit: UploadValidationAuditContext;
  timeoutMs?: number;
  pdfErrorName?: string;
  pdfErrorMessage?: string;
}): Record<string, unknown> {
  return {
    stage: input.stage,
    reason: input.reason,
    timeoutMs: input.timeoutMs,
    pdfErrorName: input.pdfErrorName ?? null,
    pdfErrorMessage: input.pdfErrorMessage ?? null,
    fileHashSha256: input.audit.fileHashSha256,
    fileSizeBytes: input.audit.fileSizeBytes,
    fileName: input.audit.originalFileName,
  };
}

function buildIdentityDiagnosticDetails(input: {
  reason: string;
  diagnostics: ReturnType<typeof detectDocumentIdentity>["diagnostics"] | null;
}): Record<string, unknown> {
  return {
    stage: "identity",
    reason: input.reason,
    diagnostics: input.diagnostics,
  };
}

export async function validateAIPUpload(
  input: ValidateAIPUploadInput
): Promise<UploadGateResult> {
  const failedCodes: ValidationCode[] = [];
  const debug = input.debug === true;
  const audit: UploadValidationAuditContext = {
    selectedYear: null,
    fileHashSha256: null,
    fileSizeBytes: null,
    originalFileName: null,
    sanitizedFileName: null,
    detectedYear: null,
    detectedLGU: null,
    detectedLGULevel: null,
    pageCount: null,
  };

  const fail = (
    code: ValidationCode,
    details: Record<string, unknown> = {},
    options?: { logDetails?: Record<string, unknown> }
  ): UploadGateResult => {
    failedCodes.push(code);
    return toValidationFailure({
      code,
      details,
      logDetails: options?.logDetails,
      failedCodes: debug ? [...failedCodes] : undefined,
      audit,
    });
  };

  const handlePdfFailure = (
    error: unknown,
    stage: Extract<UploadStage, "pdf_inspect" | "pdf_text_extract">
  ): UploadGateResult => {
    if (error instanceof PdfInspectError) {
      const details = buildPdfFailureDiagnosticDetails({
        stage,
        reason: error.reason,
        timeoutMs: error.reason === "timeout" ? PDF_PARSE_TIMEOUT_MS : undefined,
        pdfErrorName: error.sourceName,
        pdfErrorMessage: error.sourceMessage,
        audit,
      });
      const publicDetails = debug ? details : { stage, reason: error.reason };

      if (error.reason === "encrypted") {
        return fail("UPLOAD_ENCRYPTED_PDF", publicDetails, {
          logDetails: details,
        });
      }
      if (error.reason === "corrupted") {
        if (
          isLikelyParserIncompatibility(error.sourceName, error.sourceMessage)
        ) {
          const incompatibilityDetails = {
            ...details,
            reason: "parser_incompatibility",
          };
          return fail(
            "UPLOAD_INTERNAL_VALIDATION_ERROR",
            debug
              ? incompatibilityDetails
              : { stage, reason: "parser_incompatibility" },
            { logDetails: incompatibilityDetails }
          );
        }
        return fail("UPLOAD_CORRUPTED_PDF", publicDetails, {
          logDetails: details,
        });
      }
      if (error.reason === "timeout") {
        return fail("UPLOAD_INTERNAL_VALIDATION_ERROR", publicDetails, {
          logDetails: details,
        });
      }
    }
    const details = buildPdfFailureDiagnosticDetails({
      stage,
      reason: "unexpected_pdf_error",
      audit,
    });
    return fail(
      "UPLOAD_INTERNAL_VALIDATION_ERROR",
      debug ? details : { stage, reason: "unexpected_pdf_error" },
      { logDetails: details }
    );
  };

  try {
    // Gate 1: auth/scope/year
    if (!input.actor) {
      return fail("UPLOAD_UNAUTHENTICATED");
    }

    if (
      (input.expectedScope === "barangay" &&
        input.actor.role !== "barangay_official") ||
      (input.expectedScope === "city" && input.actor.role !== "city_official")
    ) {
      return fail("UPLOAD_FORBIDDEN_ROLE", {
        role: input.actor.role,
        expectedScope: input.expectedScope,
      });
    }

    if (!input.actor.scope.id) {
      return fail("UPLOAD_NO_LGU_SCOPE");
    }

    const uploaderLevel = normalizeLGULevel(input.actor.scope.kind);
    if (!uploaderLevel) {
      return fail("UPLOAD_INVALID_UPLOADER_SCOPE");
    }

    if (uploaderLevel !== input.expectedScope) {
      return fail("UPLOAD_INVALID_UPLOADER_SCOPE", {
        actorScope: input.actor.scope.kind,
        expectedScope: input.expectedScope,
      });
    }

    const selectedYear = parseSelectedYear(input.selectedYearRaw);
    if (
      !selectedYear ||
      selectedYear < MIN_FISCAL_YEAR ||
      selectedYear > MAX_FISCAL_YEAR
    ) {
      return fail("UPLOAD_INVALID_YEAR", {
        selectedYearRaw:
          typeof input.selectedYearRaw === "string" ? input.selectedYearRaw : null,
        minYear: MIN_FISCAL_YEAR,
        maxYear: MAX_FISCAL_YEAR,
      });
    }
    audit.selectedYear = selectedYear;

    const uploaderScope = await resolveUploaderScopeContext(input.actor);
    if (!uploaderScope || uploaderScope.level !== uploaderLevel) {
      return fail("UPLOAD_INVALID_UPLOADER_SCOPE");
    }

    // Gate 0: file/transport validation
    if (!(input.file instanceof File)) {
      return fail("UPLOAD_FILE_REQUIRED");
    }

    audit.originalFileName = input.file.name ?? null;
    audit.fileSizeBytes = input.file.size ?? null;
    audit.sanitizedFileName = sanitizeFileName(input.file.name);

    if (!hasPdfExtension(input.file.name)) {
      return fail("UPLOAD_INVALID_EXTENSION");
    }

    if (!hasStrictPdfMime(input.file.type)) {
      return fail("UPLOAD_INVALID_MIME", { mimeType: input.file.type || null });
    }

    if (input.file.size > MAX_UPLOAD_SIZE_BYTES) {
      return fail("UPLOAD_FILE_TOO_LARGE", {
        fileSizeBytes: input.file.size,
        maxUploadSizeBytes: MAX_UPLOAD_SIZE_BYTES,
      });
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readFileBuffer(input.file);
    } catch (error) {
      if (error instanceof FileReadError) {
        const details = {
          stage: "file_read",
          reason: error.reason,
          fileHashSha256: audit.fileHashSha256,
          fileSizeBytes: audit.fileSizeBytes,
          fileName: audit.originalFileName,
        };
        return fail(
          "UPLOAD_INTERNAL_VALIDATION_ERROR",
          debug ? details : { stage: "file_read", reason: error.reason },
          { logDetails: details }
        );
      }
      const details = {
        stage: "file_read",
        reason: "binary_read_failed",
        fileHashSha256: audit.fileHashSha256,
        fileSizeBytes: audit.fileSizeBytes,
        fileName: audit.originalFileName,
      };
      return fail(
        "UPLOAD_INTERNAL_VALIDATION_ERROR",
        debug ? details : { stage: "file_read", reason: "binary_read_failed" },
        { logDetails: details }
      );
    }

    if (!hasPdfMagicBytes(fileBuffer)) {
      return fail("UPLOAD_INVALID_SIGNATURE");
    }

    // Gate 3: hash early
    const fileHashSha256 = createHash("sha256").update(fileBuffer).digest("hex");
    audit.fileHashSha256 = fileHashSha256;

    // Gate 4: duplicate/workflow/rate
    const duplicateHash = await isDuplicateFileHash(fileHashSha256);
    if (duplicateHash) {
      return fail("UPLOAD_DUPLICATE_FILE", { fileHashSha256 });
    }

    const existingAip = await findExistingAipForScope({
      lguLevel: uploaderScope.level,
      lguId: uploaderScope.lguId,
      selectedYear,
    });
    if (existingAip) {
      if (existingAip.status === "published") {
        return fail("UPLOAD_AIP_ALREADY_EXISTS", {
          aipId: existingAip.id,
          aipStatus: existingAip.status,
        });
      }
      if (
        existingAip.status !== "draft" &&
        existingAip.status !== "for_revision"
      ) {
        return fail("UPLOAD_NOT_ALLOWED_IN_STATE", {
          aipId: existingAip.id,
          aipStatus: existingAip.status,
        });
      }
      if (uploaderScope.level === "barangay") {
        try {
          await assertActorCanManageBarangayAipWorkflow({
            aipId: existingAip.id,
            actor: input.actor,
          });
        } catch (error) {
          return fail("UPLOAD_NOT_ALLOWED_IN_STATE", {
            aipId: existingAip.id,
            aipStatus: existingAip.status,
            reason: error instanceof Error ? error.message : "workflow_lock",
          });
        }
      }
    }

    const rateWindowStart = new Date(
      Date.now() - UPLOAD_RATE_LIMIT_WINDOW_MINUTES * 60_000
    ).toISOString();
    const rejectedAttempts = await countRecentRejectedUploadAttempts({
      userId: input.actor.userId,
      createdAtGteIso: rateWindowStart,
    });
    if (rejectedAttempts >= UPLOAD_RATE_LIMIT_MAX_ATTEMPTS) {
      return fail("UPLOAD_RATE_LIMITED", {
        rejectedAttempts,
        maxAttempts: UPLOAD_RATE_LIMIT_MAX_ATTEMPTS,
        windowMinutes: UPLOAD_RATE_LIMIT_WINDOW_MINUTES,
      });
    }

    // Gate 5: parseability + metadata
    let inspect;
    try {
      inspect = await inspectPdf({
        fileBuffer,
        timeoutMs: PDF_PARSE_TIMEOUT_MS,
      });
    } catch (error) {
      return handlePdfFailure(error, "pdf_inspect");
    }
    audit.pageCount = inspect.pageCount;
    if (inspect.pageCount > MAX_UPLOAD_PAGES) {
      return fail("UPLOAD_TOO_MANY_PAGES", {
        pageCount: inspect.pageCount,
        maxPages: MAX_UPLOAD_PAGES,
      });
    }

    // Gate 6: native PDF/text gate
    let textPreview;
    try {
      textPreview = await extractPdfTextPreview({
        fileBuffer,
        maxPages: Math.max(TEXT_SCAN_PAGES, STRUCTURE_SCAN_PAGES),
        timeoutMs: PDF_PARSE_TIMEOUT_MS,
      });
    } catch (error) {
      return handlePdfFailure(error, "pdf_text_extract");
    }

    const firstTextPages = textPreview.pages.slice(0, TEXT_SCAN_PAGES);
    const firstTextTotalChars = firstTextPages.reduce(
      (sum, page) => sum + page.nonWhitespaceChars,
      0
    );
    const firstTextlessPages = firstTextPages.filter(
      (page) => page.nonWhitespaceChars === 0
    ).length;
    const hasSubstantialTextPage = firstTextPages.some(
      (page) => page.nonWhitespaceChars >= MIN_SUBSTANTIAL_TEXT_CHARS
    );

    if (
      firstTextPages.length === 0 ||
      firstTextTotalChars < MIN_EXTRACTED_TEXT_CHARS ||
      firstTextlessPages > MAX_TEXTLESS_PAGES_ALLOWED ||
      !hasSubstantialTextPage
    ) {
      return fail("UPLOAD_SCANNED_PDF_NOT_SUPPORTED", {
        textChars: firstTextTotalChars,
        textlessPages: firstTextlessPages,
        scannedPagesChecked: firstTextPages.length,
      });
    }

    // Gate 7: document identity
    const identity = detectDocumentIdentity({
      pages: textPreview.pages
        .slice(0, IDENTITY_SCAN_PAGES)
        .map((page) => page.text),
      expectedScope: uploaderScope.level,
      expectedLGUName: uploaderScope.lguName,
    });
    if (!identity.isAipDocument) {
      return fail("UPLOAD_NOT_AIP_DOCUMENT");
    }
    if (!identity.detectedYear) {
      return fail("UPLOAD_YEAR_NOT_DETECTED");
    }
    audit.detectedYear = identity.detectedYear;
    if (identity.detectedYear !== selectedYear) {
      return fail("UPLOAD_YEAR_MISMATCH", {
        selectedYear,
        detectedYear: identity.detectedYear,
      });
    }
    const identityDiagnostics = identity.diagnostics ?? null;
    if (!identity.detectedLGU) {
      const details = buildIdentityDiagnosticDetails({
        reason: "lgu_not_detected",
        diagnostics: identityDiagnostics,
      });
      return fail(
        "UPLOAD_LGU_NOT_DETECTED",
        debug ? details : {},
        { logDetails: details }
      );
    }
    audit.detectedLGU = identity.detectedLGU;
    if (!identity.detectedLGULevel) {
      const details = buildIdentityDiagnosticDetails({
        reason: "lgu_level_not_detected",
        diagnostics: identityDiagnostics,
      });
      return fail(
        "UPLOAD_LGU_LEVEL_NOT_DETECTED",
        debug ? details : {},
        { logDetails: details }
      );
    }
    audit.detectedLGULevel = identity.detectedLGULevel;
    if (!compareLGULevel(identity.detectedLGULevel, uploaderScope.level)) {
      const details = {
        uploaderLGULevel: uploaderScope.level,
        detectedLGULevel: identity.detectedLGULevel,
        diagnostics: identityDiagnostics,
      };
      return fail(
        "UPLOAD_LGU_LEVEL_MISMATCH",
        debug
          ? details
          : {
              uploaderLGULevel: uploaderScope.level,
              detectedLGULevel: identity.detectedLGULevel,
            },
        { logDetails: details }
      );
    }
    if (!compareLGUIdentity(identity.detectedLGU, uploaderScope.lguName)) {
      const details = {
        expectedLGU: uploaderScope.lguName,
        detectedLGU: identity.detectedLGU,
        diagnostics: identityDiagnostics,
      };
      return fail(
        "UPLOAD_LGU_MISMATCH",
        debug
          ? details
          : {
              expectedLGU: uploaderScope.lguName,
              detectedLGU: identity.detectedLGU,
            },
        { logDetails: details }
      );
    }
    if (
      uploaderScope.level === "barangay" &&
      identity.detectedParentLGU &&
      uploaderScope.parentCityName &&
      !compareLGUIdentity(identity.detectedParentLGU, uploaderScope.parentCityName)
    ) {
      const details = {
        expectedParentLGU: uploaderScope.parentCityName,
        detectedParentLGU: identity.detectedParentLGU,
        diagnostics: identityDiagnostics,
      };
      return fail(
        "UPLOAD_LGU_MISMATCH",
        debug
          ? details
          : {
              expectedParentLGU: uploaderScope.parentCityName,
              detectedParentLGU: identity.detectedParentLGU,
            },
        { logDetails: details }
      );
    }

    // Gate 8: structure
    const structure = detectAipStructure({
      pages: textPreview.pages
        .slice(0, STRUCTURE_SCAN_PAGES)
        .map((page) => page.text),
      minRequiredColumnMatches: MIN_REQUIRED_COLUMN_MATCHES,
    });
    if (!structure.hasRequiredColumns || !structure.hasTableLikeStructure) {
      return fail("UPLOAD_TEMPLATE_COLUMNS_MISSING", {
        matchedColumns: structure.matchedColumns,
        missingRequiredColumns: structure.missingRequiredColumns,
        minRequiredColumnMatches: MIN_REQUIRED_COLUMN_MATCHES,
      });
    }
    if (structure.projectRowCount < 1) {
      return fail("UPLOAD_NO_PROJECT_ROWS", {
        projectRowCount: structure.projectRowCount,
      });
    }

    // Gate 9: plausibility
    const plausibility = evaluateAipPlausibility({
      pages: textPreview.pages
        .slice(0, STRUCTURE_SCAN_PAGES)
        .map((page) => page.text),
      structure,
    });
    if (!plausibility.ok) {
      return fail("UPLOAD_IMPLAUSIBLE_CONTENT", {
        plausibility,
      });
    }

    return {
      ok: true,
      message: "Upload accepted.",
      data: {
        fileBuffer,
        originalFileName: input.file.name,
        sanitizedFileName: audit.sanitizedFileName ?? "upload.pdf",
        fileSizeBytes: input.file.size,
        fileHashSha256,
        selectedYear,
        expectedLGULevel: uploaderScope.level,
        expectedLGUId: uploaderScope.lguId,
        expectedLGUName: uploaderScope.lguName,
        detectedYear: identity.detectedYear,
        detectedLGU: identity.detectedLGU,
        detectedLGULevel: identity.detectedLGULevel,
        detectedParentLGU: identity.detectedParentLGU,
        pageCount: inspect.pageCount,
        isNativePdf: true,
        matchedColumns: structure.matchedColumns,
        existingAip,
      },
      audit,
    };
  } catch (error) {
    const details =
      error instanceof Error ? { error: error.message } : { error: String(error) };
    return fail("UPLOAD_INTERNAL_VALIDATION_ERROR", details);
  }
}
