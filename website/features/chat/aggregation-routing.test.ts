import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatSession } from "@/lib/repos/chat/types";

const mockGetActorContext = vi.fn();
const mockResolveRetrievalScope = vi.fn();
const mockRequestPipelineQueryEmbedding = vi.fn();
const mockRequestPipelineIntentClassify = vi.fn();
const mockRequestPipelineChatAnswer = vi.fn();
const mockSupabaseServer = vi.fn();
const mockSupabaseAdmin = vi.fn();
const mockRouteSqlFirstTotals = vi.fn();
const mockGetSession = vi.fn();
const mockCreateSession = vi.fn();
const mockAppendUserMessage = vi.fn();
const mockConsumeQuotaRpc = vi.fn();
const mockServerRpc = vi.fn();
const mockConsoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
const mockGetTypedAppSetting = vi.fn();
const mockIsUserBlocked = vi.fn();

const session: ChatSession = {
  id: "session-1",
  userId: "user-1",
  title: "Chat",
  context: {},
  lastMessageAt: null,
  createdAt: "2026-02-27T00:00:00.000Z",
  updatedAt: "2026-02-27T00:00:00.000Z",
};

type StoredAssistantRow = {
  id: string;
  session_id: string;
  role: "assistant";
  content: string;
  citations: unknown;
  retrieval_meta: unknown;
  created_at: string;
};

type LineItemRow = {
  id: string;
  aip_id: string;
  fiscal_year: number;
  barangay_id: string | null;
  aip_ref_code: string | null;
  program_project_title: string;
  implementing_agency: string | null;
  start_date: string | null;
  end_date: string | null;
  fund_source: string | null;
  ps: number | null;
  mooe: number | null;
  co: number | null;
  fe: number | null;
  total: number | null;
  expected_output: string | null;
  page_no: number | null;
  row_no: number | null;
  table_no: number | null;
};

let assistantRows: StoredAssistantRow[] = [];
let assistantCounter = 0;
let messageCounter = 0;
let rpcResponses: Record<string, unknown> = {};
let lineItemsById: Record<string, LineItemRow> = {};
let routePostHandler: typeof import("@/app/api/barangay/chat/messages/route").POST | null = null;

