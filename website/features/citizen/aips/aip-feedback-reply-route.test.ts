import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseServer = vi.fn();
const mockResolveAipById = vi.fn();
const mockAssertPublishedAipStatus = vi.fn();
const mockRequireCitizenActor = vi.fn();
const mockLoadAipFeedbackRowById = vi.fn();
const mockSanitizeKind = vi.fn();
const mockSanitizeBody = vi.fn();
const mockHydrateAipFeedbackItems = vi.fn();
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
  requireCitizenActor: mockRequireCitizenActor,
  loadAipFeedbackRowById: mockLoadAipFeedbackRowById,
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

describe("POST /api/citizen/aips/[aipId]/feedback/reply", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockToErrorResponse.mockImplementation(
      () => new Response(JSON.stringify({ error: "mock error" }), { status: 500 })
    );
    mockAssertFeedbackUsageAllowed.mockResolvedValue(undefined);
  });

  it("creates an AIP feedback reply anchored to the root thread", async () => {
    mockSupabaseServer.mockResolvedValue(
      createInsertClient({
        id: "fb-r1",
        target_type: "aip",
        aip_id: "aip-1",
        parent_feedback_id: "fb-root",
        kind: "question",
        body: "Following up.",
        author_id: "citizen-1",
        is_public: true,
        created_at: "2026-01-03T00:00:00.000Z",
      })
    );
    mockResolveAipById.mockResolvedValue({ id: "aip-1", status: "published" });
    mockRequireCitizenActor.mockResolvedValue({ userId: "citizen-1" });
    mockLoadAipFeedbackRowById
      .mockResolvedValueOnce({
        id: "fb-parent",
        target_type: "aip",
        aip_id: "aip-1",
        parent_feedback_id: "fb-root",
        kind: "question",
        body: "Parent",
        author_id: "citizen-2",
        is_public: true,
        created_at: "2026-01-02T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "fb-root",
        target_type: "aip",
        aip_id: "aip-1",
        parent_feedback_id: null,
        kind: "question",
        body: "Root",
        author_id: "citizen-3",
        is_public: true,
        created_at: "2026-01-01T00:00:00.000Z",
      });
    mockSanitizeKind.mockReturnValue("question");
    mockSanitizeBody.mockReturnValue("Following up.");
    mockHydrateAipFeedbackItems.mockResolvedValue([
      {
        id: "fb-r1",
        aipId: "aip-1",
        parentFeedbackId: "fb-root",
        kind: "question",
        body: "Following up.",
        createdAt: "2026-01-03T00:00:00.000Z",
        author: {
          id: "citizen-1",
          fullName: "Citizen",
          role: "citizen",
          roleLabel: "Citizen",
          lguLabel: "Brgy. Unknown",
        },
      },
    ]);

    const { POST } = await import(
      "@/app/api/citizen/aips/[aipId]/feedback/reply/route"
    );
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({
          parentFeedbackId: "fb-parent",
          kind: "question",
          body: "Following up.",
        }),
      }),
      { params: Promise.resolve({ aipId: "aip-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mockLoadAipFeedbackRowById).toHaveBeenCalledWith(expect.anything(), "fb-parent");
    expect(mockLoadAipFeedbackRowById).toHaveBeenCalledWith(expect.anything(), "fb-root");
    expect(body.item.parentFeedbackId).toBe("fb-root");
  });

  it("rejects replies to workflow-rooted feedback threads", async () => {
    mockSupabaseServer.mockResolvedValue(createInsertClient({}));
    mockResolveAipById.mockResolvedValue({ id: "aip-1", status: "published" });
    mockRequireCitizenActor.mockResolvedValue({ userId: "citizen-1" });
    mockLoadAipFeedbackRowById
      .mockResolvedValueOnce({
        id: "fb-parent",
        target_type: "aip",
        aip_id: "aip-1",
        parent_feedback_id: "fb-root",
        kind: "lgu_note",
        body: "Parent",
        author_id: "official-1",
        is_public: true,
        created_at: "2026-01-02T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "fb-root",
        target_type: "aip",
        aip_id: "aip-1",
        parent_feedback_id: null,
        kind: "lgu_note",
        body: "Root",
        author_id: "official-1",
        is_public: true,
        created_at: "2026-01-01T00:00:00.000Z",
      });
    mockSanitizeKind.mockReturnValue("question");
    mockSanitizeBody.mockReturnValue("Following up.");
    mockHydrateAipFeedbackItems.mockResolvedValueOnce([
      {
        id: "fb-root",
        aipId: "aip-1",
        parentFeedbackId: null,
        kind: "lgu_note",
        body: "Root",
        createdAt: "2026-01-01T00:00:00.000Z",
        author: {
          id: "official-1",
          fullName: "Official",
          role: "city_official",
          roleLabel: "City Official",
          lguLabel: "City of Test",
        },
      },
    ]);
    mockToErrorResponse.mockImplementation(
      (error: unknown) =>
        new Response(
          JSON.stringify({ error: error instanceof Error ? error.message : "error" }),
          {
            status:
              error instanceof MockCitizenAipFeedbackApiError ? error.status : 500,
          }
        )
    );

    const { POST } = await import(
      "@/app/api/citizen/aips/[aipId]/feedback/reply/route"
    );
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({
          parentFeedbackId: "fb-parent",
          kind: "question",
          body: "Following up.",
        }),
      }),
      { params: Promise.resolve({ aipId: "aip-1" }) }
    );

    expect(response.status).toBe(403);
  });

  it("returns 429 when reply guard reports comment rate limit", async () => {
    mockSupabaseServer.mockResolvedValue(createInsertClient({}));
    mockResolveAipById.mockResolvedValue({ id: "aip-1", status: "published" });
    mockRequireCitizenActor.mockResolvedValue({ userId: "citizen-1" });
    mockSanitizeKind.mockReturnValue("question");
    mockSanitizeBody.mockReturnValue("Following up.");
    mockAssertFeedbackUsageAllowed.mockRejectedValueOnce(
      new MockFeedbackUsageError(429, "Comment rate limit exceeded. Please try again later.")
    );
    mockToErrorResponse.mockImplementation(
      (error: unknown) =>
        new Response(
          JSON.stringify({ error: error instanceof Error ? error.message : "error" }),
          {
            status:
              error instanceof MockCitizenAipFeedbackApiError ? error.status : 500,
          }
        )
    );

    const { POST } = await import(
      "@/app/api/citizen/aips/[aipId]/feedback/reply/route"
    );
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({
          parentFeedbackId: "fb-parent",
          kind: "question",
          body: "Following up.",
        }),
      }),
      { params: Promise.resolve({ aipId: "aip-1" }) }
    );

    expect(response.status).toBe(429);
  });
});
