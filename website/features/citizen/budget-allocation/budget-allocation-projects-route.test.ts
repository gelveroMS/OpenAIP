import { beforeEach, describe, expect, it, vi } from "vitest";

type MockAipRow = {
  id: string;
  status: string;
  fiscal_year: number;
  city_id: string | null;
  barangay_id: string | null;
};

type MockProjectRow = {
  id: string;
  aip_id: string;
  aip_ref_code: string;
  program_project_description: string;
  source_of_funds: string | null;
  total: number | null;
  sector_code: string;
};

const mockSupabaseServer = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

function createMockClient(input: { aips: MockAipRow[]; projects: MockProjectRow[] }) {
  const aipById = new Map(input.aips.map((row) => [row.id, row]));

  return {
    from: (table: string) => {
      if (table === "aips") {
        return {
          select: (_columns: string, _options?: { head?: boolean; count?: "exact" }) => {
            void _columns;
            void _options;
            const eqFilters: Array<{ field: string; value: unknown }> = [];
            const builder = {
              eq: (field: string, value: unknown) => {
                eqFilters.push({ field, value });
                return builder;
              },
              then: (
                resolve: (value: { data: null; error: null; count: number }) => void,
                reject?: (reason?: unknown) => void
              ) => {
                let rows = [...input.aips];
                for (const filter of eqFilters) {
                  rows = rows.filter((row) => (row as Record<string, unknown>)[filter.field] === filter.value);
                }
                return Promise.resolve({ data: null, error: null as null, count: rows.length }).then(resolve, reject);
              },
            };
            return builder;
          },
        };
      }

      if (table === "projects") {
        return {
          select: (_columns: string, options?: { count?: "exact" }) => {
            void _columns;
            const eqFilters: Array<{ field: string; value: unknown }> = [];
            const inFilters: Array<{ field: string; values: unknown[] }> = [];
            const orderFields: Array<{ field: string; ascending: boolean }> = [];
            let rangeFrom = 0;
            let rangeTo = Number.MAX_SAFE_INTEGER;

            const applyFilters = () => {
              let rows = [...input.projects];
              for (const filter of eqFilters) {
                if (filter.field.startsWith("aips.")) {
                  const aipField = filter.field.slice("aips.".length);
                  rows = rows.filter((row) => {
                    const aip = aipById.get(row.aip_id);
                    return aip ? (aip as Record<string, unknown>)[aipField] === filter.value : false;
                  });
                } else {
                  rows = rows.filter((row) => (row as Record<string, unknown>)[filter.field] === filter.value);
                }
              }
              for (const filter of inFilters) {
                rows = rows.filter((row) => filter.values.includes((row as Record<string, unknown>)[filter.field]));
              }

              rows = rows.sort((left, right) => {
                for (const order of orderFields) {
                  const leftValue = (left as Record<string, unknown>)[order.field];
                  const rightValue = (right as Record<string, unknown>)[order.field];
                  const leftNumber = typeof leftValue === "number" ? leftValue : Number(leftValue ?? 0);
                  const rightNumber = typeof rightValue === "number" ? rightValue : Number(rightValue ?? 0);
                  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
                    return order.ascending ? leftNumber - rightNumber : rightNumber - leftNumber;
                  }
                  const leftText = String(leftValue ?? "");
                  const rightText = String(rightValue ?? "");
                  if (leftText !== rightText) {
                    return order.ascending ? leftText.localeCompare(rightText) : rightText.localeCompare(leftText);
                  }
                }
                return 0;
              });

              return rows;
            };

            const builder = {
              eq: (field: string, value: unknown) => {
                eqFilters.push({ field, value });
                return builder;
              },
              in: (field: string, values: unknown[]) => {
                inFilters.push({ field, values });
                return builder;
              },
              or: () => builder,
              order: (field: string, opts?: { ascending?: boolean }) => {
                orderFields.push({ field, ascending: opts?.ascending ?? true });
                return builder;
              },
              range: (from: number, to: number) => {
                rangeFrom = from;
                rangeTo = to;
                return builder;
              },
              returns: <T>() => builder as unknown as T,
              then: (
                resolve: (value: { data: MockProjectRow[]; error: null; count: number | null }) => void,
                reject?: (reason?: unknown) => void
              ) => {
                const filtered = applyFilters();
                const paged = filtered.slice(rangeFrom, rangeTo + 1);
                const count = options?.count === "exact" ? filtered.length : null;
                return Promise.resolve({ data: paged, error: null as null, count }).then(resolve, reject);
              },
            };
            return builder;
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

const CITY_ID = "11111111-1111-4111-8111-111111111111";

describe("GET /api/citizen/budget-allocation/projects", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns paginated project rows with totalPages/totalRows", async () => {
    const aipId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const projects: MockProjectRow[] = Array.from({ length: 25 }, (_, index) => {
      const rank = index + 1;
      return {
        id: `proj-${rank}`,
        aip_id: aipId,
        aip_ref_code: `REF-${String(rank).padStart(2, "0")}`,
        program_project_description: `Project ${rank}`,
        source_of_funds: "General Fund",
        total: 1000 - rank,
        sector_code: "1000",
      };
    });

    mockSupabaseServer.mockResolvedValue(
      createMockClient({
        aips: [
          {
            id: aipId,
            status: "published",
            fiscal_year: 2026,
            city_id: CITY_ID,
            barangay_id: null,
          },
        ],
        projects,
      })
    );

    const { GET } = await import("@/app/api/citizen/budget-allocation/projects/route");
    const response = await GET(
      new Request(
        `http://localhost/api/citizen/budget-allocation/projects?fiscal_year=2026&scope_type=city&scope_id=${CITY_ID}&sector_code=1000&page=2&pageSize=10`
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(10);
    expect(body.totalRows).toBe(25);
    expect(body.totalPages).toBe(3);
    expect(body.items).toHaveLength(10);
    expect(body.items[0].aip_ref_code).toBe("REF-11");
  });
});
