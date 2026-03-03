import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseServer = vi.fn();
const mockResolveProjectByIdOrRef = vi.fn();
const mockAssertPublishedProjectAip = vi.fn();
const mockRequireCitizenActor = vi.fn();
const mockLoadProjectFeedbackRowById = vi.fn();
const mockSanitizeKind = vi.fn();
const mockSanitizeBody = vi.fn();
const mockHydrateProjectFeedbackItems = vi.fn();
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

class MockCitizenFeedbackApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

vi.mock("@/app/api/citizen/feedback/_shared", () => ({
  CitizenFeedbackApiError: MockCitizenFeedbackApiError,
  resolveProjectByIdOrRef: mockResolveProjectByIdOrRef,
  assertPublishedProjectAip: mockAssertPublishedProjectAip,
  requireCitizenActor: mockRequireCitizenActor,
  loadProjectFeedbackRowById: mockLoadProjectFeedbackRowById,
  sanitizeCitizenFeedbackKind: mockSanitizeKind,
  sanitizeFeedbackBody: mockSanitizeBody,
  hydrateProjectFeedbackItems: mockHydrateProjectFeedbackItems,
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

describe("POST /api/citizen/feedback/reply", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockToErrorResponse.mockImplementation(
      () => new Response(JSON.stringify({ error: "mock error" }), { status: 500 })
    );
    mockAssertFeedbackUsageAllowed.mockResolvedValue(undefined);
  });

  it("creates project feedback reply anchored to citizen root", async () => {
    mockSupabaseServer.mockResolvedValue(
      createInsertClient({
        id: "fb-r1",
        target_type: "project",
        project_id: "project-1",
        parent_feedback_id: "fb-root",
        kind: "question",
        body: "Following up.",
        author_id: "citizen-1",
        is_public: true,
        created_at: "2026-01-03T00:00:00.000Z",
      })
    );
    mockResolveProjectByIdOrRef.mockResolvedValue({ id: "project-1", aipStatus: "published" });
    mockRequireCitizenActor.mockResolvedValue({ userId: "citizen-1" });
    mockLoadProjectFeedbackRowById
      .mockResolvedValueOnce({
        id: "fb-parent",
        target_type: "project",
        project_id: "project-1",
        parent_feedback_id: "fb-root",
        kind: "question",
        body: "Parent",
        author_id: "citizen-2",
        is_public: true,
        created_at: "2026-01-02T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "fb-root",
        target_type: "project",
        project_id: "project-1",
        parent_feedback_id: null,
        kind: "question",
        body: "Root",
        author_id: "citizen-3",
        is_public: true,
        created_at: "2026-01-01T00:00:00.000Z",
      });
    mockSanitizeKind.mockReturnValue("question");
    mockSanitizeBody.mockReturnValue("Following up.");
    mockHydrateProjectFeedbackItems
      .mockResolvedValueOnce([
        {
          id: "fb-root",
          projectId: "project-1",
          parentFeedbackId: null,
          kind: "question",
          body: "Root",
          createdAt: "2026-01-01T00:00:00.000Z",
          author: {
            id: "citizen-3",
            fullName: "Citizen",
            role: "citizen",
            roleLabel: "Citizen",
            lguLabel: "Brgy. Sample",
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "fb-r1",
          projectId: "project-1",
          parentFeedbackId: "fb-root",
          kind: "question",
          body: "Following up.",
          createdAt: "2026-01-03T00:00:00.000Z",
          author: {
            id: "citizen-1",
            fullName: "Citizen",
            role: "citizen",
            roleLabel: "Citizen",
            lguLabel: "Brgy. Sample",
          },
        },
      ]);

    const { POST } = await import("@/app/api/citizen/feedback/reply/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({
          projectId: "project-1",
          parentFeedbackId: "fb-parent",
          kind: "question",
          body: "Following up.",
        }),
      })
    );

    expect(response.status).toBe(201);
  });

  it("rejects replies to workflow-rooted project feedback threads", async () => {
    mockSupabaseServer.mockResolvedValue(createInsertClient({}));
    mockResolveProjectByIdOrRef.mockResolvedValue({ id: "project-1", aipStatus: "published" });
    mockRequireCitizenActor.mockResolvedValue({ userId: "citizen-1" });
    mockLoadProjectFeedbackRowById
      .mockResolvedValueOnce({
        id: "fb-parent",
        target_type: "project",
        project_id: "project-1",
        parent_feedback_id: "fb-root",
        kind: "lgu_note",
        body: "Parent",
        author_id: "official-1",
        is_public: true,
        created_at: "2026-01-02T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "fb-root",
        target_type: "project",
        project_id: "project-1",
        parent_feedback_id: null,
        kind: "lgu_note",
        body: "Root",
        author_id: "official-1",
        is_public: true,
        created_at: "2026-01-01T00:00:00.000Z",
      });
    mockSanitizeKind.mockReturnValue("question");
    mockSanitizeBody.mockReturnValue("Following up.");
    mockHydrateProjectFeedbackItems.mockResolvedValueOnce([
      {
        id: "fb-root",
        projectId: "project-1",
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
              error instanceof MockCitizenFeedbackApiError ? error.status : 500,
          }
        )
    );

    const { POST } = await import("@/app/api/citizen/feedback/reply/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({
          projectId: "project-1",
          parentFeedbackId: "fb-parent",
          kind: "question",
          body: "Following up.",
        }),
      })
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 when project reply guard reports blocked user", async () => {
    mockSupabaseServer.mockResolvedValue(createInsertClient({}));
    mockResolveProjectByIdOrRef.mockResolvedValue({ id: "project-1", aipStatus: "published" });
    mockRequireCitizenActor.mockResolvedValue({ userId: "citizen-1" });
    mockSanitizeKind.mockReturnValue("question");
    mockSanitizeBody.mockReturnValue("Following up.");
    mockAssertFeedbackUsageAllowed.mockRejectedValueOnce(
      new MockFeedbackUsageError(403, "Your account is currently blocked from posting feedback.")
    );
    mockToErrorResponse.mockImplementation(
      (error: unknown) =>
        new Response(
          JSON.stringify({ error: error instanceof Error ? error.message : "error" }),
          {
            status:
              error instanceof MockCitizenFeedbackApiError ? error.status : 500,
          }
        )
    );

    const { POST } = await import("@/app/api/citizen/feedback/reply/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({
          projectId: "project-1",
          parentFeedbackId: "fb-parent",
          kind: "question",
          body: "Following up.",
        }),
      })
    );

    expect(response.status).toBe(403);
  });
});
