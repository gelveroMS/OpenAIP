import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/domain/actor-context";

const {
  mockResolveUploaderScopeContext,
  mockFindExistingAipForScope,
  mockIsDuplicateFileHash,
  mockCountRecentRejectedUploadAttempts,
  mockInspectPdf,
  mockExtractPdfTextPreview,
  mockDetectDocumentIdentity,
  mockDetectAipStructure,
  mockEvaluateAipPlausibility,
  mockAssertActorCanManageBarangayAipWorkflow,
  MockPdfInspectError,
} = vi.hoisted(() => {
  type MockPdfDiagnostics = {
    sourceName?: string;
    sourceMessage?: string;
  };

  class HoistedPdfInspectError extends Error {
    readonly reason: "encrypted" | "corrupted" | "timeout";
    readonly sourceName?: string;
    readonly sourceMessage?: string;

    constructor(
      reason: "encrypted" | "corrupted" | "timeout",
      message: string,
      diagnostics: MockPdfDiagnostics = {}
    ) {
      super(message);
      this.reason = reason;
      this.sourceName = diagnostics.sourceName;
      this.sourceMessage = diagnostics.sourceMessage;
    }
  }

  return {
    mockResolveUploaderScopeContext: vi.fn(),
    mockFindExistingAipForScope: vi.fn(),
    mockIsDuplicateFileHash: vi.fn(),
    mockCountRecentRejectedUploadAttempts: vi.fn(),
    mockInspectPdf: vi.fn(),
    mockExtractPdfTextPreview: vi.fn(),
    mockDetectDocumentIdentity: vi.fn(),
    mockDetectAipStructure: vi.fn(),
    mockEvaluateAipPlausibility: vi.fn(),
    mockAssertActorCanManageBarangayAipWorkflow: vi.fn(),
    MockPdfInspectError: HoistedPdfInspectError,
  };
});

vi.mock("@/lib/upload-gating/db", () => ({
  resolveUploaderScopeContext: (...args: unknown[]) =>
    mockResolveUploaderScopeContext(...args),
  findExistingAipForScope: (...args: unknown[]) =>
    mockFindExistingAipForScope(...args),
  isDuplicateFileHash: (...args: unknown[]) => mockIsDuplicateFileHash(...args),
  countRecentRejectedUploadAttempts: (...args: unknown[]) =>
    mockCountRecentRejectedUploadAttempts(...args),
}));

vi.mock("@/lib/upload-gating/pdf/inspect", () => ({
  PdfInspectError: MockPdfInspectError,
  inspectPdf: (...args: unknown[]) => mockInspectPdf(...args),
}));

vi.mock("@/lib/upload-gating/pdf/text", () => ({
  extractPdfTextPreview: (...args: unknown[]) => mockExtractPdfTextPreview(...args),
}));

vi.mock("@/lib/upload-gating/pdf/identity", () => ({
  detectDocumentIdentity: (...args: unknown[]) => mockDetectDocumentIdentity(...args),
}));

vi.mock("@/lib/upload-gating/pdf/structure", () => ({
  detectAipStructure: (...args: unknown[]) => mockDetectAipStructure(...args),
  evaluateAipPlausibility: (...args: unknown[]) =>
    mockEvaluateAipPlausibility(...args),
}));

vi.mock("@/lib/repos/aip/workflow-permissions.server", () => ({
  assertActorCanManageBarangayAipWorkflow: (...args: unknown[]) =>
    mockAssertActorCanManageBarangayAipWorkflow(...args),
}));

import { validateAIPUpload } from "@/lib/upload-gating/validate-upload";

function withArrayBufferSupport(file: File, bytes: Uint8Array): File {
  const target = file as File & {
    arrayBuffer?: () => Promise<ArrayBuffer>;
  };

  if (typeof target.arrayBuffer !== "function") {
    Object.defineProperty(target, "arrayBuffer", {
      configurable: true,
      writable: true,
      value: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer,
    });
  }

  return target;
}

