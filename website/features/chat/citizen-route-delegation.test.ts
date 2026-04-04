import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequestPipelineChatAnswer = vi.fn();
const mockGetTypedAppSetting = vi.fn();
const mockIsUserBlocked = vi.fn();
const mockConsumeChatQuota = vi.fn();
const mockInsertAssistantChatMessage = vi.fn();
const mockToPrivilegedActorContextFromProfile = vi.fn();
const mockSupabaseServer = vi.fn();
const mockListMessages = vi.fn();

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

function makeServerClient(dataset?: {
  chat_sessions?: MockRow[];
  profiles?: MockRow[];
  projects?: MockRow[];
  aips?: MockRow[];
  barangays?: MockRow[];
  cities?: MockRow[];
  municipalities?: MockRow[];
}) {
  const resolved = {
    chat_sessions: dataset?.chat_sessions ?? [
      {
        id: "session-1",
        title: "Citizen Chat",
        context: {},
        user_id: "citizen-1",
      },
    ],
    profiles: dataset?.profiles ?? [
      {
        id: "citizen-1",
        role: "citizen",
        full_name: "Citizen User",
        barangay_id: "brgy-1",
        city_id: null,
        municipality_id: null,
      },
    ],
    projects: dataset?.projects ?? [],
    aips: dataset?.aips ?? [],
    barangays: dataset?.barangays ?? [],
    cities: dataset?.cities ?? [],
    municipalities: dataset?.municipalities ?? [],
  };

  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: "citizen-1" } },
        error: null,
      }),
    },
    from: (table: string) => {
      return {
        select: () => createThenableQuery((resolved as Record<string, MockRow[]>)[table] ?? []),
      };
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

  it("enriches citations with resolved project metadata from top-level project_ref_code", async () => {
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
          source_id: "S10",
          aip_id: "aip-1",
          project_ref_code: "1000-001-001-001",
          fiscal_year: 2025,
          scope_type: "barangay",
          scope_name: "Mamatid",
          snippet: "Health Station Upgrade Ref 1000-001-001-001",
          metadata: { type: "aip_line_item" },
        },
      ],
      retrieval_meta: {
        reason: "ok",
        status: "answer",
        route_family: "row_sql",
      },
    });

    const POST = await getPostHandler();
    const response = await POST(makeRequest("Show project details."));

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

  it("enriches citations from metadata aip_ref_code", async () => {
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
      answer: "Metadata linked evidence.",
      refused: false,
      citations: [
        {
          source_id: "S11",
          aip_id: "aip-2",
          fiscal_year: 2026,
          scope_type: "barangay",
          scope_name: "Banlic",
          snippet: "Covered Court Renovation evidence line.",
          metadata: { aip_ref_code: "2000-001-001-001" },
        },
      ],
      retrieval_meta: {
        reason: "ok",
        status: "answer",
        route_family: "row_sql",
      },
    });

    const POST = await getPostHandler();
    const response = await POST(makeRequest("Resolve metadata citation."));

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

  it("enriches citations from snippet Ref fallback", async () => {
    mockSupabaseServer.mockResolvedValue(
      makeServerClient({
        projects: [
          {
            id: "project-3",
            aip_id: "aip-3",
            aip_ref_code: "3000-001-001-001",
            program_project_description: "Flood Control Rehabilitation",
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
      answer: "Snippet linked evidence.",
      refused: false,
      citations: [
        {
          source_id: "S12",
          aip_id: "aip-3",
          fiscal_year: 2027,
          scope_type: "city",
          scope_name: "Cabuyao City",
          snippet: "Flood Control Rehabilitation Ref 3000-001-001-001",
          metadata: {},
        },
      ],
      retrieval_meta: {
        reason: "ok",
        status: "answer",
        route_family: "row_sql",
      },
    });

    const POST = await getPostHandler();
    const response = await POST(makeRequest("Resolve from snippet ref."));

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
      projectTitle: "Flood Control Rehabilitation",
      lguName: "Cabuyao City",
      resolvedFiscalYear: 2027,
    });
  });

  it("keeps citation plain/unlinked when no safe project match exists", async () => {
    mockSupabaseServer.mockResolvedValue(
      makeServerClient({
        projects: [],
      })
    );
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "No linked evidence.",
      refused: false,
      citations: [
        {
          source_id: "S13",
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
      },
    });

    const POST = await getPostHandler();
    const response = await POST(makeRequest("Try unmatched citation."));

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

  it("enriches totals citations from metadata.aip_id with AIP-level fields", async () => {
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
          source_id: "S30",
          snippet: "Total investment program value from structured totals table.",
          scope_type: "system",
          scope_name: "Published AIP totals",
          metadata: {
            type: "aip_totals",
            aip_id: "aip-totals-1",
          },
        },
      ],
      retrieval_meta: {
        reason: "ok",
        status: "answer",
        route_family: "sql_totals",
      },
    });

    const POST = await getPostHandler();
    const response = await POST(makeRequest("Show totals citation details."));

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

  it("keeps totals citations plain when aip_id is not available", async () => {
    mockSupabaseServer.mockResolvedValue(makeServerClient());
    mockRequestPipelineChatAnswer.mockResolvedValue({
      answer: "No linked totals evidence.",
      refused: false,
      citations: [
        {
          source_id: "S31",
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
      },
    });

    const POST = await getPostHandler();
    const response = await POST(makeRequest("Try unresolved totals evidence."));

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
