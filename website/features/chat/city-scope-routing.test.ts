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
  id: "session-city-1",
  userId: "user-1",
  title: "City Chat",
  context: {},
  lastMessageAt: null,
  createdAt: "2026-02-28T00:00:00.000Z",
  updatedAt: "2026-02-28T00:00:00.000Z",
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
  sector_code?: string | null;
  sector_name?: string | null;
  total: number | null;
  page_no: number | null;
  row_no: number | null;
  table_no: number | null;
};

let assistantRows: StoredAssistantRow[] = [];
let assistantCounter = 0;
let messageCounter = 0;
let routePostHandler: typeof import("@/app/api/barangay/chat/messages/route").POST | null = null;

let aipRows: Array<{
  id: string;
  status: string;
  fiscal_year: number;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
  created_at: string;
}> = [];

let lineItemsById: Record<string, LineItemRow> = {};

let rpcResponses: Record<string, unknown> = {};
let totalsRows: Array<{
  aip_id: string;
  source_label: string;
  total_investment_program: number;
  page_no: number | null;
  evidence_text: string;
}> = [];

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
      if (table !== "aip_line_items") {
        return {
          select: () => ({
            in: async () => ({ data: [], error: null }),
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }

      return {
        select: () => {
          const eqFilters: Array<{ field: string; value: unknown }> = [];
          const inFilters: Array<{ field: string; values: unknown[] }> = [];
          const ilikeFilters: Array<{ field: string; value: string }> = [];
          const notNullFields: string[] = [];
          let orderField: string | null = null;
          let orderAscending = true;

          const applyFilters = () => {
            let rows = Object.values(lineItemsById) as Array<Record<string, unknown>>;
            for (const filter of eqFilters) {
              rows = rows.filter((row) => row[filter.field] === filter.value);
            }
            for (const filter of inFilters) {
              rows = rows.filter((row) => filter.values.includes(row[filter.field]));
            }
            for (const filter of ilikeFilters) {
              rows = rows.filter((row) =>
                String(row[filter.field] ?? "").toLowerCase() === filter.value.toLowerCase()
              );
            }
            for (const field of notNullFields) {
              rows = rows.filter((row) => row[field] !== null && row[field] !== undefined);
            }
            if (orderField) {
              rows = rows.sort((a, b) => {
                const aValue = a[orderField!];
                const bValue = b[orderField!];
                const aNum = typeof aValue === "number" ? aValue : Number(aValue ?? 0);
                const bNum = typeof bValue === "number" ? bValue : Number(bValue ?? 0);
                if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
                  return orderAscending ? aNum - bNum : bNum - aNum;
                }
                const aText = String(aValue ?? "");
                const bText = String(bValue ?? "");
                return orderAscending ? aText.localeCompare(bText) : bText.localeCompare(aText);
              });
            }
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
            ilike: (field: string, value: string) => {
              ilikeFilters.push({ field, value });
              return builder;
            },
            not: (field: string, operator: string, value: unknown) => {
              if (operator === "is" && value === null) {
                notNullFields.push(field);
              }
              return builder;
            },
            order: (field: string, options?: { ascending?: boolean }) => {
              orderField = field;
              orderAscending = options?.ascending ?? true;
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
            then: (
              resolve: (value: { data: unknown[]; error: null }) => void,
              reject?: (reason?: unknown) => void
            ) => Promise.resolve({ data: applyFilters(), error: null as null }).then(resolve, reject),
          };

          return builder;
        },
      };
    },
  };
}

