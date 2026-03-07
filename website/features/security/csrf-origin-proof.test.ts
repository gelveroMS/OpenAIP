import { beforeEach, describe, expect, it, vi } from "vitest";
import { enforceCsrfProtection } from "@/lib/security/csrf";

const mockGetActorContext = vi.fn();
const mockSupabaseServer = vi.fn();
const mockInsertExtractionRun = vi.fn();
const mockToPrivilegedActorContext = vi.fn();

vi.mock("@/lib/domain/get-actor-context", () => ({
  getActorContext: () => mockGetActorContext(),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

vi.mock("@/lib/supabase/privileged-ops", () => ({
  insertExtractionRun: (...args: unknown[]) => mockInsertExtractionRun(...args),
  toPrivilegedActorContext: (...args: unknown[]) => mockToPrivilegedActorContext(...args),
}));

function createSupabaseClient() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: "run-old",
              aip_id: "aip-001",
              uploaded_file_id: "file-001",
              stage: "validate",
              status: "failed",
            },
            error: null,
          }),
        }),
      }),
    }),
    rpc: async () => ({ data: true, error: null }),
  };
}

describe("CSRF origin proof for POST /api/barangay/aips/runs/[runId]/retry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost";
    process.env.NEXT_PUBLIC_STAGING_URL = "";
    process.env.BASE_URL = "http://localhost:3000";

    mockGetActorContext.mockResolvedValue({
      userId: "user-1",
      role: "barangay_official",
      scope: {
        kind: "barangay",
        id: "brgy-1",
      },
    });
    mockSupabaseServer.mockResolvedValue(createSupabaseClient());
    mockToPrivilegedActorContext.mockReturnValue({ userId: "user-1" });
    mockInsertExtractionRun.mockResolvedValue({
      id: "run-new",
      status: "queued",
    });
  });

  it("returns 403 for bad Origin", async () => {
    const { POST } = await import("@/app/api/barangay/aips/runs/[runId]/retry/route");
    const response = await POST(
      new Request("http://localhost/api/barangay/aips/runs/run-old/retry", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          cookie: "csrf_token=test-token",
          "x-csrf-token": "test-token",
        },
      }),
      { params: Promise.resolve({ runId: "run-old" }) }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ message: "Forbidden." });
  });

  it("succeeds for allowed Origin with valid double-submit token", async () => {
    const { POST } = await import("@/app/api/barangay/aips/runs/[runId]/retry/route");
    const response = await POST(
      new Request("http://localhost/api/barangay/aips/runs/run-old/retry", {
        method: "POST",
        headers: {
          origin: "http://localhost",
          cookie: "csrf_token=test-token",
          "x-csrf-token": "test-token",
        },
      }),
      { params: Promise.resolve({ runId: "run-old" }) }
    );

    expect(response.status).toBe(200);
    expect(mockInsertExtractionRun).toHaveBeenCalledTimes(1);
    expect(mockInsertExtractionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        aipId: "aip-001",
        uploadedFileId: "file-001",
        retryOfRunId: "run-old",
        resumeFromStage: "validate",
      })
    );
  });

  it("supports scratch retry mode and forces resumeFromStage extract", async () => {
    const { POST } = await import("@/app/api/barangay/aips/runs/[runId]/retry/route");
    const response = await POST(
      new Request("http://localhost/api/barangay/aips/runs/run-old/retry", {
        method: "POST",
        headers: {
          origin: "http://localhost",
          cookie: "csrf_token=test-token",
          "x-csrf-token": "test-token",
        },
        body: JSON.stringify({ retryMode: "scratch" }),
      }),
      { params: Promise.resolve({ runId: "run-old" }) }
    );

    expect(response.status).toBe(200);
    expect(mockInsertExtractionRun).toHaveBeenCalledTimes(1);
    expect(mockInsertExtractionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        aipId: "aip-001",
        uploadedFileId: "file-001",
        retryOfRunId: "run-old",
        resumeFromStage: "extract",
      })
    );
  });

  it("returns 400 for invalid retry mode", async () => {
    const { POST } = await import("@/app/api/barangay/aips/runs/[runId]/retry/route");
    const response = await POST(
      new Request("http://localhost/api/barangay/aips/runs/run-old/retry", {
        method: "POST",
        headers: {
          origin: "http://localhost",
          cookie: "csrf_token=test-token",
          "x-csrf-token": "test-token",
        },
        body: JSON.stringify({ retryMode: "bogus" }),
      }),
      { params: Promise.resolve({ runId: "run-old" }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "Invalid retry mode. Use 'scratch' or 'failed_stage'.",
    });
    expect(mockInsertExtractionRun).not.toHaveBeenCalled();
  });
});

describe("CSRF utility matrix", () => {
  const allowedOrigins = ["http://localhost"];

  it("returns 403 for missing Origin and missing Referer", async () => {
    const request = new Request("http://localhost/api/test", { method: "POST" });
    const result = enforceCsrfProtection(request, { allowedOrigins });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.response.status).toBe(403);
    await expect(result.response.json()).resolves.toEqual({ message: "Forbidden." });
  });

  it("accepts missing Origin when Referer is allowed", () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: {
        referer: "http://localhost/some/page",
      },
    });

    const result = enforceCsrfProtection(request, { allowedOrigins });
    expect(result.ok).toBe(true);
  });

  it("returns 403 when token-protected endpoint is missing cookie/header token", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: {
        origin: "http://localhost",
      },
    });
    const result = enforceCsrfProtection(request, {
      allowedOrigins,
      requireToken: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.response.status).toBe(403);
    await expect(result.response.json()).resolves.toEqual({ message: "Forbidden." });
  });

  it("returns 403 when cookie/header token values mismatch", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        cookie: "csrf_token=token-a",
        "x-csrf-token": "token-b",
      },
    });
    const result = enforceCsrfProtection(request, {
      allowedOrigins,
      requireToken: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.response.status).toBe(403);
    await expect(result.response.json()).resolves.toEqual({ message: "Forbidden." });
  });

  it("accepts non-token-protected state-changing request with allowed Origin", () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: {
        origin: "http://localhost",
      },
    });
    const result = enforceCsrfProtection(request, { allowedOrigins });

    expect(result.ok).toBe(true);
  });
});
