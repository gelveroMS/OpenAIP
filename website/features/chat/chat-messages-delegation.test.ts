import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatSession } from "@/lib/repos/chat/types";

const mockGetActorContext = vi.fn();
const mockRequestPipelineChatAnswer = vi.fn();
const mockGetTypedAppSetting = vi.fn();
const mockIsUserBlocked = vi.fn();
const mockConsumeChatQuota = vi.fn();
const mockInsertAssistantChatMessage = vi.fn();
const mockToPrivilegedActorContext = vi.fn();
const mockGetSession = vi.fn();
const mockCreateSession = vi.fn();
const mockAppendUserMessage = vi.fn();
const mockListMessages = vi.fn();
const mockSupabaseServer = vi.fn();

type MockRow = Record<string, unknown>;

function createThenableQuery(rows: MockRow[]) {
  let filtered = [...rows];

  const query = {
    in(column: string, values: unknown[]) {
      filtered = filtered.filter((row) => values.includes(row[column]));
      return query;
    },
    eq(column: string, value: unknown) {
      filtered = filtered.filter((row) => row[column] === value);
      return query;
    },
    order() {
      return query;
    },
    limit(count: number) {
      filtered = filtered.slice(0, count);
      return query;
    },
    maybeSingle() {
      return Promise.resolve({
        data: filtered[0] ?? null,
        error: null,
      });
    },
    then(onFulfilled: (value: { data: MockRow[]; error: null }) => unknown) {
      return Promise.resolve({ data: filtered, error: null }).then(onFulfilled);
    },
  };

  return query;
}

function makeServerClient(dataset?: {
  projects?: MockRow[];
  aips?: MockRow[];
  barangays?: MockRow[];
  cities?: MockRow[];
  municipalities?: MockRow[];
}) {
  const resolved = {
    projects: dataset?.projects ?? [],
    aips: dataset?.aips ?? [],
    barangays: dataset?.barangays ?? [],
    cities: dataset?.cities ?? [],
    municipalities: dataset?.municipalities ?? [],
  };

  return {
    from(table: string) {
      return {
        select() {
          return createThenableQuery((resolved as Record<string, MockRow[]>)[table] ?? []);
        },
      };
    },
  };
}

vi.mock("@/lib/security/csrf", () => ({
  enforceCsrfProtection: () => ({ ok: true }),
}));

