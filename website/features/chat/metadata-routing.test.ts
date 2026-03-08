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

type StoredAssistantRow = {
  id: string;
  session_id: string;
  role: "assistant";
  content: string;
  citations: unknown;
  retrieval_meta: unknown;
  created_at: string;
};

type AipRow = {
  id: string;
  status: "published" | "draft";
  fiscal_year: number;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
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
  sector_code: string | null;
  sector_name: string | null;
  total: number | null;
  page_no: number | null;
  row_no: number | null;
  table_no: number | null;
};

type ProjectRow = {
  aip_id: string;
  category: string;
};

const session: ChatSession = {
  id: "session-1",
  userId: "user-1",
  title: "Chat",
  context: {},
  lastMessageAt: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
};

let assistantRows: StoredAssistantRow[] = [];
let assistantCounter = 0;
let messageCounter = 0;
let rpcResponses: Record<string, unknown> = {};
let aips: AipRow[] = [];
let lineItems: LineItemRow[] = [];
let projects: ProjectRow[] = [];
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
              let rows = [...lineItems];
              if (ilikeFilter) {
                const filter = ilikeFilter;
                rows = rows.filter((row) => {
                  const candidate = String((row as Record<string, unknown>)[filter.field] ?? "");
                  return candidate.toLowerCase() === filter.value.toLowerCase();
                });
              }
              for (const filter of eqFilters) {
                rows = rows.filter((row) => (row as Record<string, unknown>)[filter.field] === filter.value);
              }
              return rows;
            };
            const builder = {
              in: async (field: string, ids: string[]) => ({
                data: applyFilters().filter((row) =>
                  ids.includes(String((row as Record<string, unknown>)[field] ?? ""))
                ),
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
            };
            return builder;
          },
        };
      }
      throw new Error(`Unexpected server table: ${table}`);
    },
  };
}

