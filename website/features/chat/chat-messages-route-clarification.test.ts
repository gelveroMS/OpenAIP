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
const mockMatchLineItemsRpc = vi.fn();
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

const session: ChatSession = {
  id: "session-1",
  userId: "user-1",
  title: "Chat",
  context: {},
  lastMessageAt: null,
  createdAt: "2026-02-26T00:00:00.000Z",
  updatedAt: "2026-02-26T00:00:00.000Z",
};

let assistantRows: StoredAssistantRow[] = [];
let messageCounter = 0;
let assistantCounter = 0;
let lineItemsById: Record<string, LineItemRow> = {};
let matchRows: Array<Record<string, unknown>> = [];

function createServerClient() {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "match_aip_line_items") {
        mockMatchLineItemsRpc(fn, args);
        return { data: matchRows, error: null };
      }
      throw new Error(`Unexpected server rpc: ${fn}`);
    },
    from: (table: string) => {
      if (table !== "aip_line_items") {
        throw new Error(`Unexpected server table: ${table}`);
      }

      return {
        select: () => ({
          in: async (_field: string, ids: string[]) => ({
            data: ids.map((id) => lineItemsById[id]).filter(Boolean),
            error: null,
          }),
          eq: (_field: string, id: string) => ({
            maybeSingle: async () => ({
              data: lineItemsById[id] ?? null,
              error: null,
            }),
          }),
        }),
      };
    },
  };
}

function createAdminClient() {
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
                return {
                  data: row,
                  error: null,
                };
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
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "brgy-1", name: "Mamatid" },
                error: null,
              }),
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

let routePostHandler: typeof import("@/app/api/barangay/chat/messages/route").POST | null = null;