function createServerClient() {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mockServerRpc(fn, args);
      if (Object.prototype.hasOwnProperty.call(rpcResponses, fn)) {
        return { data: rpcResponses[fn], error: null };
      }
      throw new Error(`Unexpected server rpc: ${fn}`);
    },
    from: (table: string) => {
      if (table === "aip_line_items") {
        return {
          select: () => {
            const eqFilters: Array<{ field: string; value: unknown }> = [];
            let ilikeFilter: { field: string; value: string } | null = null;

            const applyFilters = () => {
              let rows = Object.values(lineItemsById);
              const activeIlikeFilter = ilikeFilter;
              if (activeIlikeFilter) {
                rows = rows.filter((row) => {
                  const candidate = String(
                    (row as Record<string, unknown>)[activeIlikeFilter.field] ?? ""
                  );
                  return candidate.toLowerCase() === activeIlikeFilter.value.toLowerCase();
                });
              }
              for (const filter of eqFilters) {
                rows = rows.filter((row) => (row as Record<string, unknown>)[filter.field] === filter.value);
              }
              return rows;
            };

            const builder = {
              in: async (field: string, ids: string[]) => ({
                data: applyFilters().filter((row) => ids.includes(String((row as Record<string, unknown>)[field] ?? ""))),
                error: null,
              }),
              eq: (field: string, value: unknown) => {
                eqFilters.push({ field, value });
                return builder;
              },
              ilike: (field: string, value: string) => {
                ilikeFilter = { field, value };
                return builder;
              },
              limit: async (count: number) => ({
                data: applyFilters().slice(0, count),
                error: null,
              }),
              maybeSingle: async () => ({
                data: applyFilters()[0] ?? null,
                error: null,
              }),
            };

            return builder;
          },
        };
      }

      return {
        select: () => ({
          in: async () => ({ data: [], error: null }),
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    },
  };
}

function createAdminClient() {
  const barangayRows = [
    { id: "brgy-1", name: "Mamatid", is_active: true },
    { id: "brgy-2", name: "Canlubang", is_active: true },
    { id: "brgy-3", name: "Pulo", is_active: true },
  ];
  const aipRows = [
    {
      id: "aip-1",
      status: "published",
      fiscal_year: 2026,
      barangay_id: "brgy-1",
      city_id: null,
      municipality_id: null,
      created_at: "2026-01-02T00:00:00.000Z",
    },
    {
      id: "aip-pulo-2026",
      status: "published",
      fiscal_year: 2026,
      barangay_id: "brgy-3",
      city_id: null,
      municipality_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];
  const totalsRows = [
    {
      aip_id: "aip-pulo-2026",
      source_label: "total_investment_program",
      total_investment_program: 65824308.28,
      page_no: 4,
      evidence_text:
        "INVESTMENT | PROGRAM Grand Total 11,111.11 22,222.22 65,824,308.28 Prepared by: ABC",
    },
  ];

  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "consume_chat_quota") {
        mockConsumeQuotaRpc(fn, args);
        return {
          data: {
            allowed: true,
            reason: "ok",
          },
          error: null,
        };
      }
      throw new Error(`Unexpected admin rpc: ${fn}`);
    },
    from: (table: string) => {
      if (table === "chat_messages") {
        return {
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                assistantCounter += 1;
                const row: StoredAssistantRow = {
                  id: `assistant-${assistantCounter}`,
                  session_id: String(payload.session_id),
                  role: "assistant",
                  content: String(payload.content),
                  citations: payload.citations ?? null,
                  retrieval_meta: payload.retrieval_meta ?? null,
                  created_at: new Date(Date.now() + assistantCounter * 1000).toISOString(),
                };
                assistantRows.push(row);
                return { data: row, error: null };
              },
            }),
          }),
          select: () => ({
            eq: (field: string, value: unknown) => {
              if (field !== "session_id") {
                throw new Error(`Unexpected chat_messages select field: ${field}`);
              }
              return {
                eq: (field2: string, value2: unknown) => {
                  if (field2 !== "role" || value2 !== "assistant") {
                    throw new Error(`Unexpected chat_messages role filter: ${field2}`);
                  }
                  return {
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => {
                          const rows = assistantRows
                            .filter((row) => row.session_id === String(value))
                            .sort(
                              (a, b) =>
                                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                            );
                          return {
                            data:
                              rows[0] == null
                                ? null
                                : {
                                    id: rows[0].id,
                                    retrieval_meta: rows[0].retrieval_meta,
                                  },
                            error: null,
                          };
                        },
                      }),
                    }),
                  };
                },
              };
            },
          }),
        };
      }

      if (table === "barangays") {
        return {
          select: () => {
            return {
              eq: (field: string, value: unknown) => ({
                maybeSingle: async () => {
                  const matched =
                    field === "id"
                      ? barangayRows.find((row) => row.id === String(value))
                      : null;
                  return {
                    data: matched ? { id: matched.id, name: matched.name } : null,
                    error: null,
                  };
                },
                limit: async () => {
                  if (field === "is_active") {
                    return {
                      data: barangayRows
                        .filter((row) => row.is_active === Boolean(value))
                        .map((row) => ({ id: row.id, name: row.name })),
                      error: null,
                    };
                  }
                  return { data: [], error: null };
                },
              }),
              in: (_field: string, ids: string[]) => ({
                data: barangayRows
                  .filter((row) => ids.includes(row.id))
                  .map((row) => ({ id: row.id, name: row.name })),
                error: null,
              }),
            };
          },
        };
      }

      if (table === "aips") {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            let inFilter: { field: string; ids: string[] } | null = null;
            const applyFilters = () =>
              aipRows.filter((row) => {
                if (inFilter && !inFilter.ids.includes(String((row as Record<string, unknown>)[inFilter.field] ?? ""))) {
                  return false;
                }
                if (
                  filters.status !== undefined &&
                  row.status !== String(filters.status)
                ) {
                  return false;
                }
                if (
                  filters.barangay_id !== undefined &&
                  row.barangay_id !== filters.barangay_id
                ) {
                  return false;
                }
                if (
                  filters.city_id !== undefined &&
                  row.city_id !== filters.city_id
                ) {
                  return false;
                }
                if (
                  filters.municipality_id !== undefined &&
                  row.municipality_id !== filters.municipality_id
                ) {
                  return false;
                }
                if (
                  filters.fiscal_year !== undefined &&
                  row.fiscal_year !== filters.fiscal_year
                ) {
                  return false;
                }
                if (filters.id !== undefined && row.id !== filters.id) {
                  return false;
                }
                return true;
              });
            const builder = {
              eq: (field: string, value: unknown) => {
                filters[field] = value;
                return builder;
              },
              in: (field: string, ids: string[]) => {
                inFilter = { field, ids };
                return builder;
              },
              order: () => builder,
              limit: () => ({
                maybeSingle: async () => {
                  const matched = applyFilters()[0];
                  return {
                    data: matched
                      ? {
                          id: matched.id,
                          fiscal_year: matched.fiscal_year,
                          barangay_id: matched.barangay_id,
                          city_id: matched.city_id,
                          municipality_id: matched.municipality_id,
                          created_at: matched.created_at,
                        }
                      : null,
                    error: null,
                  };
                },
              }),
              then: (
                resolve: (
                  value: {
                    data: Array<{
                      id: string;
                      fiscal_year: number;
                      barangay_id: string | null;
                      city_id: string | null;
                      municipality_id: string | null;
                      created_at: string;
                    }>;
                    error: null;
                  }
                ) => void,
                reject?: (reason?: unknown) => void
              ) =>
                Promise.resolve({
                  data: applyFilters().map((row) => ({
                    id: row.id,
                    fiscal_year: row.fiscal_year,
                    barangay_id: row.barangay_id,
                    city_id: row.city_id,
                    municipality_id: row.municipality_id,
                    created_at: row.created_at,
                  })),
                  error: null as null,
                }).then(resolve, reject),
            };
            return builder;
          },
        };
      }

      if (table === "aip_totals") {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            let inFilter: { field: string; values: string[] } | null = null;
            const applyFilters = () =>
              totalsRows.filter((row) => {
                if (filters.aip_id !== undefined && row.aip_id !== filters.aip_id) {
                  return false;
                }
                if (
                  filters.source_label !== undefined &&
                  row.source_label !== filters.source_label
                ) {
                  return false;
                }
                if (
                  inFilter &&
                  !inFilter.values.includes(String((row as Record<string, unknown>)[inFilter.field] ?? ""))
                ) {
                  return false;
                }
                return true;
              });
            const builder = {
              eq: (field: string, value: unknown) => {
                filters[field] = value;
                return builder;
              },
              in: (field: string, values: string[]) => {
                inFilter = { field, values };
                return builder;
              },
              limit: () => ({
                maybeSingle: async () => {
                  const matched = applyFilters()[0];
                  return {
                    data: matched
                      ? {
                          aip_id: matched.aip_id,
                          total_investment_program: matched.total_investment_program,
                          page_no: matched.page_no,
                          evidence_text: matched.evidence_text,
                        }
                      : null,
                    error: null,
                  };
                },
              }),
              then: (
                resolve: (
                  value: {
                    data: Array<{
                      aip_id: string;
                      total_investment_program: number;
                      page_no: number | null;
                      evidence_text: string;
                    }>;
                    error: null;
                  }
                ) => void,
                reject?: (reason?: unknown) => void
              ) =>
                Promise.resolve({
                  data: applyFilters().map((row) => ({
                    aip_id: row.aip_id,
                    total_investment_program: row.total_investment_program,
                    page_no: row.page_no,
                    evidence_text: row.evidence_text,
                  })),
                  error: null as null,
                }).then(resolve, reject),
            };
            return builder;
          },
        };
      }

      throw new Error(`Unexpected admin table: ${table}`);
    },
  };
}

