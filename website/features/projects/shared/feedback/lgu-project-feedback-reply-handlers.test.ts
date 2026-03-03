import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetActorContext = vi.fn();
const mockSupabaseServer = vi.fn();
const mockLoadProjectFeedbackRowById = vi.fn();
const mockHydrateProjectFeedbackItems = vi.fn();
const mockSanitizeFeedbackBody = vi.fn();
const mockAssertFeedbackUsageAllowed = vi.fn();

vi.mock("@/lib/domain/get-actor-context", () => ({
  getActorContext: () => mockGetActorContext(),
}));

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
  CITIZEN_PROJECT_FEEDBACK_KINDS: ["question", "suggestion", "concern", "commend"],
  CitizenFeedbackApiError: MockCitizenFeedbackApiError,
  hydrateProjectFeedbackItems: (...args: unknown[]) => mockHydrateProjectFeedbackItems(...args),
  isUuid: (value: string) => value.startsWith("00000000"),
  loadProjectFeedbackRowById: (...args: unknown[]) => mockLoadProjectFeedbackRowById(...args),
  sanitizeFeedbackBody: (...args: unknown[]) => mockSanitizeFeedbackBody(...args),
  toErrorResponse: (error: unknown, fallback: string) => {
    const status =
      error instanceof MockCitizenFeedbackApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : fallback;
    return new Response(JSON.stringify({ error: message }), { status });
  },
}));

