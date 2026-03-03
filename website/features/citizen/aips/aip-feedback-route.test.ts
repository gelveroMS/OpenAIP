import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseServer = vi.fn();
const mockResolveAipById = vi.fn();
const mockAssertPublishedAipStatus = vi.fn();
const mockListPublicAipFeedback = vi.fn();
const mockRequireCitizenActor = vi.fn();
const mockSanitizeKind = vi.fn();
const mockSanitizeBody = vi.fn();
const mockHydrateAipFeedbackItems = vi.fn();
const mockResolveViewerUserId = vi.fn();
const mockToErrorResponse = vi.fn();
const mockAssertFeedbackUsageAllowed = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

class MockFeedbackUsageError extends Error {
  status: 403 | 429;

  constructor(status: 403 | 429, message: string) {
    super(message);
    this.status = status;
  }
}

vi.mock("@/lib/feedback/usage-guards", () => ({
  assertFeedbackUsageAllowed: (...args: unknown[]) => mockAssertFeedbackUsageAllowed(...args),
  isFeedbackUsageError: (error: unknown) => error instanceof MockFeedbackUsageError,
}));

class MockCitizenAipFeedbackApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

vi.mock("@/app/api/citizen/aips/_feedback-shared", () => ({
  CitizenAipFeedbackApiError: MockCitizenAipFeedbackApiError,
  resolveAipById: mockResolveAipById,
  assertPublishedAipStatus: mockAssertPublishedAipStatus,
  listPublicAipFeedback: mockListPublicAipFeedback,
  resolveViewerUserId: mockResolveViewerUserId,
  requireCitizenActor: mockRequireCitizenActor,
  sanitizeCitizenFeedbackKind: mockSanitizeKind,
  sanitizeFeedbackBody: mockSanitizeBody,
  hydrateAipFeedbackItems: mockHydrateAipFeedbackItems,
  toErrorResponse: mockToErrorResponse,
}));

function createInsertClient(insertedRow: Record<string, unknown>) {
  return {
    from: (table: string) => {
      if (table !== "feedback") throw new Error(`Unexpected table: ${table}`);
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: insertedRow,
              error: null,
            }),
          }),
        }),
      };
    },
  };
}

describe("GET|POST /api/citizen/aips/[aipId]/feedback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockToErrorResponse.mockImplementation(
      () => new Response(JSON.stringify({ error: "mock error" }), { status: 500 })
    );
    mockAssertFeedbackUsageAllowed.mockResolvedValue(undefined);
    mockResolveViewerUserId.mockResolvedValue(null);
  });

  it("GET returns public AIP feedback items (including lgu_note)", async () => {
    mockSupabaseServer.mockResolvedValue({});
    mockResolveAipById.mockResolvedValue({ id: "aip-1", status: "published" });
    mockListPublicAipFeedback.mockResolvedValue([
      {
        id: "fb-1",
        aipId: "aip-1",
        parentFeedbackId: null,
        kind: "lgu_note",
        body: "LGU note",
        createdAt: "2026-01-01T00:00:00.000Z",
        author: {
          id: "u-1",
          fullName: "City Official",
          role: "city_official",
          roleLabel: "City Official",
          lguLabel: "City of Cabuyao",
        },
      },
    ]);

    const { GET } = await import("@/app/api/citizen/aips/[aipId]/feedback/route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ aipId: "aip-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockResolveAipById).toHaveBeenCalled();
    expect(mockAssertPublishedAipStatus).toHaveBeenCalledWith("published");
    expect(body.items[0].kind).toBe("lgu_note");
  });

  it("POST creates a citizen root AIP feedback entry", async () => {
    mockSupabaseServer.mockResolvedValue(
      createInsertClient({
        id: "fb-2",
        target_type: "aip",
        aip_id: "aip-1",
        parent_feedback_id: null,
        kind: "question",
        body: "How will this be monitored?",
        author_id: "citizen-1",
        is_public: true,
        created_at: "2026-01-02T00:00:00.000Z",
      })
    );
    mockResolveAipById.mockResolvedValue({ id: "aip-1", status: "published" });
    mockRequireCitizenActor.mockResolvedValue({ userId: "citizen-1" });
    mockSanitizeKind.mockReturnValue("question");
    mockSanitizeBody.mockReturnValue("How will this be monitored?");
    mockHydrateAipFeedbackItems.mockResolvedValue([
      {
        id: "fb-2",
        aipId: "aip-1",
        parentFeedbackId: null,
        kind: "question",
        body: "How will this be monitored?",
        createdAt: "2026-01-02T00:00:00.000Z",
        author: {
          id: "citizen-1",
          fullName: "Citizen",
          role: "citizen",
          roleLabel: "Citizen",
          lguLabel: "Brgy. Unknown",
        },
      },
    ]);

    const { POST } = await import("@/app/api/citizen/aips/[aipId]/feedback/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({
          kind: "question",
          body: "How will this be monitored?",
        }),
      }),
      { params: Promise.resolve({ aipId: "aip-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mockRequireCitizenActor).toHaveBeenCalled();
    expect(mockAssertFeedbackUsageAllowed).toHaveBeenCalled();
    expect(mockHydrateAipFeedbackItems).toHaveBeenCalled();
    expect(body.item.id).toBe("fb-2");
  });

  it("POST returns 403 when feedback usage guard reports blocked user", async () => {
    mockSupabaseServer.mockResolvedValue(createInsertClient({}));
    mockResolveAipById.mockResolvedValue({ id: "aip-1", status: "published" });
    mockRequireCitizenActor.mockResolvedValue({ userId: "citizen-1" });
    mockSanitizeKind.mockReturnValue("question");
    mockSanitizeBody.mockReturnValue("How will this be monitored?");
    mockAssertFeedbackUsageAllowed.mockRejectedValueOnce(
      new MockFeedbackUsageError(403, "Your account is currently blocked from posting feedback.")
    );
    mockToErrorResponse.mockImplementation((error: unknown) => {
      const status = error instanceof MockCitizenAipFeedbackApiError ? error.status : 500;
      const message = error instanceof Error ? error.message : "error";
      return new Response(JSON.stringify({ error: message }), { status });
    });

    const { POST } = await import("@/app/api/citizen/aips/[aipId]/feedback/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ kind: "question", body: "How will this be monitored?" }),
      }),
      { params: Promise.resolve({ aipId: "aip-1" }) }
    );

    expect(response.status).toBe(403);
  });

  it("POST returns 429 when feedback usage guard reports rate limit", async () => {
    mockSupabaseServer.mockResolvedValue(createInsertClient({}));
    mockResolveAipById.mockResolvedValue({ id: "aip-1", status: "published" });
    mockRequireCitizenActor.mockResolvedValue({ userId: "citizen-1" });
    mockSanitizeKind.mockReturnValue("question");
    mockSanitizeBody.mockReturnValue("How will this be monitored?");
    mockAssertFeedbackUsageAllowed.mockRejectedValueOnce(
      new MockFeedbackUsageError(429, "Comment rate limit exceeded. Please try again later.")
    );
    mockToErrorResponse.mockImplementation((error: unknown) => {
      const status = error instanceof MockCitizenAipFeedbackApiError ? error.status : 500;
      const message = error instanceof Error ? error.message : "error";
      return new Response(JSON.stringify({ error: message }), { status });
    });

    const { POST } = await import("@/app/api/citizen/aips/[aipId]/feedback/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ kind: "question", body: "How will this be monitored?" }),
      }),
      { params: Promise.resolve({ aipId: "aip-1" }) }
    );

    expect(response.status).toBe(429);
  });
});