vi.mock("@/lib/domain/get-actor-context", () => ({
  getActorContext: () => mockGetActorContext(),
}));

vi.mock("@/lib/repos/chat/repo.server", () => ({
  getChatRepo: () => ({
    getSession: (...args: unknown[]) => mockGetSession(...args),
    createSession: (...args: unknown[]) => mockCreateSession(...args),
    appendUserMessage: (...args: unknown[]) => mockAppendUserMessage(...args),
  }),
}));

vi.mock("@/lib/chat/scope-resolver.server", () => ({
  resolveRetrievalScope: (...args: unknown[]) => mockResolveRetrievalScope(...args),
}));

vi.mock("@/lib/chat/pipeline-client", () => ({
  requestPipelineQueryEmbedding: (...args: unknown[]) =>
    mockRequestPipelineQueryEmbedding(...args),
  requestPipelineIntentClassify: (...args: unknown[]) =>
    mockRequestPipelineIntentClassify(...args),
  requestPipelineChatAnswer: (...args: unknown[]) => mockRequestPipelineChatAnswer(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => mockSupabaseAdmin(),
}));

vi.mock("@/lib/settings/app-settings", () => ({
  getTypedAppSetting: (...args: unknown[]) => mockGetTypedAppSetting(...args),
  isUserBlocked: (...args: unknown[]) => mockIsUserBlocked(...args),
}));

vi.mock("@/lib/chat/totals-sql-routing", () => ({
  routeSqlFirstTotals: (...args: unknown[]) => mockRouteSqlFirstTotals(...args),
  buildTotalsMissingMessage: () => "Totals missing.",
}));

vi.mock("server-only", () => ({}));

async function getRoutePostHandler() {
  if (routePostHandler) return routePostHandler;
  const routeModule = await import("@/app/api/barangay/chat/messages/route");
  routePostHandler = routeModule.POST;
  return routePostHandler;
}

async function callMessagesRoute(input: { sessionId?: string; content: string }) {
  const POST = await getRoutePostHandler();
  const request = new Request("http://localhost/api/barangay/chat/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify(input),
  });
  const response = await POST(request);
  return {
    response,
    payload: (await response.json()) as Record<string, unknown>,
  };
}

