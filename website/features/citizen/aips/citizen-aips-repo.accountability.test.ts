import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseServer = vi.fn();
const mockSupabaseAdmin = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => mockSupabaseAdmin(),
}));

vi.mock("@/lib/repos/_shared/selector", () => ({
  selectRepo: (input: { supabase: () => unknown }) => input.supabase(),
}));

function createServerClient(input: {
  aipId: string;
  uploaderId: string;
  approverId: string;
  approveAt: string;
  publishedAt: string;
  serverProfiles?: Array<{ id: string; full_name: string; role: "barangay_official" | "city_official" | "admin" | "citizen" }>;
}) {
  const aipRow = {
    id: input.aipId,
    fiscal_year: 2026,
    status: "published" as const,
    created_at: "2026-02-25T08:00:00.000Z",
    published_at: input.publishedAt,
    barangay_id: null,
    city_id: "city-1",
    municipality_id: null,
    barangay: null,
    city: { name: "Cabuyao" },
    municipality: null,
  };

  const currentFileRow = {
    aip_id: input.aipId,
    bucket_id: "aip-pdfs",
    object_name: `${input.aipId}/sample.pdf`,
    original_file_name: "AIP_2026.pdf",
    uploaded_by: input.uploaderId,
    created_at: "2026-02-25T08:17:25.136825+00:00",
    is_current: true,
  };

  const reviewRows = [
    {
      aip_id: input.aipId,
      reviewer_id: input.approverId,
      action: "approve" as const,
      created_at: input.approveAt,
    },
  ];

  return {
    from(table: string) {
      if (table === "aips") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: aipRow, error: null }),
              }),
            }),
          }),
        };
      }

      if (table === "projects") {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({ data: [], error: null }),
            }),
          }),
        };
      }

      if (table === "extraction_artifacts") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        };
      }

      if (table === "uploaded_files") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: async () => ({ data: [currentFileRow], error: null }),
              }),
            }),
          }),
        };
      }

      if (table === "aip_reviews") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: reviewRows, error: null }),
            }),
          }),
        };
      }

      if (table === "feedback") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: async () => ({ count: 0, error: null }),
              }),
            }),
          }),
        };
      }

      if (table === "aip_totals") {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({
                data: [
                  {
                    aip_id: input.aipId,
                    total_investment_program: 1_000_000,
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "profiles") {
        return {
          select: () => ({
            in: async () => ({ data: input.serverProfiles ?? [], error: null }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function createAdminClient(input: {
  profiles: Array<{ id: string; full_name: string; role: "barangay_official" | "city_official" | "admin" | "citizen" }>;
  profilesErrorMessage?: string;
}) {
  return {
    from(table: string) {
      if (table !== "profiles") {
        throw new Error(`Unexpected admin table: ${table}`);
      }
      return {
        select: () => ({
          in: async () =>
            input.profilesErrorMessage
              ? { data: null, error: { message: input.profilesErrorMessage } }
              : { data: input.profiles, error: null },
        }),
      };
    },
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: "https://example.com/aip.pdf" },
          error: null,
        }),
      }),
    },
  };
}

describe("CitizenAipRepo accountability mapping", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("resolves uploader and approver names and prefers approve timestamp for approval date", async () => {
    const aipId = "aip-1";
    const uploaderId = "uploader-1";
    const approverId = "approver-1";
    const approveAt = "2026-02-25T08:25:55.573482+00:00";
    const publishedAt = "2026-02-25T08:25:55.638699+00:00";

    mockSupabaseServer.mockResolvedValue(
      createServerClient({
        aipId,
        uploaderId,
        approverId,
        approveAt,
        publishedAt,
      })
    );

    mockSupabaseAdmin.mockReturnValue(
      createAdminClient({
        profiles: [
          { id: uploaderId, full_name: "Uploader Name", role: "city_official" },
          { id: approverId, full_name: "Approver Name", role: "admin" },
        ],
      })
    );

    const { getCitizenAipRepo } = await import("@/lib/repos/citizen-aips");
    const detail = await getCitizenAipRepo().getPublishedAipDetail(aipId);

    expect(detail).not.toBeNull();
    expect(detail?.accountability.uploadedBy?.name).toBe("Uploader Name");
    expect(detail?.accountability.approvedBy?.name).toBe("Approver Name");
    expect(detail?.accountability.uploadDate).toBe("2026-02-25T08:17:25.136825+00:00");
    expect(detail?.accountability.approvalDate).toBe(approveAt);
    expect(detail?.accountability.approvalDate).not.toBe(publishedAt);
  });

  it("falls back to server profile lookup when admin profile query fails", async () => {
    const aipId = "aip-2";
    const uploaderId = "uploader-2";
    const approverId = "approver-2";
    const approveAt = "2026-02-25T06:25:14.852954+00:00";
    const publishedAt = "2026-02-25T06:25:15.129022+00:00";

    mockSupabaseServer.mockResolvedValue(
      createServerClient({
        aipId,
        uploaderId,
        approverId,
        approveAt,
        publishedAt,
        serverProfiles: [
          { id: uploaderId, full_name: "Fallback Uploader", role: "barangay_official" },
          { id: approverId, full_name: "Fallback Approver", role: "admin" },
        ],
      })
    );

    mockSupabaseAdmin.mockReturnValue(
      createAdminClient({
        profiles: [],
        profilesErrorMessage: "Admin profile query failed",
      })
    );

    const { getCitizenAipRepo } = await import("@/lib/repos/citizen-aips");
    const detail = await getCitizenAipRepo().getPublishedAipDetail(aipId);

    expect(detail).not.toBeNull();
    expect(detail?.accountability.uploadedBy?.name).toBe("Fallback Uploader");
    expect(detail?.accountability.approvedBy?.name).toBe("Fallback Approver");
    expect(detail?.accountability.approvalDate).toBe(approveAt);
  });
});
