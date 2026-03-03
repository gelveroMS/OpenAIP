import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetActorContext = vi.fn();
const mockSupabaseServer = vi.fn();
const mockLoadAipFeedbackRowById = vi.fn();
const mockHydrateAipFeedbackItems = vi.fn();
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

class MockCitizenAipFeedbackApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

vi.mock("@/app/api/citizen/aips/_feedback-shared", () => ({
  CitizenAipFeedbackApiError: MockCitizenAipFeedbackApiError,
  hydrateAipFeedbackItems: (...args: unknown[]) => mockHydrateAipFeedbackItems(...args),
  loadAipFeedbackRowById: (...args: unknown[]) => mockLoadAipFeedbackRowById(...args),
  sanitizeFeedbackBody: (...args: unknown[]) => mockSanitizeFeedbackBody(...args),
  toErrorResponse: (error: unknown, fallback: string) => {
    const status =
      error instanceof MockCitizenAipFeedbackApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : fallback;
    return new Response(JSON.stringify({ error: message }), { status });
  },
}));

function createScopedAipClient(input?: {
  aipRow?: { id: string; status: "published" | "draft" } | null;
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
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle: async () => ({
                        data: input?.aipRow ?? { id: "aip-1", status: "published" },
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
                        target_type: "aip",
                        aip_id: "aip-1",
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

describe("handleScopedAipFeedbackReplyRequest", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockSanitizeFeedbackBody.mockImplementation((value: unknown) => {
      if (typeof value !== "string" || !value.trim()) {
        throw new MockCitizenAipFeedbackApiError(400, "Feedback content is required.");
      }
      return value.trim();
    });
    mockAssertFeedbackUsageAllowed.mockResolvedValue(undefined);
  });

  it("rejects unauthorized role for scoped route", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "official-1",
      role: "city_official",
      scope: { kind: "city", id: "city-1" },
    });
    mockSupabaseServer.mockResolvedValue(createScopedAipClient());

    const { handleScopedAipFeedbackReplyRequest } = await import(
      "@/app/api/aips/_shared/feedback-reply-handlers"
    );

    const response = await handleScopedAipFeedbackReplyRequest({
      request: new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ parentFeedbackId: "root-1", body: "Noted." }),
      }),
      scope: "barangay",
      aipId: "aip-1",
    });

    expect(response.status).toBe(401);
  });

  it("rejects non-citizen-rooted feedback threads", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "official-1",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });
    mockSupabaseServer.mockResolvedValue(createScopedAipClient());
    mockLoadAipFeedbackRowById
      .mockResolvedValueOnce({
        id: "reply-parent",
        target_type: "aip",
        aip_id: "aip-1",
        parent_feedback_id: "root-1",
        kind: "lgu_note",
        body: "Prior reply",
        author_id: "official-2",
        is_public: true,
        created_at: "2026-02-28T09:30:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "root-1",
        target_type: "aip",
        aip_id: "aip-1",
        parent_feedback_id: null,
        kind: "lgu_note",
        body: "Official root",
        author_id: "official-2",
        is_public: true,
        created_at: "2026-02-28T09:00:00.000Z",
      });
    mockHydrateAipFeedbackItems.mockResolvedValueOnce([
      {
        id: "root-1",
        aipId: "aip-1",
        parentFeedbackId: null,
        kind: "lgu_note",
        body: "Official root",
        createdAt: "2026-02-28T09:00:00.000Z",
        author: {
          id: "official-2",
          fullName: "Official",
          role: "city_official",
          roleLabel: "City Official",
          lguLabel: "City of Test",
        },
      },
    ]);

    const { handleScopedAipFeedbackReplyRequest } = await import(
      "@/app/api/aips/_shared/feedback-reply-handlers"
    );

    const response = await handleScopedAipFeedbackReplyRequest({
      request: new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ parentFeedbackId: "reply-parent", body: "Noted." }),
      }),
      scope: "barangay",
      aipId: "aip-1",
    });

    expect(response.status).toBe(403);
  });

  it("creates lgu_note reply anchored to root citizen thread", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "official-1",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });
    const client = createScopedAipClient();
    mockSupabaseServer.mockResolvedValue(client);
    mockLoadAipFeedbackRowById
      .mockResolvedValueOnce({
        id: "reply-parent",
        target_type: "aip",
        aip_id: "aip-1",
        parent_feedback_id: "root-1",
        kind: "question",
        body: "Prior reply",
        author_id: "citizen-2",
        is_public: true,
        created_at: "2026-02-28T09:30:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "root-1",
        target_type: "aip",
        aip_id: "aip-1",
        parent_feedback_id: null,
        kind: "question",
        body: "Citizen root",
        author_id: "citizen-1",
        is_public: true,
        created_at: "2026-02-28T09:00:00.000Z",
      });
    mockHydrateAipFeedbackItems
      .mockResolvedValueOnce([
        {
          id: "root-1",
          aipId: "aip-1",
          parentFeedbackId: null,
          kind: "question",
          body: "Citizen root",
          createdAt: "2026-02-28T09:00:00.000Z",
          author: {
            id: "citizen-1",
            fullName: "Citizen",
            role: "citizen",
            roleLabel: "Citizen",
            lguLabel: "Brgy. Sample",
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "reply-1",
          aipId: "aip-1",
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

    const { handleScopedAipFeedbackReplyRequest } = await import(
      "@/app/api/aips/_shared/feedback-reply-handlers"
    );

    const response = await handleScopedAipFeedbackReplyRequest({
      request: new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ parentFeedbackId: "reply-parent", body: "Noted." }),
      }),
      scope: "barangay",
      aipId: "aip-1",
    });

    expect(response.status).toBe(201);
    expect(client.getInsertedPayload()).toMatchObject({
      target_type: "aip",
      aip_id: "aip-1",
      parent_feedback_id: "root-1",
      kind: "lgu_note",
      author_id: "official-1",
    });
  });

  it("returns 403 when scoped guard reports blocked official", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "official-1",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });
    mockSupabaseServer.mockResolvedValue(createScopedAipClient());
    mockAssertFeedbackUsageAllowed.mockRejectedValueOnce(
      new MockFeedbackUsageError(403, "Your account is currently blocked from posting feedback.")
    );

    const { handleScopedAipFeedbackReplyRequest } = await import(
      "@/app/api/aips/_shared/feedback-reply-handlers"
    );

    const response = await handleScopedAipFeedbackReplyRequest({
      request: new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ parentFeedbackId: "root-1", body: "Noted." }),
      }),
      scope: "barangay",
      aipId: "aip-1",
    });

    expect(response.status).toBe(403);
  });
});
