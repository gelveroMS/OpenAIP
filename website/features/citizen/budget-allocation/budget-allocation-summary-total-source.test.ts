import { beforeEach, describe, expect, it, vi } from "vitest";

type MockAipRow = {
  id: string;
  fiscal_year: number;
  status: string;
  city_id: string | null;
  barangay_id: string | null;
};

type MockProjectRow = {
  aip_id: string;
  sector_code: string | null;
  total: number | null;
};

type MockAipTotalRow = {
  aip_id: string;
  source_label: string;
  total_investment_program: number | string | null;
};

const mockSupabaseServer = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

function createMockClient(input: {
  cityName: string;
  cityId: string;
  aips: MockAipRow[];
  projects: MockProjectRow[];
  aipTotals: MockAipTotalRow[];
}) {
  return {
    from(table: string) {
      if (table === "cities") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { name: input.cityName },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "aips") {
        return {
          select: () => {
            const eqFilters: Array<{ field: string; value: unknown }> = [];
            let fiscalYearMax: number | null = null;

            const builder = {
              eq(field: string, value: unknown) {
                eqFilters.push({ field, value });
                return builder;
              },
              lte(field: string, value: number) {
                if (field === "fiscal_year") {
                  fiscalYearMax = value;
                }
                return builder;
              },
              order() {
                return builder;
              },
              limit() {
                return builder;
              },
              then(
                resolve: (value: { data: Array<{ id: string; fiscal_year: number }>; error: null }) => void,
                reject?: (reason?: unknown) => void
              ) {
                let rows = [...input.aips];
                for (const filter of eqFilters) {
                  rows = rows.filter(
                    (row) =>
                      (row as Record<string, unknown>)[filter.field] === filter.value
                  );
                }
                if (typeof fiscalYearMax === "number") {
                  rows = rows.filter((row) => row.fiscal_year <= fiscalYearMax!);
                }
                return Promise.resolve({
                  data: rows.map((row) => ({
                    id: row.id,
                    fiscal_year: row.fiscal_year,
                  })),
                  error: null as null,
                }).then(resolve, reject);
              },
            };

            return builder;
          },
        };
      }

      if (table === "projects") {
        return {
          select: () => {
            const inFilters = new Map<string, unknown[]>();

            const builder = {
              in(field: string, values: unknown[]) {
                inFilters.set(field, values);
                return builder;
              },
              then(
                resolve: (value: { data: MockProjectRow[]; error: null }) => void,
                reject?: (reason?: unknown) => void
              ) {
                let rows = [...input.projects];
                for (const [field, values] of inFilters.entries()) {
                  rows = rows.filter((row) =>
                    values.includes((row as Record<string, unknown>)[field])
                  );
                }
                return Promise.resolve({ data: rows, error: null as null }).then(
                  resolve,
                  reject
                );
              },
            };

            return builder;
          },
        };
      }

      if (table === "aip_totals") {
        return {
          select: () => {
            const eqFilters: Array<{ field: string; value: unknown }> = [];
            let aipIds: string[] = [];

            const builder = {
              eq(field: string, value: unknown) {
                eqFilters.push({ field, value });
                return builder;
              },
              in(field: string, values: string[]) {
                if (field === "aip_id") {
                  aipIds = values;
                }
                return {
                  then: (
                    resolve: (value: { data: MockAipTotalRow[]; error: null }) => void,
                    reject?: (reason?: unknown) => void
                  ) => {
                    let rows = [...input.aipTotals];
                    for (const filter of eqFilters) {
                      rows = rows.filter(
                        (row) =>
                          (row as Record<string, unknown>)[filter.field] === filter.value
                      );
                    }
                    rows = rows.filter((row) => aipIds.includes(row.aip_id));
                    return Promise.resolve({ data: rows, error: null as null }).then(
                      resolve,
                      reject
                    );
                  },
                };
              },
            };

            return builder;
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

const CITY_ID = "11111111-1111-4111-8111-111111111111";

describe("GET /api/citizen/budget-allocation/summary total source", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("uses canonical AIP display total and folds residual to Other Services", async () => {
    mockSupabaseServer.mockResolvedValue(
      createMockClient({
        cityName: "City of Alpha",
        cityId: CITY_ID,
        aips: [
          { id: "aip-1", fiscal_year: 2026, status: "published", city_id: CITY_ID, barangay_id: null },
        ],
        projects: [
          { aip_id: "aip-1", sector_code: "1000", total: 300 },
          { aip_id: "aip-1", sector_code: "3000", total: 200 },
          { aip_id: "aip-1", sector_code: "7777", total: 50 },
          { aip_id: "aip-1", sector_code: null, total: 25 },
        ],
        aipTotals: [
          { aip_id: "aip-1", source_label: "total_investment_program", total_investment_program: 1000 },
        ],
      })
    );

    const { GET } = await import("@/app/api/citizen/budget-allocation/summary/route");
    const response = await GET(
      new Request(
        `http://localhost/api/citizen/budget-allocation/summary?fiscal_year=2026&scope_type=city&scope_id=${CITY_ID}`
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.totals.overall_total).toBe(1000);
    expect(
      body.totals.by_sector.find((row: { sector_code: string }) => row.sector_code === "1000")?.total
    ).toBe(300);
    expect(
      body.totals.by_sector.find((row: { sector_code: string }) => row.sector_code === "3000")?.total
    ).toBe(200);
    expect(
      body.totals.by_sector.find((row: { sector_code: string }) => row.sector_code === "9000")?.total
    ).toBe(500);
    expect(
      body.totals.by_sector.find((row: { sector_code: string }) => row.sector_code === "1000")?.pct
    ).toBeCloseTo(0.3);
    expect(
      body.totals.by_sector.find((row: { sector_code: string }) => row.sector_code === "9000")?.pct
    ).toBeCloseTo(0.5);
  });

  it("falls back to project totals when no aip_totals record exists", async () => {
    mockSupabaseServer.mockResolvedValue(
      createMockClient({
        cityName: "City of Alpha",
        cityId: CITY_ID,
        aips: [
          { id: "aip-1", fiscal_year: 2026, status: "published", city_id: CITY_ID, barangay_id: null },
        ],
        projects: [
          { aip_id: "aip-1", sector_code: "1000", total: 300 },
          { aip_id: "aip-1", sector_code: "3000", total: 100 },
          { aip_id: "aip-1", sector_code: "7777", total: 200 },
        ],
        aipTotals: [],
      })
    );

    const { GET } = await import("@/app/api/citizen/budget-allocation/summary/route");
    const response = await GET(
      new Request(
        `http://localhost/api/citizen/budget-allocation/summary?fiscal_year=2026&scope_type=city&scope_id=${CITY_ID}`
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.totals.overall_total).toBe(600);
    expect(
      body.totals.by_sector.find((row: { sector_code: string }) => row.sector_code === "9000")?.total
    ).toBe(200);
  });
});