function createScopedProjectClient(input?: {
  aipRows?: Array<{ id: string; status: "published" | "draft" }>;
  projectRows?: Array<{
    id: string;
    aip_id: string;
    aip_ref_code: string;
    category: "health" | "infrastructure" | "other";
    created_at: string;
  }>;
  insertedRow?: Record<string, unknown> | null;
}) {
  let insertedPayload: Record<string, unknown> | null = null;

  const client = {
    getInsertedPayload: () => insertedPayload,
    from(table: string) {
      if (table === "aips") {
        return {
          select() {
            return {
              eq: async () => ({
                data: input?.aipRows ?? [{ id: "aip-1", status: "published" }],
                error: null,
              }),
            };
          },
        };
      }

      if (table === "projects") {
        return {
          select() {
            return {
              eq() {
                return {
                  in() {
                    return {
                      limit: async () => ({
                        data:
                          input?.projectRows ?? [
                            {
                              id: "project-1",
                              aip_id: "aip-1",
                              aip_ref_code: "PROJ-001",
                              category: "health",
                              created_at: "2026-02-28T00:00:00.000Z",
                            },
                          ],
                        error: null,
                      }),
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "feedback") {
        return {
          insert(payload: Record<string, unknown>) {
            insertedPayload = payload;
            return {
              select() {
                return {
                  single: async () => ({
                    data:
                      input?.insertedRow ?? {
                        id: "reply-1",
                        target_type: "project",
                        project_id: "project-1",
                        parent_feedback_id: "root-1",
                        kind: "lgu_note",
                        body: payload.body,
                        author_id: payload.author_id,
                        is_public: true,
                        created_at: "2026-02-28T10:00:00.000Z",
                      },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return client;
}

describe("handleProjectFeedbackReplyRequest", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockSanitizeFeedbackBody.mockImplementation((value: unknown) => {
      if (typeof value !== "string" || !value.trim()) {
        throw new MockCitizenFeedbackApiError(400, "Feedback content is required.");
      }
      return value.trim();
    });
    mockHydrateProjectFeedbackItems.mockResolvedValue([
      {
        id: "reply-1",
        projectId: "project-1",
        parentFeedbackId: "root-1",
        kind: "lgu_note",
        body: "Noted.",
        createdAt: "2026-02-28T10:00:00.000Z",
        author: {
          id: "official-1",
          fullName: "Official",
          role: "barangay_official",
          roleLabel: "Barangay Official",
          lguLabel: "Brgy. Sample",
        },
      },
    ]);
    mockAssertFeedbackUsageAllowed.mockResolvedValue(undefined);
  });

  it("rejects unauthorized role for scoped route", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "official-1",
      role: "city_official",
      scope: { kind: "city", id: "city-1" },
    });

    const client = createScopedProjectClient();
    mockSupabaseServer.mockResolvedValue(client);

    const { handleProjectFeedbackReplyRequest } = await import(
      "@/app/api/projects/_shared/feedback-reply-handlers"
    );

    const response = await handleProjectFeedbackReplyRequest({
      request: new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ parentFeedbackId: "root-1", body: "Noted." }),
      }),
      scope: "barangay",
      projectIdOrRef: "00000000-0000-4000-8000-000000000001",
    });

    expect(response.status).toBe(401);
  });

  it("rejects missing parent feedback id", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "official-1",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });
    mockSupabaseServer.mockResolvedValue(createScopedProjectClient());

    const { handleProjectFeedbackReplyRequest } = await import(
      "@/app/api/projects/_shared/feedback-reply-handlers"
    );

    const response = await handleProjectFeedbackReplyRequest({
      request: new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ body: "Noted." }),
      }),
      scope: "barangay",
      projectIdOrRef: "00000000-0000-4000-8000-000000000001",
    });

    expect(response.status).toBe(400);
  });

  it("rejects parent feedback that belongs to another project", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "official-1",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });
    mockSupabaseServer.mockResolvedValue(createScopedProjectClient());
    mockLoadProjectFeedbackRowById.mockResolvedValue({
      id: "root-1",
      target_type: "project",
      project_id: "project-other",
      parent_feedback_id: null,
      kind: "question",
      body: "Citizen feedback",
      author_id: "citizen-1",
      is_public: true,
      created_at: "2026-02-28T09:00:00.000Z",
    });

    const { handleProjectFeedbackReplyRequest } = await import(
      "@/app/api/projects/_shared/feedback-reply-handlers"
    );

    const response = await handleProjectFeedbackReplyRequest({
      request: new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ parentFeedbackId: "root-1", body: "Noted." }),
      }),
      scope: "barangay",
      projectIdOrRef: "00000000-0000-4000-8000-000000000001",
    });

    expect(response.status).toBe(400);
  });

  it("rejects non-citizen-rooted feedback threads", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "official-1",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });
    mockSupabaseServer.mockResolvedValue(createScopedProjectClient());
    mockLoadProjectFeedbackRowById.mockResolvedValue({
      id: "root-1",
      target_type: "project",
      project_id: "project-1",
      parent_feedback_id: null,
      kind: "lgu_note",
      body: "LGU root",
      author_id: "official-2",
      is_public: true,
      created_at: "2026-02-28T09:00:00.000Z",
    });

    const { handleProjectFeedbackReplyRequest } = await import(
      "@/app/api/projects/_shared/feedback-reply-handlers"
    );

    const response = await handleProjectFeedbackReplyRequest({
      request: new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ parentFeedbackId: "root-1", body: "Noted." }),
      }),
      scope: "barangay",
      projectIdOrRef: "00000000-0000-4000-8000-000000000001",
    });

    expect(response.status).toBe(403);
  });

  it("creates lgu_note reply anchored to the root thread", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "official-1",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });
    const client = createScopedProjectClient();
    mockSupabaseServer.mockResolvedValue(client);
    mockLoadProjectFeedbackRowById
      .mockResolvedValueOnce({
        id: "reply-parent",
        target_type: "project",
        project_id: "project-1",
        parent_feedback_id: "root-1",
        kind: "lgu_note",
        body: "Prior reply",
        author_id: "official-2",
        is_public: true,
        created_at: "2026-02-28T09:30:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "root-1",
        target_type: "project",
        project_id: "project-1",
        parent_feedback_id: null,
        kind: "question",
        body: "Citizen root",
        author_id: "citizen-1",
        is_public: true,
        created_at: "2026-02-28T09:00:00.000Z",
      });

    const { handleProjectFeedbackReplyRequest } = await import(
      "@/app/api/projects/_shared/feedback-reply-handlers"
    );

    const response = await handleProjectFeedbackReplyRequest({
      request: new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ parentFeedbackId: "reply-parent", body: "Noted." }),
      }),
      scope: "barangay",
      projectIdOrRef: "00000000-0000-4000-8000-000000000001",
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(client.getInsertedPayload()).toMatchObject({
      target_type: "project",
      project_id: "project-1",
      parent_feedback_id: "root-1",
      kind: "lgu_note",
      author_id: "official-1",
    });
    expect(body.item.kind).toBe("lgu_note");
  });

  it("allows replies for projects with category other", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "official-1",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });
    const client = createScopedProjectClient({
      projectRows: [
        {
          id: "project-1",
          aip_id: "aip-1",
          aip_ref_code: "PROJ-OTHER",
          category: "other",
          created_at: "2026-02-28T00:00:00.000Z",
        },
      ],
    });
    mockSupabaseServer.mockResolvedValue(client);
    mockLoadProjectFeedbackRowById.mockResolvedValue({
      id: "root-1",
      target_type: "project",
      project_id: "project-1",
      parent_feedback_id: null,
      kind: "question",
      body: "Citizen root",
      author_id: "citizen-1",
      is_public: true,
      created_at: "2026-02-28T09:00:00.000Z",
    });

    const { handleProjectFeedbackReplyRequest } = await import(
      "@/app/api/projects/_shared/feedback-reply-handlers"
    );

    const response = await handleProjectFeedbackReplyRequest({
      request: new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ parentFeedbackId: "root-1", body: "Noted." }),
      }),
      scope: "barangay",
      projectIdOrRef: "00000000-0000-4000-8000-000000000001",
    });

    expect(response.status).toBe(201);
    expect(client.getInsertedPayload()).toMatchObject({
      project_id: "project-1",
      kind: "lgu_note",
    });
  });

  it("returns 429 when scoped project reply guard reports rate limit", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "official-1",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });
    mockSupabaseServer.mockResolvedValue(createScopedProjectClient());
    mockAssertFeedbackUsageAllowed.mockRejectedValueOnce(
      new MockFeedbackUsageError(429, "Comment rate limit exceeded. Please try again later.")
    );

    const { handleProjectFeedbackReplyRequest } = await import(
      "@/app/api/projects/_shared/feedback-reply-handlers"
    );

    const response = await handleProjectFeedbackReplyRequest({
      request: new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ parentFeedbackId: "root-1", body: "Noted." }),
      }),
      scope: "barangay",
      projectIdOrRef: "00000000-0000-4000-8000-000000000001",
    });

    expect(response.status).toBe(429);
  });
});
