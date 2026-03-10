import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/domain/actor-context";

const mockGetActorContext = vi.fn();
const mockValidateAIPUpload = vi.fn();
const mockSupabaseServer = vi.fn();
const mockUploadAipPdfObject = vi.fn();
const mockInsertExtractionRun = vi.fn();
const mockRemoveAipPdfObject = vi.fn();
const mockResolveUploaderScopeContext = vi.fn();
const mockInsertUploadValidationLog = vi.fn();

vi.mock("@/lib/domain/get-actor-context", () => ({
  getActorContext: () => mockGetActorContext(),
}));

vi.mock("@/lib/security/csrf", () => ({
  enforceCsrfProtection: () => ({ ok: true }),
}));

vi.mock("@/lib/upload-gating/validate-upload", () => ({
  validateAIPUpload: (...args: unknown[]) => mockValidateAIPUpload(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

vi.mock("@/lib/supabase/privileged-ops", () => ({
  uploadAipPdfObject: (...args: unknown[]) => mockUploadAipPdfObject(...args),
  insertExtractionRun: (...args: unknown[]) => mockInsertExtractionRun(...args),
  removeAipPdfObject: (...args: unknown[]) => mockRemoveAipPdfObject(...args),
  toPrivilegedActorContext: (actor: ActorContext | null) =>
    actor
      ? {
          role: actor.role,
          user_id: actor.userId,
          lgu_id: actor.scope.id ?? null,
          lgu_scope: actor.scope.kind === "city" ? "city" : "barangay",
        }
      : null,
}));

vi.mock("@/lib/upload-gating/db", () => ({
  resolveUploaderScopeContext: (...args: unknown[]) =>
    mockResolveUploaderScopeContext(...args),
  insertUploadValidationLog: (...args: unknown[]) =>
    mockInsertUploadValidationLog(...args),
}));

import { processScopedAipUpload } from "@/lib/upload-gating/server-upload";

const cityActor: ActorContext = {
  userId: "user-1",
  role: "city_official",
  scope: { kind: "city", id: "city-1" },
};

function buildRequest() {
  const form = new FormData();
  form.append("file", new File(["%PDF-1.4\nmock"], "aip.pdf", { type: "application/pdf" }));
  form.append("year", "2026");
  return {
    url: "http://localhost/api/city/aips/upload",
    headers: new Headers({ origin: "http://localhost" }),
    formData: async () => form,
  } as unknown as Request;
}

function createSupabaseClientStub() {
  return {
    rpc: vi.fn(async (fn: string) => {
      if (fn === "can_upload_aip_pdf") {
        return { data: true, error: null };
      }
      return { data: null, error: null };
    }),
    from: (table: string) => {
      if (table === "uploaded_files") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: "upload-1" }, error: null }),
            }),
          }),
          delete: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "aips") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: "aip-1", status: "draft" }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe("processScopedAipUpload integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActorContext.mockResolvedValue(cityActor);
    mockResolveUploaderScopeContext.mockResolvedValue({
      level: "city",
      lguId: "city-1",
      lguName: "Cabuyao",
      parentCityName: null,
    });
    mockSupabaseServer.mockResolvedValue(createSupabaseClientStub());
    mockUploadAipPdfObject.mockResolvedValue(undefined);
    mockInsertExtractionRun.mockResolvedValue({ id: "run-1", status: "queued" });
    mockRemoveAipPdfObject.mockResolvedValue(undefined);
    mockInsertUploadValidationLog.mockResolvedValue(undefined);
  });

  it("stops early on rejected validation and does not enqueue pipeline work", async () => {
    mockValidateAIPUpload.mockResolvedValueOnce({
      ok: false,
      code: "UPLOAD_INVALID_SIGNATURE",
      message: "The uploaded file is not a valid PDF.",
      details: null,
      failedCodes: ["UPLOAD_INVALID_SIGNATURE"],
      audit: {
        selectedYear: 2026,
        fileHashSha256: null,
        fileSizeBytes: 12,
        originalFileName: "aip.pdf",
        sanitizedFileName: "aip.pdf",
        detectedYear: null,
        detectedLGU: null,
        detectedLGULevel: null,
        pageCount: null,
      },
    });

    const response = await processScopedAipUpload(buildRequest(), { scope: "city" });
    const payload = (await response.json()) as {
      ok: boolean;
      code?: string;
    };

    expect(response.status).toBe(422);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("UPLOAD_INVALID_SIGNATURE");
    expect(mockUploadAipPdfObject).not.toHaveBeenCalled();
    expect(mockInsertExtractionRun).not.toHaveBeenCalled();
    expect(mockInsertUploadValidationLog).toHaveBeenCalled();
  });

  it("admits validated upload and creates uploaded_files + extraction_runs", async () => {
    mockValidateAIPUpload.mockResolvedValueOnce({
      ok: true,
      message: "Upload accepted.",
      data: {
        fileBuffer: Buffer.from("%PDF-1.4\nmock", "utf8"),
        originalFileName: "aip.pdf",
        sanitizedFileName: "aip.pdf",
        fileSizeBytes: 12,
        fileHashSha256:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        selectedYear: 2026,
        expectedLGULevel: "city",
        expectedLGUId: "city-1",
        expectedLGUName: "Cabuyao",
        detectedYear: 2026,
        detectedLGU: "City of Cabuyao",
        detectedLGULevel: "city",
        detectedParentLGU: null,
        pageCount: 101,
        isNativePdf: true,
        matchedColumns: ["reference_code", "description", "total"],
        existingAip: { id: "aip-1", status: "draft" },
      },
      audit: {
        selectedYear: 2026,
        fileHashSha256:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        fileSizeBytes: 12,
        originalFileName: "aip.pdf",
        sanitizedFileName: "aip.pdf",
        detectedYear: 2026,
        detectedLGU: "City of Cabuyao",
        detectedLGULevel: "city",
        pageCount: 101,
      },
    });

    const response = await processScopedAipUpload(buildRequest(), { scope: "city" });
    const payload = (await response.json()) as {
      ok: boolean;
      data?: { uploadId?: string; runId?: string; aipId?: string };
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data?.uploadId).toBe("upload-1");
    expect(payload.data?.runId).toBe("run-1");
    expect(payload.data?.aipId).toBe("aip-1");
    expect(mockUploadAipPdfObject).toHaveBeenCalledTimes(1);
    expect(mockInsertExtractionRun).toHaveBeenCalledTimes(1);
    expect(mockInsertUploadValidationLog).toHaveBeenCalled();
  });
});
