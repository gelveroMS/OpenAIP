import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequestPipelineChatAnswer = vi.fn();
const mockGetTypedAppSetting = vi.fn();
const mockIsUserBlocked = vi.fn();
const mockConsumeChatQuota = vi.fn();
const mockInsertAssistantChatMessage = vi.fn();
const mockToPrivilegedActorContextFromProfile = vi.fn();
const mockSupabaseServer = vi.fn();
const mockListMessages = vi.fn();

vi.mock("@/lib/security/csrf", () => ({
  enforceCsrfProtection: () => ({ ok: true }),
}));

vi.mock("@/lib/chat/pipeline-client", () => ({
  requestPipelineChatAnswer: (...args: unknown[]) => mockRequestPipelineChatAnswer(...args),
}));

vi.mock("@/lib/repos/chat/repo.server", () => ({
  getChatRepo: () => ({
    listMessages: (...args: unknown[]) => mockListMessages(...args),
  }),
}));

vi.mock("@/lib/settings/app-settings", () => ({
  getTypedAppSetting: (...args: unknown[]) => mockGetTypedAppSetting(...args),
  isUserBlocked: (...args: unknown[]) => mockIsUserBlocked(...args),
}));

vi.mock("@/lib/supabase/privileged-ops", () => ({
  consumeChatQuota: (...args: unknown[]) => mockConsumeChatQuota(...args),
  insertAssistantChatMessage: (...args: unknown[]) => mockInsertAssistantChatMessage(...args),
  toPrivilegedActorContextFromProfile: (...args: unknown[]) =>
    mockToPrivilegedActorContextFromProfile(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

vi.mock("@/lib/auth/citizen-profile-completion", () => ({
  isCitizenProfileComplete: () => true,
}));

vi.mock("server-only", () => ({}));

let postHandler: typeof import("@/app/api/citizen/chat/reply/route").POST | null = null;

async function getPostHandler() {
  if (postHandler) return postHandler;
  const route = await import("@/app/api/citizen/chat/reply/route");
  postHandler = route.POST;
  return postHandler;
}

function makeServerClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: "citizen-1" } },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table === "chat_sessions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "session-1",
                    title: "Citizen Chat",
                    context: {},
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "citizen-1",
                  role: "citizen",
                  full_name: "Citizen User",
                  barangay_id: "brgy-1",
                  city_id: null,
                  municipality_id: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected server table: ${table}`);
    },
  };
}

function makeRequest(userMessage: string) {
  return new Request("http://localhost/api/citizen/chat/reply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify({
      session_id: "session-1",
      user_message: userMessage,
    }),
  });
}

describe("citizen chat route delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postHandler = null;

    mockSupabaseServer.mockResolvedValue(makeServerClient());
    mockGetTypedAppSetting.mockResolvedValue({
      maxRequests: 20,
      timeWindow: "per_hour",
    });
    mockIsUserBlocked.mockResolvedValue(false);
    mockConsumeChatQuota.mockResolvedValue({ allowed: true, reason: "ok" });
    mockToPrivilegedActorContextFromProfile.mockReturnValue({
      role: "citizen",
      user_id: "citizen-1",
      lgu_id: "brgy-1",
      lgu_scope: "barangay",
    });
    mockListMessages.mockResolvedValue([
      {
        id: "user-1",
        sessionId: "session-1",
        role: "user",
        content: "What is the total allocation for FY 2025?",
        createdAt: "2026-03-01T00:01:00.000Z",
        citations: null,
        retrievalMeta: null,
      },
    ]);

    mockInsertAssistantChatMessage.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "assistant-1",
      session_id: String(input.sessionId),
      role: "assistant",
      content: String(input.content),
      citations: input.citations ?? null,
      retrieval_meta: input.retrievalMeta ?? null,
      created_at: "2026-03-01T00:01:05.000Z",
    }));
  });

  it("returns LGU-shaped payload and persists normalized retrieval metadata", async () => {
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "The total allocation is PHP 1,000.00.",
      refused: false,
      citations: [
        {
          source_id: "S1",
          snippet: "Structured answer evidence",
          scope_name: "Published AIP",
          metadata: { source: "sql_router" },
        },
      ],
      retrieval_meta: {
        reason: "ok",
        status: "answer",
        route_family: "sql_totals",
      },
    });

    const POST = await getPostHandler();
    const response = await POST(makeRequest("What is the total allocation for FY 2025?"));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      sessionId: string;
      userMessage: { role: string; content: string };
      assistantMessage: { content: string; retrievalMeta: { status?: string; routeFamily?: string; suggestions?: string[] } };
    };

    expect(payload.sessionId).toBe("session-1");
    expect(payload.userMessage.role).toBe("user");
    expect(payload.assistantMessage.content).toContain("PHP 1,000.00");
    expect(payload.assistantMessage.retrievalMeta.status).toBe("answer");
    expect(payload.assistantMessage.retrievalMeta.routeFamily).toBe("sql_totals");
    expect(Array.isArray(payload.assistantMessage.retrievalMeta.suggestions)).toBe(true);

    expect(mockRequestPipelineChatAnswer).toHaveBeenCalledTimes(1);
    expect(mockRequestPipelineChatAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievalScope: { mode: "global", targets: [] },
      })
    );
    const pipelineInput = mockRequestPipelineChatAnswer.mock.calls[0]?.[0] as {
      retrievalFilters?: { scope_type?: string; scope_name?: string };
    };
    expect(pipelineInput.retrievalFilters?.scope_type).toBeUndefined();
    expect(pipelineInput.retrievalFilters?.scope_name).toBeUndefined();
    expect(mockInsertAssistantChatMessage).toHaveBeenCalledTimes(1);
  });

  it("persists clarification status from pipeline metadata", async () => {
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "Please clarify which fiscal years to compare.",
      refused: false,
      citations: [],
      retrieval_meta: {
        reason: "clarification_needed",
        status: "clarification",
        route_family: "aggregate_sql",
      },
    });

    const POST = await getPostHandler();
    const response = await POST(makeRequest("Compare this year and last year."));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      assistantMessage: { retrievalMeta: { status?: string; reason?: string } };
    };
    expect(payload.assistantMessage.retrievalMeta.status).toBe("clarification");
    expect(payload.assistantMessage.retrievalMeta.reason).toBe("clarification_needed");
  });

  it("uses the last successful assistant scope as pipeline scopeFallback", async () => {
    mockListMessages.mockResolvedValue([
      {
        id: "user-1",
        sessionId: "session-1",
        role: "user",
        content: "What projects are included?",
        createdAt: "2026-03-01T00:00:10.000Z",
        citations: null,
        retrievalMeta: null,
      },
      {
        id: "assistant-1",
        sessionId: "session-1",
        role: "assistant",
        content: "Prior answer",
        createdAt: "2026-03-01T00:00:20.000Z",
        citations: [
          {
            sourceId: "S2",
            snippet: "Prior scope evidence",
            scopeType: "city",
            scopeId: "city-cabuyao",
            scopeName: "Cabuyao",
          },
        ],
        retrievalMeta: {
          status: "answer",
          entities: { city: "Cabuyao", scope_type: "city", scope_name: "Cabuyao" },
        },
      },
    ]);
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "Scoped answer.",
      refused: false,
      citations: [],
      retrieval_meta: {
        reason: "ok",
        status: "answer",
        route_family: "row_sql",
      },
    });

    const POST = await getPostHandler();
    const response = await POST(makeRequest("What projects are included?"));

    expect(response.status).toBe(200);
    expect(mockRequestPipelineChatAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievalScope: { mode: "global", targets: [] },
        scopeFallback: {
          scope_type: "city",
          scope_name: "Cabuyao",
          scope_id: "city-cabuyao",
        },
      })
    );
  });

  it("returns a persisted fallback assistant response when pipeline request fails", async () => {
    mockRequestPipelineChatAnswer.mockRejectedValue(new Error("timeout"));

    const POST = await getPostHandler();
    const response = await POST(makeRequest("What is the total allocation for FY 2025?"));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      assistantMessage: {
        content: string;
        citations: Array<{ sourceId?: string; snippet?: string }>;
        retrievalMeta: { reason?: string; status?: string; routeFamily?: string };
      };
    };

    expect(payload.assistantMessage.content).toContain("temporary system issue");
    expect(payload.assistantMessage.retrievalMeta.reason).toBe("pipeline_error");
    expect(payload.assistantMessage.retrievalMeta.status).toBe("refusal");
    expect(payload.assistantMessage.retrievalMeta.routeFamily).toBe("pipeline_fallback");
    expect(payload.assistantMessage.citations[0]?.sourceId).toBe("S0");
    expect(payload.assistantMessage.citations[0]?.snippet).toContain("Pipeline request failed");
  });
});