function createAdminClient() {
  const cities = [{ id: "city-1", name: "Cabuyao City", is_active: true }];
  const barangays = [
    { id: "brgy-1", name: "Mamatid", city_id: "city-1", is_active: true },
    { id: "brgy-3", name: "Pulo", city_id: "city-1", is_active: true },
  ];

  function createSimpleSelectBuilder(rows: Array<Record<string, unknown>>) {
    const eqFilters: Array<{ field: string; value: unknown }> = [];
    const inFilters: Array<{ field: string; values: unknown[] }> = [];
    let orderField: string | null = null;
    let orderAscending = true;
    let limitCount: number | null = null;

    const applyFilters = () => {
      let filtered = rows;
      for (const filter of eqFilters) {
        filtered = filtered.filter((row) => row[filter.field] === filter.value);
      }
      for (const filter of inFilters) {
        filtered = filtered.filter((row) => filter.values.includes(row[filter.field]));
      }
      if (orderField) {
        filtered = [...filtered].sort((a, b) => {
          const aValue = a[orderField!];
          const bValue = b[orderField!];
          const aNum = typeof aValue === "number" ? aValue : Number(aValue ?? 0);
          const bNum = typeof bValue === "number" ? bValue : Number(bValue ?? 0);
          if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
            return orderAscending ? aNum - bNum : bNum - aNum;
          }
          const aText = String(aValue ?? "");
          const bText = String(bValue ?? "");
          return orderAscending ? aText.localeCompare(bText) : bText.localeCompare(aText);
        });
      }
      if (limitCount !== null) {
        filtered = filtered.slice(0, limitCount);
      }
      return filtered;
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
      order: (field: string, options?: { ascending?: boolean }) => {
        orderField = field;
        orderAscending = options?.ascending ?? true;
        return builder;
      },
      limit: (count: number) => {
        limitCount = count;
        return builder;
      },
      maybeSingle: async () => ({
        data: applyFilters()[0] ?? null,
        error: null,
      }),
      then: (
        resolve: (value: { data: unknown[]; error: null }) => void,
        reject?: (reason?: unknown) => void
      ) => Promise.resolve({ data: applyFilters(), error: null as null }).then(resolve, reject),
    };

    return builder;
  }

  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "consume_chat_quota") {
        mockConsumeQuotaRpc(fn, args);
        return {
          data: { allowed: true, reason: "ok" },
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
              if (field !== "session_id") throw new Error(`Unexpected chat_messages field: ${field}`);
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
                                : { id: rows[0].id, retrieval_meta: rows[0].retrieval_meta },
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

      if (table === "cities") {
        return { select: () => createSimpleSelectBuilder(cities as Array<Record<string, unknown>>) };
      }

      if (table === "barangays") {
        return { select: () => createSimpleSelectBuilder(barangays as Array<Record<string, unknown>>) };
      }

      if (table === "aips") {
        return { select: () => createSimpleSelectBuilder(aipRows as Array<Record<string, unknown>>) };
      }

      if (table === "aip_totals") {
        return { select: () => createSimpleSelectBuilder(totalsRows as Array<Record<string, unknown>>) };
      }

      if (table === "aip_line_items") {
        return {
          select: () =>
            createSimpleSelectBuilder(
              Object.values(lineItemsById).map((row) => row as unknown as Record<string, unknown>)
            ),
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
  requestPipelineQueryEmbedding: (...args: unknown[]) => mockRequestPipelineQueryEmbedding(...args),
  requestPipelineIntentClassify: (...args: unknown[]) => mockRequestPipelineIntentClassify(...args),
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

describe("city scope routing", () => {
  beforeEach(() => {
    assistantRows = [];
    assistantCounter = 0;
    messageCounter = 0;
    routePostHandler = null;
    mockConsoleInfo.mockClear();
    mockConsumeQuotaRpc.mockReset();
    mockServerRpc.mockReset();
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
    mockRequestPipelineIntentClassify.mockResolvedValue({
      intent: "UNKNOWN",
      confidence: 0,
      top2_intent: null,
      top2_confidence: null,
      margin: 0,
      method: "none",
    });

    aipRows = [
      {
        id: "city-aip-2026",
        status: "published",
        fiscal_year: 2026,
        barangay_id: null,
        city_id: "city-1",
        municipality_id: null,
        created_at: "2026-01-02T00:00:00.000Z",
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
        id: "aip-brgy-3-2026",
        status: "published",
        fiscal_year: 2026,
        barangay_id: "brgy-3",
        city_id: null,
        municipality_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];

    lineItemsById = {
      "city-line-1": {
        id: "city-line-1",
        aip_id: "city-aip-2026",
        fiscal_year: 2026,
        barangay_id: null,
        aip_ref_code: "9000-001-000-001",
        program_project_title: "City Drainage Improvement",
        implementing_agency: "City Engineering",
        start_date: "2026-01-01",
        end_date: "2026-12-31",
        fund_source: "General Fund",
        sector_code: "INFRA",
        sector_name: "Infrastructure",
        total: 8000000,
        page_no: 2,
        row_no: 1,
        table_no: 1,
      },
      "city-line-2": {
        id: "city-line-2",
        aip_id: "city-aip-2026",
        fiscal_year: 2026,
        barangay_id: null,
        aip_ref_code: "9000-001-000-002",
        program_project_title: "City Health Outreach",
        implementing_agency: "City Health Office",
        start_date: "2026-02-01",
        end_date: "2026-11-30",
        fund_source: "General Fund",
        sector_code: "HLTH",
        sector_name: "Health",
        total: 3000000,
        page_no: 2,
        row_no: 2,
        table_no: 1,
      },
    };

    rpcResponses = {
      get_totals_by_sector_for_barangays: [
        { sector_code: "INFRA", sector_name: "Infrastructure", sector_total: 10000000, count_items: 2 },
      ],
      get_top_projects_for_barangays: [
        {
          line_item_id: "line-b1",
          aip_id: "aip-brgy-1-2026",
          fiscal_year: 2026,
          barangay_id: "brgy-1",
          aip_ref_code: "8000-001-000-001",
          program_project_title: "Barangay Road Rehab",
          fund_source: "General Fund",
          start_date: "2026-01-01",
          end_date: "2026-09-30",
          total: 2000000,
          page_no: 3,
          row_no: 1,
          table_no: 1,
        },
      ],
      get_totals_by_fund_source_for_barangays: [
        { fund_source: "General Fund", fund_total: 12000000, count_items: 3 },
      ],
      compare_fiscal_year_totals_for_barangays: [
        { year_a_total: 5000000, year_b_total: 12000000, delta: 7000000 },
      ],
    };

    totalsRows = [
      {
        aip_id: "city-aip-2026",
        source_label: "total_investment_program",
        total_investment_program: 512345678.9,
        page_no: 7,
        evidence_text: "TOTAL INVESTMENT PROGRAM 512,345,678.90",
      },
      {
        aip_id: "aip-brgy-1-2026",
        source_label: "total_investment_program",
        total_investment_program: 100000000.5,
        page_no: 8,
        evidence_text: "TOTAL INVESTMENT PROGRAM 100,000,000.50",
      },
      {
        aip_id: "aip-brgy-3-2026",
        source_label: "total_investment_program",
        total_investment_program: 200000000.25,
        page_no: 9,
        evidence_text: "TOTAL INVESTMENT PROGRAM 200,000,000.25",
      },
    ];

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
      retrieval_meta: { reason: "ok" },
    });

    mockRouteSqlFirstTotals.mockImplementation(
      async (input: {
        intent: string;
        resolveTotals: () => Promise<unknown>;
        resolveNormal: () => Promise<unknown>;
      }) => {
        if (input.intent === "total_investment_program") {
          return { path: "totals", value: await input.resolveTotals() };
        }
        return { path: "normal", value: await input.resolveNormal() };
      }
    );
  });

  it("uses city AIP for city-scoped aggregation when city AIP exists", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "Budget totals by sector FY 2026 in Cabuyao City",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("City of Cabuyao");
    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "get_totals_by_sector")
    ).toBe(false);
  });

  it("returns clarification when city AIP is missing for city-scoped aggregation", async () => {
    aipRows = aipRows.filter((row) => row.city_id !== "city-1");

    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "Budget totals by sector FY 2026 in Cabuyao City",
    });

    expect(payload.status).toBe("clarification");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("No published City AIP for");
    expect(assistant.content).toContain("1. Use barangays in City of Cabuyao");

    const assistantWithMeta = payload.assistantMessage as {
      retrievalMeta?: {
        clarification?: {
          context?: Record<string, unknown>;
        };
      };
    };
    const context = assistantWithMeta.retrievalMeta?.clarification?.context ?? {};
    expect(context.cityId).toBe("city-1");
    expect(context.cityName).toBe("Cabuyao City");
    expect(context.fiscalYearParsed).toBe(2026);
    expect(context.originalIntent).toBe("aggregate_totals_by_sector");
  });

  it("uses barangays-in-city RPC after selecting fallback option 1 with coverage/log metadata", async () => {
    aipRows = aipRows.filter((row) => row.city_id !== "city-1");

    await callMessagesRoute({
      sessionId: session.id,
      content: "Budget totals by sector FY 2026 in Cabuyao City",
    });

    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "1",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("All barangays in City of Cabuyao");
    expect(assistant.content).toContain("Coverage:");
    expect(
      mockServerRpc.mock.calls.some(
        ([fn, args]) =>
          fn === "get_totals_by_sector_for_barangays" &&
          Array.isArray((args as Record<string, unknown>).p_barangay_ids)
      )
    ).toBe(true);

    const assistantWithCitations = payload.assistantMessage as {
      citations?: Array<{ metadata?: Record<string, unknown> }>;
    };
    const aggregateMeta = assistantWithCitations.citations?.[0]?.metadata ?? {};
    expect(aggregateMeta.fallback_mode).toBe("barangays_in_city");
    expect(aggregateMeta.city_id).toBe("city-1");
    expect(aggregateMeta.barangay_ids_count).toBe(2);
    expect(Array.isArray(aggregateMeta.coverage_barangays)).toBe(true);
    expect(aggregateMeta.aggregation_source).toBe("aip_line_items");

    const logs = mockConsoleInfo.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    const fallbackLog = logs.find(
      (entry) => entry.route === "aggregate_sql" && entry.fallback_mode === "barangays_in_city"
    );
    expect(fallbackLog).toBeDefined();
    expect(fallbackLog?.scope_reason).toBe("fallback_barangays_in_city");
    expect(fallbackLog?.city_id).toBe("city-1");
    expect(fallbackLog?.aggregation_source).toBe("aip_line_items");
  });

  it("uses city totals when explicit city totals query has a published city AIP", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "What is the Total Investment Program for FY 2026 in Cabuyao City?",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("City of Cabuyao");
    expect(assistant.content).not.toContain("based on your account scope");
  });

  it("uses aip_totals rows for city totals fallback sum and discloses coverage", async () => {
    aipRows = aipRows.filter((row) => row.city_id !== "city-1");

    await callMessagesRoute({
      sessionId: session.id,
      content: "What is the Total Investment Program for FY 2026 in Cabuyao City?",
    });

    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "1",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("No published City AIP for City of Cabuyao (FY 2026).");
    expect(assistant.content).toContain("Coverage:");
    expect(assistant.content).toContain("Total Investment Program (sum of barangay totals)");
    expect(assistant.content).toContain("PHP 300,000,000.75");

    const assistantWithCitations = payload.assistantMessage as {
      citations?: Array<{ metadata?: Record<string, unknown> }>;
    };
    const metadata = assistantWithCitations.citations?.[0]?.metadata ?? {};
    expect(metadata.aggregation_source).toBe("aip_totals_total_investment_program");
    expect(metadata.fallback_mode).toBe("barangays_in_city");
    expect(metadata.covered_barangay_ids_count).toBe(2);

    const logs = mockConsoleInfo.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    const totalsFallbackLog = logs.find(
      (entry) => entry.route === "sql_totals" && entry.fallback_mode === "barangays_in_city"
    );
    expect(totalsFallbackLog).toBeDefined();
    expect(totalsFallbackLog?.scope_reason).toBe("fallback_barangays_in_city");
    expect(totalsFallbackLog?.aggregation_source).toBe("aip_totals_total_investment_program");
  });

  it("returns city fallback clarification for city compare-years when a compared city AIP year is missing", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "Compare 2025 vs 2026 total budget in Cabuyao City",
    });

    expect(payload.status).toBe("clarification");
    const assistant = payload.assistantMessage as {
      content: string;
      retrievalMeta?: {
        clarification?: { context?: Record<string, unknown> };
      };
    };
    expect(assistant.content).toContain("No published City AIP for");
    expect(assistant.content).toContain("1. Use barangays in City of Cabuyao");

    const context = assistant.retrievalMeta?.clarification?.context ?? {};
    expect(context.originalIntent).toBe("aggregate_compare_years");
    expect(context.yearA).toBe(2025);
    expect(context.yearB).toBe(2026);
  });

  it("executes compare-years city fallback with aip_totals coverage disclosure after selecting option 1", async () => {
    aipRows = [
      {
        id: "aip-brgy-1-2025",
        status: "published",
        fiscal_year: 2025,
        barangay_id: "brgy-1",
        city_id: null,
        municipality_id: null,
        created_at: "2025-01-01T00:00:00.000Z",
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
        id: "aip-brgy-3-2026",
        status: "published",
        fiscal_year: 2026,
        barangay_id: "brgy-3",
        city_id: null,
        municipality_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    totalsRows = [
      {
        aip_id: "aip-brgy-1-2025",
        source_label: "total_investment_program",
        total_investment_program: 90000000,
        page_no: 8,
        evidence_text: "TOTAL INVESTMENT PROGRAM 90,000,000.00",
      },
      {
        aip_id: "aip-brgy-1-2026",
        source_label: "total_investment_program",
        total_investment_program: 110000000,
        page_no: 8,
        evidence_text: "TOTAL INVESTMENT PROGRAM 110,000,000.00",
      },
      {
        aip_id: "aip-brgy-3-2026",
        source_label: "total_investment_program",
        total_investment_program: 200000000.25,
        page_no: 9,
        evidence_text: "TOTAL INVESTMENT PROGRAM 200,000,000.25",
      },
    ];

    await callMessagesRoute({
      sessionId: session.id,
      content: "Compare 2025 vs 2026 total budget in Cabuyao City",
    });

    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "1",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as {
      content: string;
      citations?: Array<{ metadata?: Record<string, unknown> }>;
    };
    expect(assistant.content).toContain("Fiscal year comparison (All barangays in City of Cabuyao):");
    expect(assistant.content).toContain("Coverage FY2025:");
    expect(assistant.content).toContain("Coverage FY2026:");
    expect(assistant.content).toContain("Pulo: FY2025=No published AIP");
    expect(assistant.content).toContain("Overall totals (covered LGUs only):");

    const metadata = assistant.citations?.[0]?.metadata ?? {};
    expect(metadata.aggregate_type).toBe("compare_years_verbose");
    expect(metadata.aggregation_source).toBe("aip_totals_total_investment_program");
    expect(metadata.scope_mode).toBe("barangays_in_city");

    expect(
      mockServerRpc.mock.calls.some(([fn]) => fn === "compare_fiscal_year_totals_for_barangays")
    ).toBe(false);

    const logs = mockConsoleInfo.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    const fallbackLog = logs.find(
      (entry) =>
        entry.route === "aggregate_sql" &&
        entry.intent === "aggregate_compare_years" &&
        entry.fallback_mode === "barangays_in_city"
    );
    expect(fallbackLog).toBeDefined();
    expect(fallbackLog?.scope_reason).toBe("fallback_barangays_in_city");
    expect(fallbackLog?.aggregation_source).toBe("aip_totals_total_investment_program");
  });

  it("returns grounded no-data message when city and barangay AIPs are unavailable for FY", async () => {
    aipRows = [];
    totalsRows = totalsRows.filter((row) => row.aip_id === "city-aip-2026");

    await callMessagesRoute({
      sessionId: session.id,
      content: "What is the Total Investment Program for FY 2026 in Cabuyao City?",
    });

    const { payload } = await callMessagesRoute({
      sessionId: session.id,
      content: "1",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("No published City AIP and no published Barangay AIPs found");
    expect(assistant.content).toContain("Coverage:");
    expect(assistant.content).toContain("Please try another fiscal year.");
  });
});
