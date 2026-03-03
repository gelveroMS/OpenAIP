import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseServer = vi.fn();
const mockResolveProjectByIdOrRef = vi.fn();
const mockAssertPublishedProjectAip = vi.fn();
const mockRequireCitizenActor = vi.fn();
const mockSanitizeKind = vi.fn();
const mockSanitizeBody = vi.fn();
const mockHydrateProjectFeedbackItems = vi.fn();
const mockToErrorResponse = vi.fn();
const mockAssertFeedbackUsageAllowed = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

class MockCitizenFeedbackApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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

vi.mock("@/app/api/citizen/feedback/_shared", () => ({
  CitizenFeedbackApiError: MockCitizenFeedbackApiError,
  resolveProjectByIdOrRef: mockResolveProjectByIdOrRef,
  assertPublishedProjectAip: mockAssertPublishedProjectAip,
  requireCitizenActor: mockRequireCitizenActor,
  sanitizeCitizenFeedbackKind: mockSanitizeKind,
  sanitizeFeedbackBody: mockSanitizeBody,
  hydrateProjectFeedbackItems: mockHydrateProjectFeedbackItems,
  toErrorResponse: mockToErrorResponse,
  listPublicProjectFeedback: vi.fn(),
  resolveViewerUserId: vi.fn(),
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

describe("POST /api/citizen/feedback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockToErrorResponse.mockImplementation(
      () => new Response(JSON.stringify({ error: "mock error" }), { status: 500 })
    );
    mockAssertFeedbackUsageAllowed.mockResolvedValue(undefined);
  });

  it("returns 429 when project feedback guard reports rate limit", async () => {
    mockSupabaseServer.mockResolvedValue(createInsertClient({}));
    mockResolveProjectByIdOrRef.mockResolvedValue({ id: "project-1", aipStatus: "published" });
    mockRequireCitizenActor.mockResolvedValue({ userId: "citizen-1" });
    mockSanitizeKind.mockReturnValue("question");
    mockSanitizeBody.mockReturnValue("How will this be monitored?");
    mockAssertFeedbackUsageAllowed.mockRejectedValueOnce(
      new MockFeedbackUsageError(429, "Comment rate limit exceeded. Please try again later.")
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

    const { POST } = await import("@/app/api/citizen/feedback/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({
          projectId: "project-1",
          kind: "question",
          body: "How will this be monitored?",
        }),
      })
    );

    expect(response.status).toBe(429);
  });
});
