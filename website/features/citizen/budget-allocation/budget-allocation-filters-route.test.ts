import { beforeEach, describe, expect, it, vi } from "vitest";

type MockAipRow = {
  id: string;
  status: string;
  fiscal_year: number;
  city_id: string | null;
  barangay_id: string | null;
  created_at: string | null;
};

type MockScopeRow = {
  id: string;
  name: string | null;
  psgc_code?: string | null;
};

type MockBarangayRow = {
  id: string;
  name: string | null;
  city_id?: string | null;
  municipality_id?: string | null;
};

const mocksupabasePublicServer = vi.fn();

vi.mock("@/lib/supabase/public-server", () => ({
  supabasePublicServer: () => mocksupabasePublicServer(),
}));

function createAipQueryBuilder(rows: MockAipRow[]) {
  const eqFilters: Array<{ field: string; value: unknown }> = [];
  let requireScoped = false;

  const builder = {
    eq: (field: string, value: unknown) => {
      eqFilters.push({ field, value });
      return builder;
    },
    or: (expression: string) => {
      if (expression === "city_id.not.is.null,barangay_id.not.is.null") {
        requireScoped = true;
      }
      return builder;
    },
    then: (
      resolve: (value: {
        data: Array<{
          id: string;
          fiscal_year: number;
          city_id: string | null;
          barangay_id: string | null;
          created_at: string | null;
        }>;
        error: null;
      }) => void,
      reject?: (reason?: unknown) => void
    ) => {
      let filtered = [...rows];
      for (const filter of eqFilters) {
        filtered = filtered.filter((row) => (row as Record<string, unknown>)[filter.field] === filter.value);
      }
      if (requireScoped) {
        filtered = filtered.filter((row) => row.city_id !== null || row.barangay_id !== null);
      }
      const projected = filtered.map((row) => ({
        id: row.id,
        fiscal_year: row.fiscal_year,
        city_id: row.city_id,
        barangay_id: row.barangay_id,
        created_at: row.created_at,
      }));
      return Promise.resolve({ data: projected, error: null as null }).then(resolve, reject);
    },
  };

  return builder;
}

