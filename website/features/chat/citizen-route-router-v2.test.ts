import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequestPipelineChatAnswer = vi.fn();
const mockRequestPipelineIntentClassify = vi.fn();
const mockGetTypedAppSetting = vi.fn();
const mockIsUserBlocked = vi.fn();
const mockConsumeChatQuota = vi.fn();
const mockInsertAssistantChatMessage = vi.fn();
const mockSupabaseServer = vi.fn();
const mockSupabaseAdmin = vi.fn();
const mockIsCitizenProfileComplete = vi.fn();
const mockToPrivilegedActorContextFromProfile = vi.fn();

vi.mock("@/lib/chat/pipeline-client", () => ({
  requestPipelineChatAnswer: (...args: unknown[]) => mockRequestPipelineChatAnswer(...args),
  requestPipelineIntentClassify: (...args: unknown[]) => mockRequestPipelineIntentClassify(...args),
}));

vi.mock("@/lib/settings/app-settings", () => ({
  getTypedAppSetting: (...args: unknown[]) => mockGetTypedAppSetting(...args),
  isUserBlocked: (...args: unknown[]) => mockIsUserBlocked(...args),
}));

vi.mock("@/lib/security/csrf", () => ({
  enforceCsrfProtection: () => ({ ok: true as const }),
}));

vi.mock("@/lib/security/invariants", () => ({
  assertPrivilegedWriteAccess: () => undefined,
  isInvariantError: () => false,
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => mockSupabaseAdmin(),
}));

vi.mock("@/lib/supabase/privileged-ops", () => ({
  consumeChatQuota: (...args: unknown[]) => mockConsumeChatQuota(...args),
  insertAssistantChatMessage: (...args: unknown[]) => mockInsertAssistantChatMessage(...args),
  toPrivilegedActorContextFromProfile: (...args: unknown[]) =>
    mockToPrivilegedActorContextFromProfile(...args),
}));

vi.mock("@/lib/auth/citizen-profile-completion", () => ({
  isCitizenProfileComplete: (...args: unknown[]) => mockIsCitizenProfileComplete(...args),
}));

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
        data: { user: { id: "user-1" } },
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
                  data: { id: "session-1", title: "Chat", context: {} },
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
                  id: "user-1",
                  role: "citizen",
                  full_name: "Sample User",
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

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function makeAdminClient() {
  return {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { name: "Mamatid" },
            error: null,
          }),
        }),
      }),
    }),
  };
}

async function callRoute(message: string) {
  const POST = await getPostHandler();
  const request = new Request("http://localhost/api/citizen/chat/reply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify({
      session_id: "session-1",
      user_message: message,
    }),
  });
  return POST(request);
}

describe("citizen router v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postHandler = null;
    process.env.CITIZEN_ROUTER_V2_ENABLED = "true";

    mockSupabaseServer.mockReturnValue(makeServerClient());
    mockSupabaseAdmin.mockReturnValue(makeAdminClient());
    mockGetTypedAppSetting.mockResolvedValue({
      maxRequests: 100,
      timeWindow: "per_hour",
    });
    mockIsUserBlocked.mockResolvedValue(false);
    mockConsumeChatQuota.mockResolvedValue({ allowed: true, reason: "ok" });
    mockToPrivilegedActorContextFromProfile.mockReturnValue({
      userId: "user-1",
      role: "citizen",
      scope: { kind: "barangay", id: "brgy-1" },
    });
    mockIsCitizenProfileComplete.mockReturnValue(true);
    mockInsertAssistantChatMessage.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "assistant-1",
      session_id: String(input.sessionId),
      role: "assistant",
      content: String(input.content),
      citations: input.citations ?? [],
      retrieval_meta: input.retrievalMeta ?? null,
      created_at: new Date().toISOString(),
    }));
  });

  it("does not call pipeline answer for conversational shortcut", async () => {
    mockRequestPipelineIntentClassify.mockResolvedValue({
      intent: "GREETING",
      confidence: 0.99,
      top2_intent: null,
      top2_confidence: null,
      margin: 0.9,
      method: "semantic",
    });

    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "pipeline",
      refused: false,
      citations: [],
      retrieval_meta: { reason: "ok" },
    });

    const response = await callRoute("hello");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    const message = payload.message as Record<string, unknown>;

    expect(String(message.content).toLowerCase()).toContain("hi!");
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
  });

  it("keeps fallback path for non-conversational requests", async () => {
    mockRequestPipelineIntentClassify.mockResolvedValue({
      intent: "TOTAL_AGGREGATION",
      confidence: 0.92,
      top2_intent: "CATEGORY_AGGREGATION",
      top2_confidence: 0.3,
      margin: 0.62,
      method: "rule",
    });

    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "Total is PHP 123.00",
      refused: false,
      citations: [],
      retrieval_meta: { reason: "ok" },
    });

    const response = await callRoute("What is the total investment program for FY 2026?");
    expect(response.status).toBe(200);
    expect(mockRequestPipelineChatAnswer).toHaveBeenCalledTimes(1);
  });
});