function makePdfFile(input?: {
  name?: string;
  type?: string;
  body?: string;
  sizeBytes?: number;
}): File {
  if (input?.sizeBytes && input.sizeBytes > 0) {
    const bytes = new Uint8Array(input.sizeBytes);
    const file = new File([bytes], input?.name ?? "file.pdf", {
      type: input?.type ?? "application/pdf",
    });
    return withArrayBufferSupport(file, bytes);
  }
  const body = input?.body ?? "%PDF-1.4\nmock";
  const bytes = new TextEncoder().encode(body);
  const file = new File([body], input?.name ?? "file.pdf", {
    type: input?.type ?? "application/pdf",
  });
  return withArrayBufferSupport(file, bytes);
}

const barangayActor: ActorContext = {
  userId: "user-1",
  role: "barangay_official",
  scope: { kind: "barangay", id: "brgy-1" },
};

const cityActor: ActorContext = {
  userId: "user-2",
  role: "city_official",
  scope: { kind: "city", id: "city-1" },
};

function setSuccessMocks(level: "barangay" | "city") {
  mockResolveUploaderScopeContext.mockResolvedValue(
    level === "barangay"
      ? {
          level: "barangay",
          lguId: "brgy-1",
          lguName: "Mamatid",
          parentCityName: "Cabuyao",
        }
      : {
          level: "city",
          lguId: "city-1",
          lguName: "Cabuyao",
          parentCityName: null,
        }
  );
  mockFindExistingAipForScope.mockResolvedValue(null);
  mockIsDuplicateFileHash.mockResolvedValue(false);
  mockCountRecentRejectedUploadAttempts.mockResolvedValue(0);
  mockInspectPdf.mockResolvedValue({ pageCount: 20 });
  mockExtractPdfTextPreview.mockResolvedValue({
    pageCount: 20,
    pages: Array.from({ length: 10 }, (_, index) => ({
      pageNumber: index + 1,
      text: "Annual Investment Program FY 2026 Program/Project/Activity Description",
      nonWhitespaceChars: 220,
    })),
    totalNonWhitespaceChars: 2200,
    textlessPageCount: 0,
  });
  mockDetectDocumentIdentity.mockReturnValue(
    level === "barangay"
      ? {
          isAipDocument: true,
          documentType: "BAIP",
          detectedYear: 2026,
          detectedLGU: "Barangay Mamatid",
          detectedLGULevel: "barangay",
          detectedParentLGU: "City of Cabuyao",
        }
      : {
          isAipDocument: true,
          documentType: "AIP",
          detectedYear: 2026,
          detectedLGU: "City of Cabuyao",
          detectedLGULevel: "city",
          detectedParentLGU: null,
        }
  );
  mockDetectAipStructure.mockReturnValue({
    matchedColumns: [
      "reference_code",
      "description",
      "implementing_agency",
      "start_date",
      "completion_date",
      "expected_output",
      "source_of_funds",
      "budget_amount",
      "total",
    ],
    missingRequiredColumns: [],
    hasRequiredColumns: true,
    hasTableLikeStructure: true,
    projectRowCount: 2,
    refCodeHits: 3,
    dateLikeHits: 4,
    numericHits: 12,
  });
  mockEvaluateAipPlausibility.mockReturnValue({
    ok: true,
    score: 5,
    hasDateLikeValues: true,
    hasNumericBudgetValues: true,
    hasTotalsPattern: true,
    hasReferenceCodePattern: true,
    hasProjectRows: true,
  });
  mockAssertActorCanManageBarangayAipWorkflow.mockResolvedValue(undefined);
}

