import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const mockListMessages = vi.fn();
const mockAppendUserMessage = vi.fn();
const mockGetTypedAppSetting = vi.fn();
const mockIsUserBlocked = vi.fn();
const mockConsoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

let routePostHandler: typeof import("@/app/api/barangay/chat/messages/route").POST | null = null;

type StoredAssistantRow = {
  id: string;
  session_id: string;
  role: "assistant";
  content: string;
  citations: unknown;
  retrieval_meta: unknown;
  created_at: string;
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
let userRows: ChatMessage[] = [];
let assistantCounter = 0;
let userCounter = 0;

function createServerClient() {
  return {
    from: (_table: string) => ({
      select: () => ({
        in: async () => ({ data: [], error: null }),
      }),
    }),
    rpc: async () => ({ data: [], error: null }),
  };
}

function createAdminClient() {
  return {
    rpc: async (fn: string) => {
      if (fn === "consume_chat_quota") {
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
              if (field !== "session_id") throw new Error(`Unexpected field: ${field}`);
              return {
                eq: (field2: string, value2: unknown) => {
                  if (field2 !== "role" || value2 !== "assistant") {
                    throw new Error(`Unexpected role filter: ${field2}`);
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
    listMessages: (...args: unknown[]) => mockListMessages(...args),
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

describe("contextual rewrite routing", () => {
  beforeEach(() => {
    process.env.CHAT_CONTEXTUAL_REWRITE_ENABLED = "true";
    process.env.CHAT_METADATA_SQL_ROUTE_ENABLED = "true";
    process.env.CHAT_SPLIT_VERIFIER_POLICY_ENABLED = "true";
    assistantRows = [];
    userRows = [];
    assistantCounter = 0;
    userCounter = 0;
    routePostHandler = null;

    mockConsoleInfo.mockClear();
    mockGetActorContext.mockReset();
    mockResolveRetrievalScope.mockReset();
    mockRequestPipelineQueryEmbedding.mockReset();
    mockRequestPipelineIntentClassify.mockReset();
    mockRequestPipelineChatAnswer.mockReset();
    mockSupabaseServer.mockReset();
    mockSupabaseAdmin.mockReset();
    mockRouteSqlFirstTotals.mockReset();
    mockGetSession.mockReset();
    mockCreateSession.mockReset();
    mockListMessages.mockReset();
    mockAppendUserMessage.mockReset();
    mockGetTypedAppSetting.mockReset();
    mockIsUserBlocked.mockReset();

    mockGetActorContext.mockResolvedValue({
      userId: "user-1",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });
    mockGetSession.mockResolvedValue(session);
    mockCreateSession.mockResolvedValue(session);
    mockAppendUserMessage.mockImplementation(async (_sessionId: string, content: string) => {
      userCounter += 1;
      const row: ChatMessage = {
        id: `user-${userCounter}`,
        sessionId: session.id,
        role: "user",
        content,
        createdAt: new Date(Date.now() + userCounter * 1000).toISOString(),
      };
      userRows.push(row);
      return row;
    });
    mockListMessages.mockImplementation(async () => userRows);

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
    mockRequestPipelineIntentClassify.mockResolvedValue({
      intent: "UNKNOWN",
      confidence: 0,
      top2_intent: null,
      top2_confidence: null,
      margin: 0,
      method: "none",
    });
    mockRouteSqlFirstTotals.mockImplementation(
      async (input: {
        intent: string;
        resolveTotals: () => Promise<unknown>;
        resolveNormal: () => Promise<unknown>;
      }) => ({
        path: "normal",
        value: await input.resolveNormal(),
      })
    );
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "Fallback answer with citation [S1]",
      refused: false,
      citations: [
        {
          source_id: "S1",
          snippet: "Fallback evidence snippet.",
          chunk_id: "chunk-1",
        },
      ],
      retrieval_meta: {
        reason: "ok",
      },
    });
  });

  afterEach(() => {
    process.env.CHAT_CONTEXTUAL_REWRITE_ENABLED = "false";
  });

  it("rewrites follow-up citation request before fallback retrieval", async () => {
    await callMessagesRoute({
      sessionId: session.id,
      content: "What does the AIP say about drainage rehabilitation in Barangay Mamatid?",
    });

    await callMessagesRoute({
      sessionId: session.id,
      content: "Can you cite it?",
    });

    const rewriteLog = mockConsoleInfo.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .find((entry) => entry.event === "contextual_query_rewrite" && entry.rewrite_triggered === true);

    expect(rewriteLog).toBeDefined();
    expect(String(rewriteLog?.rewritten_query_preview ?? "").toLowerCase()).toContain(
      "drainage rehabilitation"
    );
    expect(String(rewriteLog?.rewritten_query_preview ?? "").toLowerCase()).toContain("citations");
  });

  it("rewrites shorthand scope follow-up using the most recent domain anchor", async () => {
    await callMessagesRoute({
      sessionId: session.id,
      content: "Total amount per fund source in FY 2026.",
    });

    await callMessagesRoute({
      sessionId: session.id,
      content: "for pulo only",
    });

    const rewriteLog = mockConsoleInfo.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .find((entry) => entry.event === "contextual_query_rewrite" && entry.rewrite_triggered === true);

    expect(rewriteLog).toBeDefined();
    expect(String(rewriteLog?.rewritten_query_preview ?? "").toLowerCase()).toContain(
      "total amount per fund source"
    );
    expect(String(rewriteLog?.rewritten_query_preview ?? "").toLowerCase()).toContain(
      "barangay pulo"
    );
  });
});
