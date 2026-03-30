import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequestPipelineChatAnswer = vi.fn();
const mockGetTypedAppSetting = vi.fn();
const mockIsUserBlocked = vi.fn();
const mockConsumeChatQuota = vi.fn();
const mockInsertAssistantChatMessage = vi.fn();
const mockToPrivilegedActorContextFromProfile = vi.fn();
const mockSupabaseServer = vi.fn();
const mockSupabaseAdmin = vi.fn();

vi.mock("@/lib/security/csrf", () => ({
  enforceCsrfProtection: () => ({ ok: true }),
}));

vi.mock("@/lib/chat/pipeline-client", () => ({
  requestPipelineChatAnswer: (...args: unknown[]) => mockRequestPipelineChatAnswer(...args),
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

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => mockSupabaseAdmin(),
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
            eq: (_field1: string, _value1: string) => ({
              eq: (_field2: string, _value2: string) => ({
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
            eq: (_field: string, _value: string) => ({
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

function makeAdminClient() {
  return {
    from: (_table: string) => ({
      select: () => ({
        eq: (_field: string, _value: string) => ({
          maybeSingle: async () => ({
            data: { name: "Mamatid" },
            error: null,
          }),
        }),
      }),
    }),
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
    mockSupabaseAdmin.mockReturnValue(makeAdminClient());
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

  it("always delegates to pipeline chat answer and persists retrieval metadata", async () => {
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
      message: { content: string; retrievalMeta: { status?: string; source?: string } };
      suggestedFollowUps: string[];
    };

    expect(payload.message.content).toContain("PHP 1,000.00");
    expect(payload.message.retrievalMeta.status).toBe("answer");
    expect(payload.message.retrievalMeta.source).toBe("pipeline_chat_answer");
    expect(Array.isArray(payload.suggestedFollowUps)).toBe(true);

    expect(mockRequestPipelineChatAnswer).toHaveBeenCalledTimes(1);
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
      message: { retrievalMeta: { status?: string; reason?: string } };
    };
    expect(payload.message.retrievalMeta.status).toBe("clarification");
    expect(payload.message.retrievalMeta.reason).toBe("clarification_needed");
  });
});