function createAdminClient() {
  const barangayRows = [
    { id: "brgy-1", name: "Mamatid", is_active: true },
    { id: "brgy-2", name: "Canlubang", is_active: true },
  ];
  const cityRows = [{ id: "city-1", name: "Cabuyao", is_active: true }];
  const municipalityRows: Array<{ id: string; name: string; is_active: boolean }> = [];

  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "consume_chat_quota") {
        mockConsumeQuotaRpc(fn, args);
        return { data: { allowed: true, reason: "ok" }, error: null };
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

      if (table === "barangays" || table === "cities" || table === "municipalities") {
        const source =
          table === "barangays"
            ? barangayRows
            : table === "cities"
              ? cityRows
              : municipalityRows;
        return {
          select: () => ({
            eq: (field: string, value: unknown) => ({
              maybeSingle: async () => ({
                data:
                  source.find((row) => (row as Record<string, unknown>)[field] === value) ?? null,
                error: null,
              }),
              limit: async () => {
                if (field === "is_active") {
                  return {
                    data: source
                      .filter((row) => row.is_active === Boolean(value))
                      .map((row) => ({ id: row.id, name: row.name })),
                    error: null,
                  };
                }
                return { data: [], error: null };
              },
            }),
            in: (_field: string, ids: string[]) => ({
              data: source
                .filter((row) => ids.includes(row.id))
                .map((row) => ({ id: row.id, name: row.name })),
              error: null,
            }),
          }),
        };
      }

      if (table === "aips") {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            let inFilter: { field: string; values: string[] } | null = null;
            const applyFilters = () =>
              aips.filter((row) => {
                if (inFilter) {
                  const candidate = String((row as Record<string, unknown>)[inFilter.field] ?? "");
                  if (!inFilter.values.includes(candidate)) return false;
                }
                for (const [field, value] of Object.entries(filters)) {
                  if ((row as Record<string, unknown>)[field] !== value) return false;
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
              order: () => builder,
              limit: () => ({
                maybeSingle: async () => ({
                  data: applyFilters()[0] ?? null,
                  error: null,
                }),
              }),
              then: (
                resolve: (value: { data: unknown[]; error: null }) => void,
                reject?: (reason?: unknown) => void
              ) =>
                Promise.resolve({
                  data: applyFilters(),
                  error: null as null,
                }).then(resolve, reject),
            };
            return builder;
          },
        };
      }

      if (table === "aip_totals") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: {
                      total_investment_program: 123456,
                      page_no: 1,
                      evidence_text: "TOTAL INVESTMENT PROGRAM 123,456.00",
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "aip_line_items") {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            let inFilter: { field: string; values: string[] } | null = null;
            const apply = () =>
              lineItems.filter((row) => {
                if (inFilter) {
                  const candidate = String((row as Record<string, unknown>)[inFilter.field] ?? "");
                  if (!inFilter.values.includes(candidate)) return false;
                }
                for (const [field, value] of Object.entries(filters)) {
                  if ((row as Record<string, unknown>)[field] !== value) return false;
                }
                return true;
              });
            const builder = {
              in: (field: string, values: string[]) => {
                inFilter = { field, values };
                return builder;
              },
              eq: (field: string, value: unknown) => {
                filters[field] = value;
                return builder;
              },
              then: (
                resolve: (value: { data: unknown[]; error: null }) => void,
                reject?: (reason?: unknown) => void
              ) =>
                Promise.resolve({
                  data: apply(),
                  error: null as null,
                }).then(resolve, reject),
            };
            return builder;
          },
        };
      }

      if (table === "projects") {
        return {
          select: () => ({
            in: async (_field: string, ids: string[]) => ({
              data: projects.filter((row) => ids.includes(row.aip_id)),
              error: null,
            }),
          }),
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

function parseJsonLogs(): Array<Record<string, unknown>> {
  return mockConsoleInfo.mock.calls
    .map((call) => {
      try {
        return JSON.parse(String(call[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

describe("metadata routing", () => {
  beforeEach(() => {
    process.env.CHAT_METADATA_SQL_ROUTE_ENABLED = "true";
    process.env.CHAT_SPLIT_VERIFIER_POLICY_ENABLED = "true";
    assistantRows = [];
    assistantCounter = 0;
    messageCounter = 0;
    rpcResponses = {
      get_top_projects: [
        {
          line_item_id: "line-1",
          aip_id: "aip-brgy-1-2026",
          fiscal_year: 2026,
          barangay_id: "brgy-1",
          aip_ref_code: "1000-001-000-001",
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
      match_aip_line_items: [],
    };
    aips = [
      {
        id: "aip-brgy-1-2024",
        status: "published",
        fiscal_year: 2024,
        barangay_id: "brgy-1",
        city_id: null,
        municipality_id: null,
        created_at: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "aip-brgy-1-2026",
        status: "published",
        fiscal_year: 2026,
        barangay_id: "brgy-1",
        city_id: null,
        municipality_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "aip-brgy-2-2026",
        status: "published",
        fiscal_year: 2026,
        barangay_id: "brgy-2",
        city_id: null,
        municipality_id: null,
        created_at: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "aip-brgy-2-2025-draft",
        status: "draft",
        fiscal_year: 2025,
        barangay_id: "brgy-2",
        city_id: null,
        municipality_id: null,
        created_at: "2025-01-01T00:00:00.000Z",
      },
    ];
    lineItems = [
      {
        id: "line-1",
        aip_id: "aip-brgy-1-2026",
        fiscal_year: 2026,
        barangay_id: "brgy-1",
        aip_ref_code: "1000-001-000-001",
        program_project_title: "Road Concreting",
        implementing_agency: "Engineering Office",
        start_date: "2026-01-01",
        end_date: "2026-12-31",
        fund_source: "General Fund",
        sector_code: "INF",
        sector_name: "Infrastructure",
        total: 1000000,
        page_no: 1,
        row_no: 1,
        table_no: 1,
      },
      {
        id: "line-2",
        aip_id: "aip-brgy-1-2026",
        fiscal_year: 2026,
        barangay_id: "brgy-1",
        aip_ref_code: "1000-001-000-002",
        program_project_title: "Health Program",
        implementing_agency: "Health Office",
        start_date: "2026-02-01",
        end_date: "2026-11-30",
        fund_source: "External Source (Loan)",
        sector_code: "HEA",
        sector_name: "Health",
        total: 800000,
        page_no: 2,
        row_no: 3,
        table_no: 1,
      },
      {
        id: "line-3",
        aip_id: "aip-brgy-1-2026",
        fiscal_year: 2026,
        barangay_id: "brgy-1",
        aip_ref_code: "1000-001-000-003",
        program_project_title: "Duplicate Sector",
        implementing_agency: "Engineering Office",
        start_date: null,
        end_date: null,
        fund_source: "General Fund",
        sector_code: "INF",
        sector_name: "Infrastructure",
        total: 400000,
        page_no: 3,
        row_no: 4,
        table_no: 1,
      },
      {
        id: "line-4",
        aip_id: "aip-brgy-2-2026",
        fiscal_year: 2026,
        barangay_id: "brgy-2",
        aip_ref_code: "1000-001-000-004",
        program_project_title: "Canlubang Drainage",
        implementing_agency: "Infrastructure Office",
        start_date: null,
        end_date: null,
        fund_source: "Grant",
        sector_code: "INF",
        sector_name: "Infrastructure",
        total: 1200000,
        page_no: 1,
        row_no: 1,
        table_no: 1,
      },
    ];
    projects = [
      { aip_id: "aip-brgy-1-2026", category: "health" },
      { aip_id: "aip-brgy-1-2026", category: "infrastructure" },
      { aip_id: "aip-brgy-2-2025-draft", category: "other" },
    ];

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
      citations: [
        {
          source_id: "S1",
          snippet: "Retrieved narrative evidence.",
          chunk_id: "chunk-1",
        },
      ],
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
            value: {
              content: "Totals SQL path answer",
              citations: [{ sourceId: "S0", snippet: "Totals SQL evidence" }],
              retrievalMeta: { refused: false, reason: "ok", verifierMode: "structured" },
            },
          };
        }
        return {
          path: "normal",
          value: await input.resolveNormal(),
        };
      }
    );
  });

  it("routes available years question to metadata SQL route without pipeline fallback", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "What years are available for this barangay?",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as {
      content: string;
      retrievalMeta?: {
        verifierMode?: string;
        routeFamily?: string;
        chatStrategyCalibration?: {
          rewrite_max_user_turns: number;
          rewrite_max_assistant_turns: number;
          mixed_max_structured_tasks: number;
          mixed_max_semantic_tasks: number;
        };
      };
    };
    expect(assistant.content).toContain("Available fiscal years");
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
    expect(mockServerRpc).not.toHaveBeenCalled();
    expect(assistant.retrievalMeta?.verifierMode).toBe("structured");
    expect(assistant.retrievalMeta?.routeFamily).toBe("metadata_sql");
    expect(assistant.retrievalMeta?.chatStrategyCalibration?.rewrite_max_user_turns).toBeGreaterThan(0);
    expect(assistant.retrievalMeta?.chatStrategyCalibration?.mixed_max_structured_tasks).toBeGreaterThan(0);

    const log = parseJsonLogs().find((entry) => entry.route === "metadata_sql");
    expect(log).toBeDefined();
  });

  it("routes sectors question to metadata SQL route and deduplicates sorted values", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "What sectors exist in the AIP?",
    });

    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("Sectors");
    expect(assistant.content.indexOf("1. Health")).toBeLessThan(
      assistant.content.indexOf("2. Infrastructure")
    );
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
    expect(mockServerRpc.mock.calls.some(([fn]) => fn === "get_totals_by_sector")).toBe(false);
  });

  it("does not let semantic intent tie-break steal metadata sector enumeration", async () => {
    mockRequestPipelineIntentClassify.mockResolvedValueOnce({
      intent: "CATEGORY_AGGREGATION",
      confidence: 0.99,
      top2_intent: "UNKNOWN",
      top2_confidence: 0,
      margin: 0.99,
      method: "rule",
    });

    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "What sectors exist in the AIP?",
    });

    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("Sectors");
    expect(mockServerRpc.mock.calls.some(([fn]) => fn === "get_totals_by_sector")).toBe(false);
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
  });

  it("routes scoped fund source list to metadata SQL route", async () => {
    mockResolveRetrievalScope.mockResolvedValueOnce({
      mode: "named_scopes",
      retrievalScope: {
        mode: "named_scopes",
        targets: [
          { scope_type: "barangay", scope_id: "brgy-2", scope_name: "Canlubang" },
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

    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "List fund sources for Barangay Canlubang.",
    });

    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("Fund sources");
    expect(assistant.content).toContain("Grant");
    expect(assistant.content).not.toContain("External Source (Loan)");
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
  });

  it("keeps totals routing behavior", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "What is the total education budget for 2024?",
    });

    const assistant = payload.assistantMessage as { content: string; retrievalMeta?: { verifierMode?: string } };
    expect(assistant.content).toContain("Totals SQL path answer");
    expect(assistant.retrievalMeta?.verifierMode).toBe("structured");
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
  });

  it("keeps aggregation routing behavior", async () => {
    await callMessagesRoute({
      sessionId: session.id,
      content: "Show top 5 projects this year.",
    });

    expect(mockServerRpc.mock.calls.some(([fn]) => fn === "get_top_projects")).toBe(true);
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
  });

  it("returns clean no-data response for empty implementing agencies result", async () => {
    lineItems = [];
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "List implementing agencies for FY 2026.",
    });

    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("No implementing agencies were found");
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
  });

  it("returns project categories from published scoped AIPs only", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "List project categories for this barangay.",
    });

    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("Project categories");
    expect(assistant.content).toContain("Health");
    expect(assistant.content).toContain("Infrastructure");
    expect(assistant.content).not.toContain("Other");
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
  });

  it("does not use metadata route for mixed metadata+narrative question", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "What sectors exist and explain the health sector.",
    });

    expect(mockRequestPipelineChatAnswer).toHaveBeenCalledTimes(1);
    const logs = parseJsonLogs();
    expect(logs.some((entry) => entry.route === "metadata_sql")).toBe(false);
    const assistant = payload.assistantMessage as { retrievalMeta?: { verifierMode?: string } };
    expect(assistant.retrievalMeta?.verifierMode).toBe("retrieval");
  });
});