async function getRoutePostHandler() {
  if (routePostHandler) {
    return routePostHandler;
  }
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

describe("chat messages clarification state machine", () => {
  beforeEach(() => {
    assistantRows = [];
    messageCounter = 0;
    assistantCounter = 0;
    mockConsoleInfo.mockClear();
    mockConsumeQuotaRpc.mockReset();
    mockMatchLineItemsRpc.mockReset();
    mockRequestPipelineQueryEmbedding.mockReset();
    mockRequestPipelineIntentClassify.mockReset();
    mockRequestPipelineChatAnswer.mockReset();
    mockGetSession.mockReset();
    mockCreateSession.mockReset();
    mockAppendUserMessage.mockReset();
    mockResolveRetrievalScope.mockReset();
    mockGetActorContext.mockReset();
    mockSupabaseServer.mockReset();
    mockSupabaseAdmin.mockReset();
    mockGetTypedAppSetting.mockReset();
    mockIsUserBlocked.mockReset();
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

    lineItemsById = {
      "line-1": {
        id: "line-1",
        aip_id: "aip-1",
        fiscal_year: 2026,
        barangay_id: "brgy-1",
        aip_ref_code: "3000-A",
        program_project_title: "Honoraria - Administrative",
        implementing_agency: "Barangay Council",
        start_date: "2026-01-01",
        end_date: "2026-12-31",
        fund_source: "General Fund",
        ps: null,
        mooe: 50000,
        co: null,
        fe: null,
        total: 50000,
        expected_output: "Honoraria release",
        page_no: 1,
        row_no: 1,
        table_no: 1,
      },
      "line-2": {
        id: "line-2",
        aip_id: "aip-1",
        fiscal_year: 2026,
        barangay_id: "brgy-1",
        aip_ref_code: "3000-B",
        program_project_title: "Honoraria - Infrastructure",
        implementing_agency: "Barangay Engineering",
        start_date: "2026-02-01",
        end_date: "2026-11-30",
        fund_source: "General Fund",
        ps: null,
        mooe: 45000,
        co: null,
        fe: null,
        total: 45000,
        expected_output: "Infrastructure support",
        page_no: 1,
        row_no: 2,
        table_no: 1,
      },
    };

    matchRows = [
      {
        line_item_id: "line-1",
        aip_id: "aip-1",
        fiscal_year: 2026,
        barangay_id: "brgy-1",
        aip_ref_code: "3000-A",
        program_project_title: "Honoraria - Administrative",
        page_no: 1,
        row_no: 1,
        table_no: 1,
        distance: 0.2,
        score: 0.8333,
      },
      {
        line_item_id: "line-2",
        aip_id: "aip-1",
        fiscal_year: 2026,
        barangay_id: "brgy-1",
        aip_ref_code: "3000-B",
        program_project_title: "Honoraria - Infrastructure",
        page_no: 1,
        row_no: 2,
        table_no: 1,
        distance: 0.21,
        score: 0.8264,
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
        sessionId: "session-1",
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

  it("returns clarification status with structured options for vague line-item query", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: "session-1",
      content: "How much is the honoraria in FY 2026 and what's the schedule?",
    });

    expect(payload.status).toBe("clarification");
    const clarification = payload.clarification as Record<string, unknown>;
    expect(clarification.kind).toBe("line_item_disambiguation");
    expect(Array.isArray(clarification.options)).toBe(true);
    expect((clarification.options as unknown[]).length).toBeGreaterThanOrEqual(2);

    const assistant = payload.assistantMessage as {
      retrievalMeta?: { status?: string; refused?: boolean; refusalReason?: string };
    };
    expect(assistant.retrievalMeta?.status).toBe("clarification");
    expect(assistant.retrievalMeta?.refused).toBe(false);
    expect(assistant.retrievalMeta?.refusalReason).toBeUndefined();

    const clarificationLog = parseJsonLogs().find(
      (entry) => entry.intent === "clarification_needed" && entry.route === "row_sql"
    );
    expect(clarificationLog).toBeDefined();
    expect(clarificationLog?.answered).toBe(false);
    expect(clarificationLog && "refusal_reason" in clarificationLog).toBe(false);
  });

  it("returns document limitation refusal for contractor queries before scope ambiguity handling", async () => {
    const { payload } = await callMessagesRoute({
      sessionId: "session-1",
      content: "Who are the contractors for Construction of 3-Storey Barangay Hall?",
    });

    expect(payload.status).toBe("refusal");
    const assistant = payload.assistantMessage as {
      content: string;
      retrievalMeta?: { status?: string; refusalReason?: string };
    };
    expect(assistant.retrievalMeta?.status).toBe("refusal");
    expect(assistant.retrievalMeta?.refusalReason).toBe("document_limitation");
    expect(assistant.content).toContain("does not list contractors, suppliers, or winning bidders");
    expect(assistant.content.toLowerCase()).not.toContain("couldn't match the requested barangay/city");

    expect(mockResolveRetrievalScope).not.toHaveBeenCalled();
  });

  it("resolves numeric selection using pending clarification without vector rerun", async () => {
    await callMessagesRoute({
      sessionId: "session-1",
      content: "How much is the honoraria in FY 2026 and what's the schedule?",
    });

    const { payload } = await callMessagesRoute({
      sessionId: "session-1",
      content: "1",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("total allocation: PHP 50,000.00");
    expect(assistant.content).toContain("schedule: 2026-01-01 to 2026-12-31");
    expect(mockRequestPipelineQueryEmbedding).toHaveBeenCalledTimes(1);
    expect(mockMatchLineItemsRpc).toHaveBeenCalledTimes(1);

    const jsonLogs = parseJsonLogs();
    expect(jsonLogs.some((entry) => entry.event === "clarification_resolved")).toBe(true);
  });

  it("resolves ref selection against pending clarification options", async () => {
    await callMessagesRoute({
      sessionId: "session-1",
      content: "How much is the honoraria in FY 2026 and what's the schedule?",
    });

    const { payload } = await callMessagesRoute({
      sessionId: "session-1",
      content: "Ref 3000-B",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("Ref 3000-B");
    expect(assistant.content).toContain("total allocation: PHP 45,000.00");
  });

  it("returns clarification reminder for short ambiguous retry while pending", async () => {
    await callMessagesRoute({
      sessionId: "session-1",
      content: "How much is the honoraria in FY 2026 and what's the schedule?",
    });

    const { payload } = await callMessagesRoute({
      sessionId: "session-1",
      content: "hmm",
    });

    expect(payload.status).toBe("clarification");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("Please reply with 1-3, or type the Ref code.");
  });

  it("does not trap complaint-like replies inside the clarification loop", async () => {
    await callMessagesRoute({
      sessionId: "session-1",
      content: "How much is the honoraria in FY 2026 and what's the schedule?",
    });

    mockRequestPipelineIntentClassify.mockResolvedValueOnce({
      intent: "COMPLAINT",
      confidence: 0.98,
      top2_intent: null,
      top2_confidence: null,
      margin: 0.98,
      method: "semantic",
    });

    const { payload } = await callMessagesRoute({
      sessionId: "session-1",
      content: "this is not the answer",
    });

    expect(payload.status).not.toBe("clarification");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).not.toContain("Please reply with 1-3, or type the Ref code.");
    expect(mockRequestPipelineChatAnswer).toHaveBeenCalledTimes(1);
  });

  it("exits clarification loop on explicit cancel phrase", async () => {
    await callMessagesRoute({
      sessionId: "session-1",
      content: "How much is the honoraria in FY 2026 and what's the schedule?",
    });

    const { payload } = await callMessagesRoute({
      sessionId: "session-1",
      content: "none of the above",
    });

    expect(payload.status).toBe("answer");
    const assistant = payload.assistantMessage as { content: string };
    expect(assistant.content).toContain("Okay - please restate the project title or provide the Ref code.");
    expect(mockRequestPipelineQueryEmbedding).toHaveBeenCalledTimes(1);
    expect(mockMatchLineItemsRpc).toHaveBeenCalledTimes(1);
  });
});