function createMockClient(input: {
  aips: MockAipRow[];
  cities: MockScopeRow[];
  barangays: MockBarangayRow[];
  municipalities?: MockScopeRow[];
}) {
  return {
    from: (table: string) => {
      if (table === "aips") {
        return {
          select: () => createAipQueryBuilder(input.aips),
        };
      }

      if (table === "cities") {
        return {
          select: () => ({
            in: async (_field: string, ids: string[]) => ({
              data: input.cities.filter((row) => ids.includes(row.id)),
              error: null,
            }),
          }),
        };
      }

      if (table === "barangays") {
        return {
          select: () => ({
            in: async (_field: string, ids: string[]) => ({
              data: input.barangays.filter((row) => ids.includes(row.id)),
              error: null,
            }),
          }),
        };
      }

      if (table === "municipalities") {
        return {
          select: () => ({
            in: async (_field: string, ids: string[]) => ({
              data: (input.municipalities ?? []).filter((row) => ids.includes(row.id)),
              error: null,
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

const CITY_A = "11111111-1111-4111-8111-111111111111";
const CITY_B = "22222222-2222-4222-8222-222222222222";
const CITY_C = "55555555-5555-4555-8555-555555555555";
const BRGY_A = "33333333-3333-4333-8333-333333333333";
const BRGY_B = "44444444-4444-4444-8444-444444444444";
const CABUYAO_PSGC = "043404";
const OTHER_CITY_PSGC = "043405";

describe("GET /api/citizen/budget-allocation/filters", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("defaults to Cabuyao city and uses its latest fiscal year", async () => {
    mocksupabasePublicServer.mockReturnValue(
      createMockClient({
        aips: [
          {
            id: "aip-cabuyao-2025",
            status: "published",
            fiscal_year: 2025,
            city_id: CITY_A,
            barangay_id: null,
            created_at: "2025-02-01T00:00:00.000Z",
          },
          {
            id: "aip-cabuyao-2026",
            status: "published",
            fiscal_year: 2026,
            city_id: CITY_A,
            barangay_id: null,
            created_at: "2024-12-01T00:00:00.000Z",
          },
          {
            id: "aip-other-city-2030",
            status: "published",
            fiscal_year: 2030,
            city_id: CITY_B,
            barangay_id: null,
            created_at: "2030-01-01T00:00:00.000Z",
          },
          {
            id: "aip-brgy-2031",
            status: "published",
            fiscal_year: 2031,
            city_id: null,
            barangay_id: BRGY_A,
            created_at: "2031-01-01T00:00:00.000Z",
          },
        ],
        cities: [
          { id: CITY_A, name: "City of Cabuyao", psgc_code: CABUYAO_PSGC },
          { id: CITY_B, name: "City of Beta", psgc_code: OTHER_CITY_PSGC },
        ],
        barangays: [{ id: BRGY_A, name: "Brgy. One", city_id: CITY_A }],
      })
    );

    const { GET } = await import("@/app/api/citizen/budget-allocation/filters/route");
    const response = await GET(new Request("http://localhost/api/citizen/budget-allocation/filters"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.selected).toEqual({
      fiscal_year: 2026,
      scope_type: "city",
      scope_id: CITY_A,
    });
    expect(body.years).toEqual([2026, 2025]);
    expect(body.lgus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope_type: "city", scope_id: CITY_A }),
        expect.objectContaining({ scope_type: "city", scope_id: CITY_B }),
        expect.objectContaining({ scope_type: "barangay", scope_id: BRGY_A }),
      ])
    );
  });

  it("falls back to most recent city-level AIP when Cabuyao city has no published city AIP", async () => {
    mocksupabasePublicServer.mockReturnValue(
      createMockClient({
        aips: [
          {
            id: "aip-city-b",
            status: "published",
            fiscal_year: 2027,
            city_id: CITY_B,
            barangay_id: null,
            created_at: "2025-01-01T00:00:00.000Z",
          },
          {
            id: "aip-city-c",
            status: "published",
            fiscal_year: 2024,
            city_id: CITY_C,
            barangay_id: null,
            created_at: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "aip-brgy",
            status: "published",
            fiscal_year: 2030,
            city_id: null,
            barangay_id: BRGY_A,
            created_at: "2030-01-01T00:00:00.000Z",
          },
        ],
        cities: [
          { id: CITY_B, name: "City of Beta", psgc_code: OTHER_CITY_PSGC },
          { id: CITY_C, name: "City of Gamma", psgc_code: OTHER_CITY_PSGC },
        ],
        barangays: [{ id: BRGY_A, name: "Brgy. One", city_id: CITY_B }],
      })
    );

    const { GET } = await import("@/app/api/citizen/budget-allocation/filters/route");
    const response = await GET(new Request("http://localhost/api/citizen/budget-allocation/filters"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.selected).toEqual({
      fiscal_year: 2024,
      scope_type: "city",
      scope_id: CITY_C,
    });
    expect(body.years).toEqual([2024]);
  });

  it("falls back to most recently uploaded barangay AIP when no city-level AIPs exist", async () => {
    mocksupabasePublicServer.mockReturnValue(
      createMockClient({
        aips: [
          {
            id: "aip-brgy-a",
            status: "published",
            fiscal_year: 2026,
            city_id: null,
            barangay_id: BRGY_A,
            created_at: "2024-01-01T00:00:00.000Z",
          },
          {
            id: "aip-brgy-b",
            status: "published",
            fiscal_year: 2025,
            city_id: null,
            barangay_id: BRGY_B,
            created_at: "2025-12-31T00:00:00.000Z",
          },
        ],
        cities: [],
        barangays: [
          { id: BRGY_A, name: "Brgy. One", city_id: CITY_B },
          { id: BRGY_B, name: "Brgy. Two", city_id: CITY_B },
        ],
      })
    );

    const { GET } = await import("@/app/api/citizen/budget-allocation/filters/route");
    const response = await GET(new Request("http://localhost/api/citizen/budget-allocation/filters"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.selected).toEqual({
      fiscal_year: 2025,
      scope_type: "barangay",
      scope_id: BRGY_B,
    });
    expect(body.years).toEqual([2025]);
  });

  it("returns 400 for invalid scope params", async () => {
    const { GET } = await import("@/app/api/citizen/budget-allocation/filters/route");
    const response = await GET(
      new Request(
        "http://localhost/api/citizen/budget-allocation/filters?scope_type=city&scope_id=not-a-uuid"
      )
    );

    expect(response.status).toBe(400);
    expect(mocksupabasePublicServer).not.toHaveBeenCalled();
  });

  it("keeps requested scope-year pair when both are valid", async () => {
    mocksupabasePublicServer.mockReturnValue(
      createMockClient({
        aips: [
          {
            id: "aip-city-2026",
            status: "published",
            fiscal_year: 2026,
            city_id: CITY_A,
            barangay_id: null,
            created_at: "2026-01-10T00:00:00.000Z",
          },
          {
            id: "aip-city-2025",
            status: "published",
            fiscal_year: 2025,
            city_id: CITY_A,
            barangay_id: null,
            created_at: "2025-01-10T00:00:00.000Z",
          },
        ],
        cities: [{ id: CITY_A, name: "City of Alpha", psgc_code: CABUYAO_PSGC }],
        barangays: [],
      })
    );

    const { GET } = await import("@/app/api/citizen/budget-allocation/filters/route");
    const response = await GET(
      new Request(
        `http://localhost/api/citizen/budget-allocation/filters?fiscal_year=2025&scope_type=city&scope_id=${CITY_A}`
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.selected).toEqual({
      fiscal_year: 2025,
      scope_type: "city",
      scope_id: CITY_A,
    });
    expect(body.years).toEqual([2026, 2025]);
  });

  it("falls back to latest year for requested scope when requested year is invalid for that scope", async () => {
    mocksupabasePublicServer.mockReturnValue(
      createMockClient({
        aips: [
          {
            id: "aip-city-2026",
            status: "published",
            fiscal_year: 2026,
            city_id: CITY_A,
            barangay_id: null,
            created_at: "2026-01-10T00:00:00.000Z",
          },
          {
            id: "aip-city-2024",
            status: "published",
            fiscal_year: 2024,
            city_id: CITY_A,
            barangay_id: null,
            created_at: "2024-01-10T00:00:00.000Z",
          },
        ],
        cities: [{ id: CITY_A, name: "City of Alpha", psgc_code: CABUYAO_PSGC }],
        barangays: [],
      })
    );

    const { GET } = await import("@/app/api/citizen/budget-allocation/filters/route");
    const response = await GET(
      new Request(
        `http://localhost/api/citizen/budget-allocation/filters?fiscal_year=2030&scope_type=city&scope_id=${CITY_A}`
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.selected).toEqual({
      fiscal_year: 2026,
      scope_type: "city",
      scope_id: CITY_A,
    });
  });

  it("keeps full LGU option list even when a fiscal year is selected", async () => {
    mocksupabasePublicServer.mockReturnValue(
      createMockClient({
        aips: [
          {
            id: "aip-city-2026",
            status: "published",
            fiscal_year: 2026,
            city_id: CITY_A,
            barangay_id: null,
            created_at: "2026-01-10T00:00:00.000Z",
          },
          {
            id: "aip-city-2025",
            status: "published",
            fiscal_year: 2025,
            city_id: CITY_B,
            barangay_id: null,
            created_at: "2025-01-10T00:00:00.000Z",
          },
          {
            id: "aip-brgy-2024",
            status: "published",
            fiscal_year: 2024,
            city_id: null,
            barangay_id: BRGY_A,
            created_at: "2024-01-10T00:00:00.000Z",
          },
        ],
        cities: [
          { id: CITY_A, name: "City of Alpha", psgc_code: CABUYAO_PSGC },
          { id: CITY_B, name: "City of Beta", psgc_code: OTHER_CITY_PSGC },
        ],
        barangays: [{ id: BRGY_A, name: "Brgy. One", city_id: CITY_A }],
      })
    );

    const { GET } = await import("@/app/api/citizen/budget-allocation/filters/route");
    const response = await GET(
      new Request(`http://localhost/api/citizen/budget-allocation/filters?fiscal_year=2026`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.selected).toEqual({
      fiscal_year: 2026,
      scope_type: "city",
      scope_id: CITY_A,
    });
    expect(body.lgus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope_type: "city", scope_id: CITY_A }),
        expect.objectContaining({ scope_type: "city", scope_id: CITY_B }),
        expect.objectContaining({ scope_type: "barangay", scope_id: BRGY_A }),
      ])
    );
  });

  it("returns has_data=false when there are no published AIPs", async () => {
    mocksupabasePublicServer.mockReturnValue(
      createMockClient({
        aips: [],
        cities: [],
        barangays: [],
      })
    );

    const { GET } = await import("@/app/api/citizen/budget-allocation/filters/route");
    const response = await GET(new Request("http://localhost/api/citizen/budget-allocation/filters"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      has_data: false,
      years: [],
      lgus: [],
      selected: null,
    });
  });
});
