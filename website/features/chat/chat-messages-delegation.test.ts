import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatSession } from "@/lib/repos/chat/types";

const mockGetActorContext = vi.fn();
const mockResolveRetrievalScope = vi.fn();
const mockRequestPipelineChatAnswer = vi.fn();
const mockGetTypedAppSetting = vi.fn();
const mockIsUserBlocked = vi.fn();
const mockConsumeChatQuota = vi.fn();
const mockInsertAssistantChatMessage = vi.fn();
const mockToPrivilegedActorContext = vi.fn();
const mockSupabaseServer = vi.fn();
const mockGetSession = vi.fn();
const mockCreateSession = vi.fn();
const mockAppendUserMessage = vi.fn();

vi.mock("@/lib/security/csrf", () => ({
  enforceCsrfProtection: () => ({ ok: true }),
}));

vi.mock("@/lib/domain/get-actor-context", () => ({
  getActorContext: () => mockGetActorContext(),
}));

vi.mock("@/lib/chat/scope-resolver.server", () => ({
  resolveRetrievalScope: (...args: unknown[]) => mockResolveRetrievalScope(...args),
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
  toPrivilegedActorContext: (...args: unknown[]) => mockToPrivilegedActorContext(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

vi.mock("@/lib/repos/chat/repo.server", () => ({
  getChatRepo: () => ({
    getSession: (...args: unknown[]) => mockGetSession(...args),
    createSession: (...args: unknown[]) => mockCreateSession(...args),
    appendUserMessage: (...args: unknown[]) => mockAppendUserMessage(...args),
  }),
}));

vi.mock("server-only", () => ({}));

let postHandler: typeof import("@/app/api/barangay/chat/messages/route").POST | null = null;

async function getPostHandler() {
  if (postHandler) return postHandler;
  const routeModule = await import("@/app/api/barangay/chat/messages/route");
  postHandler = routeModule.POST;
  return postHandler;
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/barangay/chat/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

const session: ChatSession = {
  id: "session-1",
  userId: "user-1",
  title: "Chat",
  context: {},
  lastMessageAt: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
};

const userMessage: ChatMessage = {
  id: "user-1-msg",
  sessionId: session.id,
  role: "user",
  content: "What is the total investment program for FY 2025?",
  createdAt: "2026-03-01T00:01:00.000Z",
  citations: null,
  retrievalMeta: null,
};

describe("barangay chat route delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postHandler = null;

    mockGetActorContext.mockResolvedValue({
      userId: "user-1",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });

    mockGetTypedAppSetting.mockResolvedValue({
      maxRequests: 50,
      timeWindow: "per_hour",
    });
    mockIsUserBlocked.mockResolvedValue(false);
    mockConsumeChatQuota.mockResolvedValue({ allowed: true, reason: "ok" });
    mockToPrivilegedActorContext.mockReturnValue({
      role: "barangay_official",
      user_id: "user-1",
      lgu_id: "brgy-1",
      lgu_scope: "barangay",
    });
    mockSupabaseServer.mockResolvedValue({});
    mockGetSession.mockResolvedValue(session);
    mockCreateSession.mockResolvedValue(session);
    mockAppendUserMessage.mockResolvedValue(userMessage);
    mockInsertAssistantChatMessage.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "assistant-1",
      session_id: String(input.sessionId),
      role: "assistant",
      content: input.content,
      citations: input.citations ?? null,
      retrieval_meta: input.retrievalMeta ?? null,
      created_at: "2026-03-01T00:01:05.000Z",
    }));
  });

  it("delegates to pipeline and persists answer status/citations", async () => {
    mockResolveRetrievalScope.mockResolvedValue({
      mode: "global",
      retrievalScope: { mode: "global", targets: [] },
      scopeResolution: {
        mode: "global",
        requestedScopes: [],
        resolvedTargets: [],
        unresolvedScopes: [],
        ambiguousScopes: [],
      },
    });
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "Total investment program is PHP 1,000.00.",
      refused: false,
      citations: [
        {
          source_id: "S1",
          snippet: "Structured SQL total",
          scope_type: "system",
          scope_name: "Structured SQL",
          metadata: { type: "aip_totals" },
        },
      ],
      retrieval_meta: {
        reason: "ok",
        status: "answer",
        route_family: "sql_totals",
        context_count: 1,
      },
    });

    const POST = await getPostHandler();
    const response = await POST(
      makeRequest({
        sessionId: session.id,
        content: userMessage.content,
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      sessionId: string;
      assistantMessage: { content: string; retrievalMeta: { status?: string; routeFamily?: string } };
    };

    expect(payload.sessionId).toBe(session.id);
    expect(payload.assistantMessage.content).toContain("PHP 1,000.00");
    expect(payload.assistantMessage.retrievalMeta.status).toBe("answer");
    expect(payload.assistantMessage.retrievalMeta.routeFamily).toBe("sql_totals");

    expect(mockRequestPipelineChatAnswer).toHaveBeenCalledTimes(1);
    expect(mockInsertAssistantChatMessage).toHaveBeenCalledTimes(1);
  });

  it("returns clarification immediately when scope resolution is ambiguous", async () => {
    mockResolveRetrievalScope.mockResolvedValue({
      mode: "ambiguous",
      retrievalScope: null,
      clarificationMessage: "Please specify the exact barangay name.",
      scopeResolution: {
        mode: "ambiguous",
        requestedScopes: [{ scopeType: "barangay", scopeName: "Poblacion" }],
        resolvedTargets: [],
        unresolvedScopes: ["barangay:Poblacion"],
        ambiguousScopes: [],
      },
    });

    const POST = await getPostHandler();
    const response = await POST(
      makeRequest({
        sessionId: session.id,
        content: "Show total for Poblacion.",
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      assistantMessage: { content: string; retrievalMeta: { status?: string } };
    };
    expect(payload.assistantMessage.content).toContain("specify the exact barangay name");
    expect(payload.assistantMessage.retrievalMeta.status).toBe("clarification");
    expect(mockRequestPipelineChatAnswer).not.toHaveBeenCalled();
  });
});