describe("validateAIPUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSuccessMocks("barangay");
  });

  it("accepts valid barangay upload", async () => {
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.detectedYear).toBe(2026);
    expect(result.data.detectedLGULevel).toBe("barangay");
    expect(mockDetectDocumentIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedScope: "barangay",
        expectedLGUName: "Mamatid",
      })
    );
  });

  it("accepts valid city upload", async () => {
    setSuccessMocks("city");
    const result = await validateAIPUpload({
      actor: cityActor,
      expectedScope: "city",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.detectedLGULevel).toBe("city");
    expect(result.data.detectedLGU).toContain("Cabuyao");
  });

  it("rejects missing file", async () => {
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: null,
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_FILE_REQUIRED" });
  });

  it("rejects invalid extension", async () => {
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile({ name: "file.txt" }),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_INVALID_EXTENSION" });
  });

  it("rejects invalid mime", async () => {
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile({ type: "text/plain" }),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_INVALID_MIME" });
  });

  it("rejects invalid signature", async () => {
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile({ body: "not a pdf" }),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_INVALID_SIGNATURE" });
  });

  it("rejects oversized file", async () => {
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile({ sizeBytes: 26 * 1024 * 1024 }),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_FILE_TOO_LARGE" });
  });

  it("rejects encrypted PDFs", async () => {
    mockInspectPdf.mockRejectedValueOnce(
      new MockPdfInspectError("encrypted", "encrypted")
    );
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_ENCRYPTED_PDF" });
  });

  it("rejects corrupted PDFs", async () => {
    mockInspectPdf.mockRejectedValueOnce(
      new MockPdfInspectError("corrupted", "corrupted", {
        sourceName: "FormatError",
        sourceMessage: "Invalid PDF structure.",
      })
    );
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "UPLOAD_CORRUPTED_PDF",
      details: { stage: "pdf_inspect", reason: "corrupted" },
      logDetails: {
        stage: "pdf_inspect",
        reason: "corrupted",
        pdfErrorName: "FormatError",
      },
    });
  });

  it("rejects inspect timeout as internal validation error", async () => {
    mockInspectPdf.mockRejectedValueOnce(
      new MockPdfInspectError("timeout", "timeout")
    );
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "UPLOAD_INTERNAL_VALIDATION_ERROR",
      details: { stage: "pdf_inspect", reason: "timeout" },
    });
  });

  it("rejects scanned/image-only PDFs", async () => {
    mockExtractPdfTextPreview.mockResolvedValueOnce({
      pageCount: 20,
      pages: Array.from({ length: 8 }, (_, index) => ({
        pageNumber: index + 1,
        text: "",
        nonWhitespaceChars: 0,
      })),
      totalNonWhitespaceChars: 0,
      textlessPageCount: 8,
    });
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "UPLOAD_SCANNED_PDF_NOT_SUPPORTED",
    });
  });

  it("rejects text extraction timeout as internal validation error", async () => {
    mockExtractPdfTextPreview.mockRejectedValueOnce(
      new MockPdfInspectError("timeout", "timeout")
    );
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "UPLOAD_INTERNAL_VALIDATION_ERROR",
      details: { stage: "pdf_text_extract", reason: "timeout" },
    });
  });

  it("maps parser incompatibility to internal validation error", async () => {
    mockInspectPdf.mockRejectedValueOnce(
      new MockPdfInspectError("corrupted", "corrupted", {
        sourceName: "UnknownErrorException",
        sourceMessage: "Unsupported font cmap in embedded TrueType data.",
      })
    );

    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "UPLOAD_INTERNAL_VALIDATION_ERROR",
      details: { stage: "pdf_inspect", reason: "parser_incompatibility" },
      logDetails: {
        stage: "pdf_inspect",
        reason: "parser_incompatibility",
        pdfErrorName: "UnknownErrorException",
      },
    });
  });

  it("maps fake worker resolution failures to internal validation error", async () => {
    mockInspectPdf.mockRejectedValueOnce(
      new MockPdfInspectError("corrupted", "corrupted", {
        sourceName: "Error",
        sourceMessage:
          "Setting up fake worker failed: Cannot find module '.next/dev/server/chunks/pdf.worker.mjs'.",
      })
    );

    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "UPLOAD_INTERNAL_VALIDATION_ERROR",
      details: { stage: "pdf_inspect", reason: "parser_incompatibility" },
    });
  });

  it("returns extended parser diagnostics in debug mode", async () => {
    mockInspectPdf.mockRejectedValueOnce(
      new MockPdfInspectError("corrupted", "corrupted", {
        sourceName: "FormatError",
        sourceMessage: "Invalid PDF structure.",
      })
    );

    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
      debug: true,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "UPLOAD_CORRUPTED_PDF",
      details: {
        stage: "pdf_inspect",
        reason: "corrupted",
        pdfErrorName: "FormatError",
        pdfErrorMessage: "Invalid PDF structure.",
      },
    });
  });

  it("fails with deterministic internal error when binary read is unavailable", async () => {
    const file = new File(["%PDF-1.4\nmock"], "file.pdf", {
      type: "application/pdf",
    }) as File & {
      arrayBuffer?: unknown;
      stream?: unknown;
    };
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(file, "stream", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file,
      selectedYearRaw: "2026",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "UPLOAD_INTERNAL_VALIDATION_ERROR",
      details: { stage: "file_read", reason: "binary_read_unavailable" },
    });
  });

  it("rejects duplicate hash", async () => {
    mockIsDuplicateFileHash.mockResolvedValueOnce(true);
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_DUPLICATE_FILE" });
  });

  it("rejects existing locked state", async () => {
    mockFindExistingAipForScope.mockResolvedValueOnce({
      id: "aip-1",
      status: "pending_review",
    });
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "UPLOAD_NOT_ALLOWED_IN_STATE",
    });
  });

  it("rejects rate-limited user", async () => {
    mockCountRecentRejectedUploadAttempts.mockResolvedValueOnce(999);
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_RATE_LIMITED" });
  });

  it("rejects year mismatch", async () => {
    mockDetectDocumentIdentity.mockReturnValueOnce({
      isAipDocument: true,
      documentType: "BAIP",
      detectedYear: 2025,
      detectedLGU: "Barangay Mamatid",
      detectedLGULevel: "barangay",
      detectedParentLGU: "City of Cabuyao",
    });
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_YEAR_MISMATCH" });
  });

  it("rejects LGU level mismatch", async () => {
    mockDetectDocumentIdentity.mockReturnValueOnce({
      isAipDocument: true,
      documentType: "AIP",
      detectedYear: 2026,
      detectedLGU: "City of Cabuyao",
      detectedLGULevel: "city",
      detectedParentLGU: null,
    });
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "UPLOAD_LGU_LEVEL_MISMATCH",
    });
  });

  it("fails closed as LGU not detected for low-confidence identity extraction", async () => {
    mockDetectDocumentIdentity.mockReturnValueOnce({
      isAipDocument: true,
      documentType: "BAIP",
      detectedYear: 2026,
      detectedLGU: null,
      detectedLGULevel: "barangay",
      detectedParentLGU: null,
      diagnostics: {
        headerSnippets: ["prepared by approved by barangay treasurer"],
        barangayCandidates: [
          {
            name: "Barangay Hall 1",
            score: -3,
            hits: 1,
            pages: [1],
            flags: ["facility_context"],
          },
        ],
        cityCandidates: [],
        levelSignals: {
          barangay: 1,
          city: 0,
        },
        ambiguous: {
          barangay: false,
          city: false,
        },
      },
    });

    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
      debug: true,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "UPLOAD_LGU_NOT_DETECTED",
      details: {
        stage: "identity",
        reason: "lgu_not_detected",
      },
      logDetails: {
        stage: "identity",
        reason: "lgu_not_detected",
      },
    });
  });

  it("rejects LGU identity mismatch", async () => {
    mockDetectDocumentIdentity.mockReturnValueOnce({
      isAipDocument: true,
      documentType: "BAIP",
      detectedYear: 2026,
      detectedLGU: "Barangay Wrong",
      detectedLGULevel: "barangay",
      detectedParentLGU: "City of Cabuyao",
    });
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_LGU_MISMATCH" });
  });

  it("rejects template mismatch", async () => {
    mockDetectAipStructure.mockReturnValueOnce({
      matchedColumns: ["reference_code"],
      missingRequiredColumns: ["description", "total"],
      hasRequiredColumns: false,
      hasTableLikeStructure: false,
      projectRowCount: 0,
      refCodeHits: 0,
      dateLikeHits: 0,
      numericHits: 0,
    });
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "UPLOAD_TEMPLATE_COLUMNS_MISSING",
    });
  });

  it("rejects implausible content", async () => {
    mockEvaluateAipPlausibility.mockReturnValueOnce({
      ok: false,
      score: 1,
      hasDateLikeValues: false,
      hasNumericBudgetValues: false,
      hasTotalsPattern: false,
      hasReferenceCodePattern: false,
      hasProjectRows: true,
    });
    const result = await validateAIPUpload({
      actor: barangayActor,
      expectedScope: "barangay",
      file: makePdfFile(),
      selectedYearRaw: "2026",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "UPLOAD_IMPLAUSIBLE_CONTENT",
    });
  });
});
