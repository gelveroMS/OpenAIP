import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseServer = vi.fn();
const mockGetCitizenProfileByUserId = vi.fn();
const mockResolveCitizenBarangayByNames = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

vi.mock("@/lib/auth/citizen-profile-completion", () => ({
  getCitizenProfileByUserId: (...args: unknown[]) => mockGetCitizenProfileByUserId(...args),
  resolveCitizenBarangayByNames: (...args: unknown[]) => mockResolveCitizenBarangayByNames(...args),
}));

function createMockClient(input: {
  userId: string | null;
  updateError?: string | null;
  insertError?: string | null;
  onUpdate?: (payload: Record<string, unknown>) => void;
}) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: input.userId ? { id: input.userId, email: "citizen@example.com" } : null },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table !== "profiles") {
        throw new Error(`Unexpected table ${table}`);
      }

      return {
        update: (payload: Record<string, unknown>) => ({
          eq: async () => {
            input.onUpdate?.(payload);
            return {
              error: input.updateError ? { message: input.updateError } : null,
            };
          },
        }),
        insert: async () => ({
          error: input.insertError ? { message: input.insertError } : null,
        }),
      };
    },
  };
}

function buildRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/profile/complete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /profile/complete", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("allows existing citizens to change profile location scope using fullName payload", async () => {
    const onUpdate = vi.fn();
    mockSupabaseServer.mockResolvedValue(
      createMockClient({
        userId: "user-1",
        onUpdate,
      })
    );
    mockGetCitizenProfileByUserId.mockResolvedValue({
      id: "user-1",
      role: "citizen",
      full_name: "Old Name",
      barangay_id: "old-brgy",
      city_id: "old-city",
      municipality_id: null,
    });
    mockResolveCitizenBarangayByNames.mockResolvedValue({
      ok: true,
      value: {
        barangayId: "new-brgy",
        barangayName: "Barangay Two",
        cityOrMunicipalityName: "San Pedro",
        cityId: "new-city",
        municipalityId: null,
        provinceId: "new-province",
        provinceName: "Laguna",
      },
    });

    const { POST } = await import("@/app/profile/complete/route");
    const response = await POST(
      buildRequest({
        fullName: "Juan Dela Cruz",
        barangay: "Barangay Two",
        city: "San Pedro",
        province: "Laguna",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(onUpdate).toHaveBeenCalledWith({
      full_name: "Juan Dela Cruz",
      role: "citizen",
      barangay_id: "new-brgy",
      city_id: null,
      municipality_id: null,
    });
  });

  it("returns 400 when location resolution fails", async () => {
    mockSupabaseServer.mockResolvedValue(
      createMockClient({
        userId: "user-1",
      })
    );
    mockGetCitizenProfileByUserId.mockResolvedValue({
      id: "user-1",
      role: "citizen",
      full_name: "Citizen User",
      barangay_id: null,
      city_id: null,
      municipality_id: null,
    });
    mockResolveCitizenBarangayByNames.mockResolvedValue({
      ok: false,
      errorMessage: "Barangay, city, and province do not match our records.",
    });

    const { POST } = await import("@/app/profile/complete/route");
    const response = await POST(
      buildRequest({
        firstName: "Juan",
        lastName: "Dela Cruz",
        barangay: "Unknown",
        city: "Unknown",
        province: "Unknown",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.message).toContain("do not match");
  });

  it("keeps non-citizen profile updates blocked", async () => {
    mockSupabaseServer.mockResolvedValue(
      createMockClient({
        userId: "user-1",
      })
    );
    mockGetCitizenProfileByUserId.mockResolvedValue({
      id: "user-1",
      role: "city_official",
      full_name: "City User",
      barangay_id: null,
      city_id: null,
      municipality_id: null,
    });
    mockResolveCitizenBarangayByNames.mockResolvedValue({
      ok: true,
      value: {
        barangayId: "new-brgy",
        barangayName: "Barangay Two",
        cityOrMunicipalityName: "San Pedro",
        cityId: "new-city",
        municipalityId: null,
        provinceId: "new-province",
        provinceName: "Laguna",
      },
    });

    const { POST } = await import("@/app/profile/complete/route");
    const response = await POST(
      buildRequest({
        firstName: "Juan",
        lastName: "Dela Cruz",
        barangay: "Barangay Two",
        city: "San Pedro",
        province: "Laguna",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.message).toContain("Only citizen accounts");
  });

  it("maps exact admin-managed scope trigger error to 403 guidance", async () => {
    mockSupabaseServer.mockResolvedValue(
      createMockClient({
        userId: "user-1",
        updateError: "scope is admin-managed",
      })
    );
    mockGetCitizenProfileByUserId.mockResolvedValue({
      id: "user-1",
      role: "citizen",
      full_name: "Citizen User",
      barangay_id: "old-brgy",
      city_id: null,
      municipality_id: null,
    });
    mockResolveCitizenBarangayByNames.mockResolvedValue({
      ok: true,
      value: {
        barangayId: "new-brgy",
        barangayName: "Barangay Two",
        cityOrMunicipalityName: "San Pedro",
        cityId: "new-city",
        municipalityId: null,
        provinceId: "new-province",
        provinceName: "Laguna",
      },
    });

    const { POST } = await import("@/app/profile/complete/route");
    const response = await POST(
      buildRequest({
        fullName: "Juan Dela Cruz",
        barangay: "Barangay Two",
        city: "San Pedro",
        province: "Laguna",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.message).toContain("managed by administrators");
  });

  it("does not remap unrelated scope errors to admin-managed guidance", async () => {
    mockSupabaseServer.mockResolvedValue(
      createMockClient({
        userId: "user-1",
        updateError: "scope is invalid for current actor",
      })
    );
    mockGetCitizenProfileByUserId.mockResolvedValue({
      id: "user-1",
      role: "citizen",
      full_name: "Citizen User",
      barangay_id: "old-brgy",
      city_id: null,
      municipality_id: null,
    });
    mockResolveCitizenBarangayByNames.mockResolvedValue({
      ok: true,
      value: {
        barangayId: "new-brgy",
        barangayName: "Barangay Two",
        cityOrMunicipalityName: "San Pedro",
        cityId: "new-city",
        municipalityId: null,
        provinceId: "new-province",
        provinceName: "Laguna",
      },
    });

    const { POST } = await import("@/app/profile/complete/route");
    const response = await POST(
      buildRequest({
        fullName: "Juan Dela Cruz",
        barangay: "Barangay Two",
        city: "San Pedro",
        province: "Laguna",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.message).toBe("scope is invalid for current actor");
  });
});