describe("aggregation routing", () => {
  beforeEach(() => {
    assistantRows = [];
    assistantCounter = 0;
    messageCounter = 0;
    rpcResponses = {
      match_aip_line_items: [
        {
          line_item_id: "line-road-1",
          aip_id: "aip-1",
          fiscal_year: 2026,
          barangay_id: "brgy-1",
          aip_ref_code: "1000-001-000-001",
          program_project_title: "Road Concreting",
          page_no: 4,
          row_no: 10,
          table_no: 1,
          distance: 0.12,
          score: 0.89,
        },
      ],
      get_top_projects: [
        {
          line_item_id: "line-1",
          aip_id: "aip-1",
          fiscal_year: 2026,
          barangay_id: "brgy-1",
          aip_ref_code: "1000-A",
          program_project_title: "Road Concreting",
          fund_source: "General Fund",
          start_date: "2026-01-01",
          end_date: "2026-12-31",
          total: 1000000,
          page_no: 1,
          row_no: 1,
          table_no: 1,
        },
      ],
      get_totals_by_sector: [
        {
          sector_code: "INFRA",
          sector_name: "Infrastructure",
          sector_total: 2500000,
          count_items: 3,
        },
      ],
      get_totals_by_fund_source: [
        {
          fund_source: "General Fund",
          fund_total: 3000000,
          count_items: 4,
        },
      ],
      compare_fiscal_year_totals: [
        {
          year_a_total: 2000000,
          year_b_total: 2500000,
          delta: 500000,
        },
      ],
    };
    lineItemsById = {
      "line-ref-1": {
        id: "line-ref-1",
        aip_id: "aip-1",
        fiscal_year: 2026,
        barangay_id: "brgy-1",
        aip_ref_code: "8000-003-002-006",
        program_project_title: "Road Safety Signages",
        implementing_agency: "Barangay Engineering Office",
        start_date: "2026-02-01",
        end_date: "2026-08-31",
        fund_source: "General Fund",
        ps: null,
        mooe: 250000,
        co: null,
        fe: null,
        total: 250000,
        expected_output: "Installed signages",
        page_no: 6,
        row_no: 12,
        table_no: 1,
      },
      "line-road-1": {
        id: "line-road-1",
        aip_id: "aip-1",
        fiscal_year: 2026,
        barangay_id: "brgy-1",
        aip_ref_code: "1000-001-000-001",
        program_project_title: "Road Concreting",
        implementing_agency: "Barangay Engineering Office",
        start_date: "2026-03-01",
        end_date: "2026-10-31",
        fund_source: "External Source (Loan)",
        ps: null,
        mooe: null,
        co: 5000000,
        fe: null,
        total: 5000000,
        expected_output: "Concreted road section",
        page_no: 4,
        row_no: 10,
        table_no: 1,
      },
    };

    mockConsumeQuotaRpc.mockReset();
    mockServerRpc.mockReset();
    mockConsoleInfo.mockClear();
    mockGetSession.mockReset();
    mockCreateSession.mockReset();
    mockAppendUserMessage.mockReset();
    mockResolveRetrievalScope.mockReset();
    mockGetActorContext.mockReset();
    mockSupabaseServer.mockReset();
    mockSupabaseAdmin.mockReset();
    mockGetTypedAppSetting.mockReset();
    mockIsUserBlocked.mockReset();
    mockRequestPipelineChatAnswer.mockReset();
    mockRequestPipelineQueryEmbedding.mockReset();
    mockRequestPipelineIntentClassify.mockReset();
    mockRouteSqlFirstTotals.mockReset();
    routePostHandler = null;
    mockRequestPipelineIntentClassify.mockResolvedValue({
      intent: "UNKNOWN",
      confidence: 0,
      top2_intent: null,
      top2_confidence: null,
      margin: 0,
      method: "none",
    });

    mockGetActorContext.mockResolvedValue({
      userId: "user-1",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });
    mockGetSession.mockResolvedValue(session);
    mockCreateSession.mockResolvedValue(session);
    mockAppendUserMessage.mockImplementation(async (_sessionId: string, content: string) => {
      messageCounter += 1;
      const message: ChatMessage = {
        id: `user-${messageCounter}`,
        sessionId: session.id,
        role: "user",
        content,
        createdAt: new Date(Date.now() + messageCounter * 1000).toISOString(),
      };
      return message;
    });

    mockResolveRetrievalScope.mockResolvedValue({
      mode: "global",
      retrievalScope: {
        mode: "global",
        targets: [],
      },
      scopeResolution: {
        mode: "global",
        requestedScopes: [],
        resolvedTargets: [],
        unresolvedScopes: [],
        ambiguousScopes: [],
      },
    });

    mockSupabaseServer.mockResolvedValue(createServerClient());
    mockSupabaseAdmin.mockImplementation(() => createAdminClient());
    mockGetTypedAppSetting.mockResolvedValue({
      maxRequests: 20,
      timeWindow: "per_hour",
    });
    mockIsUserBlocked.mockResolvedValue(false);

    mockRequestPipelineQueryEmbedding.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      model: "text-embedding-3-large",
      dimensions: 3,
    });
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "Pipeline fallback answer",
      refused: false,
      citations: [],
      retrieval_meta: {
        reason: "ok",
      },
    });

    mockRouteSqlFirstTotals.mockImplementation(
      async (input: {
        intent: string;
        resolveTotals: () => Promise<unknown>;
        resolveNormal: () => Promise<unknown>;
      }) => {
        if (input.intent === "total_investment_program") {
          return {
            path: "totals",
            value: await input.resolveTotals(),
          };
        }
        return {
          path: "normal",
          value: await input.resolveNormal(),
        };
      }
    );
  });

  it("routes Top 3 projects in FY 2026 to get_top_projects with expected filters", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "Top 3 projects in FY 2026",
    });

    expect(payload.status).toBe("answer");
    expect(
      mockServerRpc.mock.calls.some(
        ([fn, args]) =>
          fn === "get_top_projects" &&
          (args as Record<string, unknown>).p_limit === 3 &&
          (args as Record<string, unknown>).p_fiscal_year === 2026 &&
          (args as Record<string, unknown>).p_barangay_id === null
      )
    ).toBe(true);
    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "match_aip_line_items")
    ).toBe(false);
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
    expect(mockRequestPipelineQueryEmbedding).not.toHaveBeenCalled();
  });

  it("routes totals by sector query to get_totals_by_sector", async () => {
    await callMessagesRoute({
      sessionId: session.id,
      content: "Totals by sector FY 2026",
    });

    expect(
      mockServerRpc.mock.calls.some(
        ([fn, args]) =>
          fn === "get_totals_by_sector" &&
          (args as Record<string, unknown>).p_fiscal_year === 2026
      )
    ).toBe(true);
    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "match_aip_line_items")
    ).toBe(false);
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
  });

  it("builds verbose compare-years response from aip_totals with coverage and missing disclosure", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "Compare 2025 vs 2026 total budget",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as {
      content: string;
      citations?: Array<{ metadata?: Record<string, unknown> }>;
    };
    expect(assistant.content).toContain("Coverage FY2025:");
    expect(assistant.content).toContain("Coverage FY2026:");
    expect(assistant.content).toContain("Pulo: FY2025=No published AIP");
    expect(assistant.content).toContain(
      "FY2025=N/A (no published AIPs with totals)"
    );
    expect(assistant.content).not.toContain("FY2025=PHP 0.00");
    expect(assistant.content).toContain("Overall totals (covered LGUs only):");

    const aggregateMeta = assistant.citations?.[0]?.metadata ?? {};
    expect(aggregateMeta.aggregate_type).toBe("compare_years_verbose");
    expect(aggregateMeta.aggregation_source).toBe("aip_totals_total_investment_program");

    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "compare_fiscal_year_totals")
    ).toBe(false);
    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "match_aip_line_items")
    ).toBe(false);
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
  });

  it("applies explicit barangay filter for aggregate query", async () => {
    mockResolveRetrievalScope.mockResolvedValueOnce({
      mode: "named_scopes",
      retrievalScope: {
        mode: "named_scopes",
        targets: [
          {
            scope_type: "barangay",
            scope_id: "brgy-2",
            scope_name: "Canlubang",
          },
        ],
      },
      scopeResolution: {
        mode: "named_scopes",
        requestedScopes: [{ scopeType: "barangay", scopeName: "Canlubang" }],
        resolvedTargets: [{ scopeType: "barangay", scopeId: "brgy-2", scopeName: "Canlubang" }],
        unresolvedScopes: [],
        ambiguousScopes: [],
      },
    });

    await callMessagesRoute({
      sessionId: session.id,
      content: "Top 5 projects in FY 2026 in Barangay Canlubang",
    });

    expect(
      mockServerRpc.mock.calls.some(
        ([fn, args]) =>
          fn === "get_top_projects" &&
          (args as Record<string, unknown>).p_barangay_id === "brgy-2"
      )
    ).toBe(true);
  });

  it("shows missing-year disclosure for single-barangay compare query", async () => {
    mockResolveRetrievalScope.mockResolvedValueOnce({
      mode: "named_scopes",
      retrievalScope: {
        mode: "named_scopes",
        targets: [
          {
            scope_type: "barangay",
            scope_id: "brgy-3",
            scope_name: "Pulo",
          },
        ],
      },
      scopeResolution: {
        mode: "named_scopes",
        requestedScopes: [{ scopeType: "barangay", scopeName: "Pulo" }],
        resolvedTargets: [{ scopeType: "barangay", scopeId: "brgy-3", scopeName: "Pulo" }],
        unresolvedScopes: [],
        ambiguousScopes: [],
      },
    });

    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "Compare 2025 vs 2026 total budget in Barangay Pulo",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("Pulo: FY2025=No published AIP");
    expect(assistant.content).toContain(
      "FY2025=N/A (no published AIPs with totals)"
    );
    expect(assistant.content).not.toContain("FY2025=PHP 0.00");
    expect(assistant.content).toContain("Overall totals (covered LGUs only):");
    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "compare_fiscal_year_totals")
    ).toBe(false);
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
  });

  it("returns retrieval_failure refusal when line-item fact query has zero matches", async () => {
    rpcResponses.match_aip_line_items = [];

    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "How much is allocated for SomeNonexistentProject FY 2026?",
    });

    expect(payload.status).toBe("refusal");
    const assistant = payload.assistantMessage as {
      content: string;
      retrievalMeta?: {
        status?: string;
        refusalReason?: string;
        suggestions?: string[];
      };
    };
    expect(assistant.retrievalMeta?.status).toBe("refusal");
    expect(assistant.retrievalMeta?.refusalReason).toBe("retrieval_failure");
    expect(assistant.content).not.toContain("Please specify which barangay");
    expect(assistant.retrievalMeta?.suggestions?.length).toBeGreaterThan(0);
  });

  it("returns document_limitation refusal for contractor/procurement style field requests", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "Who are the contractors for Road Concreting?",
    });

    expect(payload.status).toBe("refusal");
    const assistant = payload.assistantMessage as {
      content: string;
      retrievalMeta?: {
        status?: string;
        refusalReason?: string;
      };
    };
    expect(assistant.retrievalMeta?.status).toBe("refusal");
    expect(assistant.retrievalMeta?.refusalReason).toBe("document_limitation");
    expect(assistant.content).toContain("does not list contractors, suppliers, or winning bidders");
    expect(assistant.content.toLowerCase()).not.toContain("specify scope");
  });

  it("returns city fallback clarification when city-scoped aggregate has no published city AIP", async () => {
    mockResolveRetrievalScope.mockResolvedValueOnce({
      mode: "named_scopes",
      retrievalScope: {
        mode: "named_scopes",
        targets: [
          {
            scope_type: "city",
            scope_id: "city-1",
            scope_name: "Calamba",
          },
        ],
      },
      scopeResolution: {
        mode: "named_scopes",
        requestedScopes: [{ scopeType: "city", scopeName: "Calamba" }],
        resolvedTargets: [{ scopeType: "city", scopeId: "city-1", scopeName: "Calamba" }],
        unresolvedScopes: [],
        ambiguousScopes: [],
      },
    });

    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "Top 3 projects in FY 2026 in City Calamba",
    });

    expect(payload.status).toBe("clarification");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("No published City AIP for");
    expect(assistant.content).toContain("Would you like to query across all barangays within");
    expect(assistant.content).toContain("1. Use barangays in");
    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "get_top_projects")
    ).toBe(false);
  });

  it("routes totals query with bare barangay mention as explicit scope", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "What is the Total Investment Program for FY 2026 of pulo?",
    });

    expect(payload.status).toBe("answer");
    const assistantMessage = payload.assistantMessage as { content: string };
    expect(assistantMessage.content).toContain("FY 2026");
    expect(assistantMessage.content).not.toContain("based on your account scope");

    const jsonLogs = mockConsoleInfo.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));

    const totalsLog = jsonLogs.find((entry) => entry.route === "sql_totals");
    expect(totalsLog).toBeDefined();
    expect(totalsLog?.scope_reason).toBe("explicit_barangay");
  });

  it("does not run fund-source aggregation for project-specific query", async () => {
    mockResolveRetrievalScope.mockResolvedValueOnce({
      mode: "named_scopes",
      retrievalScope: {
        mode: "named_scopes",
        targets: [
          {
            scope_type: "barangay",
            scope_id: "brgy-1",
            scope_name: "Mamatid",
          },
        ],
      },
      scopeResolution: {
        mode: "named_scopes",
        requestedScopes: [{ scopeType: "barangay", scopeName: "Mamatid" }],
        resolvedTargets: [{ scopeType: "barangay", scopeId: "brgy-1", scopeName: "Mamatid" }],
        unresolvedScopes: [],
        ambiguousScopes: [],
      },
    });

    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "In FY 2026, what is the fund source for Road Concreting in Barangay Mamatid?",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("fund source: External Source (Loan)");
    expect(assistant.content).not.toContain("Budget totals by fund source");

    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "get_totals_by_fund_source")
    ).toBe(false);
    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "match_aip_line_items")
    ).toBe(true);
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
  });

  it("runs fund-source aggregation for explicit totals query", async () => {
    mockResolveRetrievalScope.mockResolvedValueOnce({
      mode: "named_scopes",
      retrievalScope: {
        mode: "named_scopes",
        targets: [
          {
            scope_type: "barangay",
            scope_id: "brgy-1",
            scope_name: "Mamatid",
          },
        ],
      },
      scopeResolution: {
        mode: "named_scopes",
        requestedScopes: [{ scopeType: "barangay", scopeName: "Mamatid" }],
        resolvedTargets: [{ scopeType: "barangay", scopeId: "brgy-1", scopeName: "Mamatid" }],
        unresolvedScopes: [],
        ambiguousScopes: [],
      },
    });

    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "Budget totals by fund source for FY 2026 in Barangay Mamatid",
    });

    expect(payload.status).toBe("answer");
    expect(
      mockServerRpc.mock.calls.some(
        ([fn, args]) =>
          fn === "get_totals_by_fund_source" &&
          (args as Record<string, unknown>).p_fiscal_year === 2026 &&
          (args as Record<string, unknown>).p_barangay_id === "brgy-1"
      )
    ).toBe(true);
    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "match_aip_line_items")
    ).toBe(false);
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
  });

  it("uses deterministic ref fast-path before vector retrieval for line-item fact query", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "What is the fund source for Ref 8000-003-002-006 (FY 2026)?",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("Ref 8000-003-002-006");
    expect(assistant.content).toContain("fund source: General Fund");

    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "get_totals_by_fund_source")
    ).toBe(false);
    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "match_aip_line_items")
    ).toBe(false);
    expect(mockRequestPipelineQueryEmbedding).not.toHaveBeenCalled();
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
  });

  it("routes loans-vs-general-fund query to fund-source aggregation", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "How much is funded by loans vs general fund in FY 2026 across all barangays?",
    });

    expect(payload.status).toBe("answer");
    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "get_totals_by_fund_source")
    ).toBe(true);
    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "match_aip_line_items")
    ).toBe(false);
  });

  it("applies barangay filter for parenthesized aggregation scope mention", async () => {
    await callMessagesRoute({
      sessionId: session.id,
      content: "Funding source distribution for FY 2026 (Barangay Pulo)",
    });

    expect(
      mockServerRpc.mock.calls.some(
        ([fn, args]) =>
          fn === "get_totals_by_fund_source" &&
          (args as Record<string, unknown>).p_barangay_id === "brgy-3" &&
          (args as Record<string, unknown>).p_fiscal_year === 2026
      )
    ).toBe(true);
  });

  it("routes fund-source existence query to aggregation list mode", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "What fund sources exist in FY 2026?",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("Fund sources (");
    expect(assistant.content).not.toContain("Budget totals by fund source");

    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "get_totals_by_fund_source")
    ).toBe(true);
    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "match_aip_line_items")
    ).toBe(false);
  });
});
