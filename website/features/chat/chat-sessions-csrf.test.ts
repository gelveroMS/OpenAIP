import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetActorContext = vi.fn();

vi.mock("@/lib/domain/get-actor-context", () => ({
  getActorContext: () => mockGetActorContext(),
}));

let barangayPostHandler: typeof import("@/app/api/barangay/chat/sessions/route").POST | null = null;

async function getBarangayPostHandler() {
  if (barangayPostHandler) return barangayPostHandler;
  const routeModule = await import("@/app/api/barangay/chat/sessions/route");
  barangayPostHandler = routeModule.POST;
  return barangayPostHandler;
}

describe("LGU chat session CSRF protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    barangayPostHandler = null;
    mockGetActorContext.mockResolvedValue({
      userId: "user-1",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });
  });

  it("rejects POST requests without a trusted origin", async () => {
    const post = await getBarangayPostHandler();
    const response = await post(
      new Request("http://localhost/api/barangay/chat/sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: "Forbidden.",
    });
  });
});