vi.mock("@/lib/domain/get-actor-context", () => ({
  getActorContext: () => mockGetActorContext(),
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

vi.mock("@/lib/repos/chat/repo.server", () => ({
  getChatRepo: () => ({
    getSession: (...args: unknown[]) => mockGetSession(...args),
    createSession: (...args: unknown[]) => mockCreateSession(...args),
    listMessages: (...args: unknown[]) => mockListMessages(...args),
    appendUserMessage: (...args: unknown[]) => mockAppendUserMessage(...args),
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
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
    mockGetSession.mockResolvedValue(session);
    mockCreateSession.mockResolvedValue(session);
    mockListMessages.mockResolvedValue([]);
    mockSupabaseServer.mockResolvedValue(makeServerClient());
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
    expect(mockRequestPipelineChatAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: session.id,
        retrievalScope: { mode: "global", targets: [] },
        scopeFallback: undefined,
        topK: 5,
      })
    );
    expect(mockInsertAssistantChatMessage).toHaveBeenCalledTimes(1);
  });

  it("does not short-circuit on ambiguous scope phrases and still delegates to pipeline", async () => {
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "Found procurement-related projects for FY 2022.",
      refused: false,
      citations: [
        {
          source_id: "S1",
          snippet: "Procurement of barangay equipment listed in FY 2022.",
          scope_type: "city",
          scope_name: "Cabuyao City",
          metadata: { type: "aip_line_items" },
        },
      ],
      retrieval_meta: {
        reason: "ok",
        status: "answer",
        route_family: "row_sql",
        context_count: 1,
      },
    });

    const POST = await getPostHandler();
    const response = await POST(
      makeRequest({
        sessionId: session.id,
        content:
          "What projects in Cabuyao City FY 2022 involve the procurement of barangay equipment or facilities?",
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      assistantMessage: { content: string; retrievalMeta: { status?: string; routeFamily?: string } };
    };
    expect(payload.assistantMessage.content).toContain("FY 2022");
    expect(payload.assistantMessage.retrievalMeta.status).toBe("answer");
    expect(payload.assistantMessage.retrievalMeta.routeFamily).toBe("row_sql");
    expect(mockRequestPipelineChatAnswer).toHaveBeenCalledTimes(1);
    expect(mockRequestPipelineChatAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievalScope: { mode: "global", targets: [] },
        scopeFallback: undefined,
        topK: 5,
      })
    );
  });

  it("uses last successful assistant scope as pipeline scopeFallback", async () => {
    mockListMessages.mockResolvedValue([
      {
        id: "assistant-old",
        sessionId: session.id,
        role: "assistant",
        content: "Old answer",
        createdAt: "2026-03-01T00:00:10.000Z",
        citations: [
          {
            sourceId: "S1",
            snippet: "Old citation",
            scopeType: "city",
            scopeId: "city-old",
            scopeName: "Old City",
          },
        ],
        retrievalMeta: {
          status: "answer",
          entities: { city: "Old City", scope_type: "city", scope_name: "Old City" },
        },
      },
      {
        id: "assistant-new",
        sessionId: session.id,
        role: "assistant",
        content: "New answer",
        createdAt: "2026-03-01T00:00:20.000Z",
        citations: [
          {
            sourceId: "S2",
            snippet: "New citation",
            scopeType: "city",
            scopeId: "city-cabuyao",
            scopeName: "Cabuyao City",
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
        context_count: 0,
      },
    });

    const POST = await getPostHandler();
    const response = await POST(
      makeRequest({
        sessionId: session.id,
        content: "What projects are included?",
      })
    );

    expect(response.status).toBe(200);
    expect(mockRequestPipelineChatAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        topK: 5,
        scopeFallback: {
          scope_type: "city",
          scope_name: "Cabuyao",
          scope_id: "city-cabuyao",
        },
      })
    );
  });

  it("ignores non-answer assistant turns when selecting scope fallback", async () => {
    mockListMessages.mockResolvedValue([
      {
        id: "assistant-answer",
        sessionId: session.id,
        role: "assistant",
        content: "Answer turn",
        createdAt: "2026-03-01T00:00:10.000Z",
        citations: [
          {
            sourceId: "S1",
            snippet: "Answer citation",
            scopeType: "barangay",
            scopeId: "brgy-mamatid",
            scopeName: "Mamatid",
          },
        ],
        retrievalMeta: {
          status: "answer",
          entities: { barangay: "Mamatid", scope_type: "barangay", scope_name: "Mamatid" },
        },
      },
      {
        id: "assistant-refusal",
        sessionId: session.id,
        role: "assistant",
        content: "Refusal turn",
        createdAt: "2026-03-01T00:00:20.000Z",
        citations: [],
        retrievalMeta: {
          status: "refusal",
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
        context_count: 0,
      },
    });

    const POST = await getPostHandler();
    const response = await POST(
      makeRequest({
        sessionId: session.id,
        content: "What projects are included?",
      })
    );

    expect(response.status).toBe(200);
    expect(mockRequestPipelineChatAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        topK: 5,
        scopeFallback: {
          scope_type: "barangay",
          scope_name: "Mamatid",
          scope_id: "brgy-mamatid",
        },
      })
    );
  });

  it("enriches citations with resolved project link metadata from top-level project_ref_code", async () => {
    mockSupabaseServer.mockResolvedValue(
      makeServerClient({
        projects: [
          {
            id: "project-1",
            aip_id: "aip-1",
            aip_ref_code: "1000-001-001-001",
            program_project_description: "Health Station Upgrade",
          },
        ],
        aips: [
          {
            id: "aip-1",
            fiscal_year: 2025,
            barangay_id: "brgy-1",
            city_id: null,
            municipality_id: null,
          },
        ],
        barangays: [{ id: "brgy-1", name: "Mamatid" }],
      })
    );
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "Linked evidence response.",
      refused: false,
      citations: [
        {
          source_id: "S1",
          aip_id: "aip-1",
          project_ref_code: "1000-001-001-001",
          fiscal_year: 2025,
          scope_type: "barangay",
          scope_name: "Mamatid",
          snippet: "Health Station Upgrade - Ref 1000-001-001-001",
          metadata: { type: "aip_line_item" },
        },
      ],
      retrieval_meta: {
        reason: "ok",
        status: "answer",
        route_family: "row_sql",
        context_count: 1,
      },
    });

    const POST = await getPostHandler();
    const response = await POST(
      makeRequest({
        sessionId: session.id,
        content: "Show me project details.",
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      assistantMessage: {
        citations: Array<{
          aipId?: string | null;
          projectId?: string | null;
          projectRefCode?: string | null;
          projectTitle?: string | null;
          lguName?: string | null;
          resolvedFiscalYear?: number | null;
        }>;
      };
    };

    expect(payload.assistantMessage.citations[0]).toMatchObject({
      aipId: "aip-1",
      projectId: "project-1",
      projectRefCode: "1000-001-001-001",
      projectTitle: "Health Station Upgrade",
      lguName: "Mamatid",
      resolvedFiscalYear: 2025,
    });
  });

  it("enriches citations from metadata aip_ref_code when top-level project_ref_code is missing", async () => {
    mockSupabaseServer.mockResolvedValue(
      makeServerClient({
        projects: [
          {
            id: "project-2",
            aip_id: "aip-2",
            aip_ref_code: "2000-001-001-001",
            program_project_description: "Covered Court Renovation",
          },
        ],
        aips: [
          {
            id: "aip-2",
            fiscal_year: 2026,
            barangay_id: "brgy-2",
            city_id: null,
            municipality_id: null,
          },
        ],
        barangays: [{ id: "brgy-2", name: "Banlic" }],
      })
    );
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "Linked metadata citation.",
      refused: false,
      citations: [
        {
          source_id: "S2",
          aip_id: "aip-2",
          fiscal_year: 2026,
          scope_type: "barangay",
          scope_name: "Banlic",
          snippet: "Covered Court Renovation entry.",
          metadata: {
            aip_ref_code: "2000-001-001-001",
          },
        },
      ],
      retrieval_meta: {
        reason: "ok",
        status: "answer",
        route_family: "row_sql",
        context_count: 1,
      },
    });

    const POST = await getPostHandler();
    const response = await POST(
      makeRequest({
        sessionId: session.id,
        content: "Resolve citation using metadata ref code.",
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      assistantMessage: {
        citations: Array<{
          projectId?: string | null;
          projectRefCode?: string | null;
          projectTitle?: string | null;
          lguName?: string | null;
          resolvedFiscalYear?: number | null;
        }>;
      };
    };

    expect(payload.assistantMessage.citations[0]).toMatchObject({
      projectId: "project-2",
      projectRefCode: "2000-001-001-001",
      projectTitle: "Covered Court Renovation",
      lguName: "Banlic",
      resolvedFiscalYear: 2026,
    });
  });

  it("enriches citations from snippet Ref fallback when explicit ref fields are missing", async () => {
    mockSupabaseServer.mockResolvedValue(
      makeServerClient({
        projects: [
          {
            id: "project-3",
            aip_id: "aip-3",
            aip_ref_code: "3000-001-001-001",
            program_project_description: "Drainage Improvement Program",
          },
        ],
        aips: [
          {
            id: "aip-3",
            fiscal_year: 2027,
            barangay_id: null,
            city_id: "city-1",
            municipality_id: null,
          },
        ],
        cities: [{ id: "city-1", name: "Cabuyao City" }],
      })
    );
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "Linked snippet citation.",
      refused: false,
      citations: [
        {
          source_id: "S3",
          aip_id: "aip-3",
          fiscal_year: 2027,
          scope_type: "city",
          scope_name: "Cabuyao City",
          snippet: "Drainage Improvement Program Ref 3000-001-001-001",
          metadata: {},
        },
      ],
      retrieval_meta: {
        reason: "ok",
        status: "answer",
        route_family: "row_sql",
        context_count: 1,
      },
    });

    const POST = await getPostHandler();
    const response = await POST(
      makeRequest({
        sessionId: session.id,
        content: "Resolve citation using snippet ref fallback.",
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      assistantMessage: {
        citations: Array<{
          projectId?: string | null;
          projectRefCode?: string | null;
          projectTitle?: string | null;
          lguName?: string | null;
          resolvedFiscalYear?: number | null;
        }>;
      };
    };

    expect(payload.assistantMessage.citations[0]).toMatchObject({
      projectId: "project-3",
      projectRefCode: "3000-001-001-001",
      projectTitle: "Drainage Improvement Program",
      lguName: "Cabuyao City",
      resolvedFiscalYear: 2027,
    });
  });

  it("leaves citations unlinked when project resolution is unsafe or missing", async () => {
    mockSupabaseServer.mockResolvedValue(
      makeServerClient({
        projects: [],
      })
    );
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "No safe project match.",
      refused: false,
      citations: [
        {
          source_id: "S4",
          aip_id: "aip-4",
          project_ref_code: "4000-001-001-001",
          fiscal_year: 2028,
          scope_type: "barangay",
          scope_name: "Sala",
          snippet: "Unmatched Ref 4000-001-001-001",
          metadata: {},
        },
      ],
      retrieval_meta: {
        reason: "ok",
        status: "answer",
        route_family: "row_sql",
        context_count: 1,
      },
    });

    const POST = await getPostHandler();
    const response = await POST(
      makeRequest({
        sessionId: session.id,
        content: "Return unmatched citation.",
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      assistantMessage: {
        citations: Array<{
          projectId?: string | null;
          snippet?: string;
        }>;
      };
    };

    expect(payload.assistantMessage.citations[0]?.projectId).toBeUndefined();
    expect(payload.assistantMessage.citations[0]?.snippet).toContain("Unmatched Ref");
  });

  it("enriches totals citations from metadata.aip_id with AIP-level link fields", async () => {
    mockSupabaseServer.mockResolvedValue(
      makeServerClient({
        aips: [
          {
            id: "aip-totals-1",
            fiscal_year: 2025,
            barangay_id: "brgy-1",
            city_id: null,
            municipality_id: null,
          },
        ],
        barangays: [{ id: "brgy-1", name: "Mamatid" }],
      })
    );
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "Total investment program for Mamatid for FY 2025: PHP 1,000.00.",
      refused: false,
      citations: [
        {
          source_id: "S20",
          snippet: "Total investment program value from structured totals table.",
          scope_type: "system",
          scope_name: "Published AIP totals",
          metadata: {
            type: "aip_totals",
            aip_id: "aip-totals-1",
            page_no: 1,
          },
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
        content: "Show totals evidence link fields.",
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      assistantMessage: {
        citations: Array<{
          aipId?: string | null;
          projectId?: string | null;
          lguName?: string | null;
          resolvedFiscalYear?: number | null;
        }>;
      };
    };

    expect(payload.assistantMessage.citations[0]).toMatchObject({
      aipId: "aip-totals-1",
      lguName: "Mamatid",
      resolvedFiscalYear: 2025,
    });
    expect(payload.assistantMessage.citations[0]?.projectId).toBeUndefined();
  });

  it("keeps totals citations plain when aip_id cannot be resolved", async () => {
    mockSupabaseServer.mockResolvedValue(makeServerClient());
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "Total investment program is unavailable.",
      refused: false,
      citations: [
        {
          source_id: "S21",
          snippet: "Computed from published AIP line-item totals.",
          scope_type: "system",
          scope_name: "Structured SQL",
          metadata: {
            type: "aip_totals",
          },
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
        content: "Try unresolved totals citation.",
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      assistantMessage: {
        citations: Array<{
          aipId?: string | null;
          lguName?: string | null;
          snippet?: string;
        }>;
      };
    };

    expect(payload.assistantMessage.citations[0]?.aipId).toBeNull();
    expect(payload.assistantMessage.citations[0]?.lguName).toBeUndefined();
    expect(payload.assistantMessage.citations[0]?.snippet).toContain("Computed from published AIP");
  });
});
