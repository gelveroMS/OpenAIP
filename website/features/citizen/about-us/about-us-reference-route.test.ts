import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCitizenAboutUsReferenceDocById = vi.fn();
const mockSupabaseAdmin = vi.fn();

vi.mock("@/lib/content/citizen-about-us", () => ({
  getCitizenAboutUsReferenceDocById: (...args: unknown[]) =>
    mockGetCitizenAboutUsReferenceDocById(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => mockSupabaseAdmin(),
}));

describe("GET /api/citizen/about-us/reference/[docId]", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns 307 redirect when storage doc signed URL is generated", async () => {
    mockGetCitizenAboutUsReferenceDocById.mockResolvedValue({
      id: "dbm_primer_cover",
      title: "DBM Primer Cover",
      source: "Source: DBM",
      kind: "storage",
      bucketId: "about-us-docs",
      objectName: "reference/dbm-primer-cover.pdf",
    });

    mockSupabaseAdmin.mockReturnValue({
      storage: {
        from: () => ({
          createSignedUrl: async () => ({
            data: { signedUrl: "https://example.com/signed.pdf" },
            error: null,
          }),
        }),
      },
    });

    const { GET } = await import("@/app/api/citizen/about-us/reference/[docId]/route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ docId: "dbm_primer_cover" }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/signed.pdf");
  });

  it("returns 404 when reference document is not found", async () => {
    mockGetCitizenAboutUsReferenceDocById.mockResolvedValue(null);

    const { GET } = await import("@/app/api/citizen/about-us/reference/[docId]/route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ docId: "unknown" }),
    });

    expect(response.status).toBe(404);
    expect(mockSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("returns 502 when signed URL generation fails", async () => {
    mockGetCitizenAboutUsReferenceDocById.mockResolvedValue({
      id: "ra_7160",
      title: "RA 7160",
      source: "Source: Official Code",
      kind: "storage",
      bucketId: "about-us-docs",
      objectName: "reference/ra-7160.pdf",
    });

    mockSupabaseAdmin.mockReturnValue({
      storage: {
        from: () => ({
          createSignedUrl: async () => ({
            data: null,
            error: { message: "storage error" },
          }),
        }),
      },
    });

    const { GET } = await import("@/app/api/citizen/about-us/reference/[docId]/route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ docId: "ra_7160" }),
    });

    expect(response.status).toBe(502);
  });
});
