import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseServer = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: (...args: unknown[]) => mockSupabaseServer(...args),
}));

function createClientWithLatestRun(latestRun: unknown) {
  const state = {
    inValues: [] as string[],
  };

  const query = {
    eq: () => ({
      in: (_column: string, values: string[]) => {
        state.inValues = values;
        return {
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: latestRun, error: null }),
            }),
          }),
        };
      },
    }),
  };

  return {
    state,
    client: {
      from: () => ({
        select: () => query,
      }),
    },
  };
}

describe("active extraction run routes include embed stage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("city route surfaces failed embed run and includes embed in stage filter", async () => {
    const { client, state } = createClientWithLatestRun({
      id: "run-embed-city",
      aip_id: "aip-city-1",
      stage: "embed",
      status: "failed",
      error_message: "Embedding failed.",
      created_at: "2026-03-06T01:00:00.000Z",
    });
    mockSupabaseServer.mockResolvedValue(client);

    const { GET } = await import("@/app/api/city/aips/[aipId]/runs/active/route");
    const response = await GET(
      new Request("http://localhost/api/city/aips/aip-city-1/runs/active"),
      { params: Promise.resolve({ aipId: "aip-city-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(state.inValues).toContain("embed");
    expect(body.failedRun).toEqual(
      expect.objectContaining({
        runId: "run-embed-city",
        stage: "embed",
        status: "failed",
      })
    );
  });

  it("barangay route surfaces failed embed run and includes embed in stage filter", async () => {
    const { client, state } = createClientWithLatestRun({
      id: "run-embed-brgy",
      aip_id: "aip-brgy-1",
      stage: "embed",
      status: "failed",
      error_message: "Embedding failed.",
      created_at: "2026-03-06T01:00:00.000Z",
    });
    mockSupabaseServer.mockResolvedValue(client);

    const { GET } = await import("@/app/api/barangay/aips/[aipId]/runs/active/route");
    const response = await GET(
      new Request("http://localhost/api/barangay/aips/aip-brgy-1/runs/active"),
      { params: Promise.resolve({ aipId: "aip-brgy-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(state.inValues).toContain("embed");
    expect(body.failedRun).toEqual(
      expect.objectContaining({
        runId: "run-embed-brgy",
        stage: "embed",
        status: "failed",
      })
    );
  });
});
