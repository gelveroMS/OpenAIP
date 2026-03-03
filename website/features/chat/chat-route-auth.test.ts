import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetActorContext = vi.fn();

vi.mock("@/lib/domain/get-actor-context", () => ({
  getActorContext: () => mockGetActorContext(),
}));

vi.mock("@/lib/security/csrf", () => ({
  enforceCsrfProtection: () => ({ ok: true }),
}));

let barangayPostHandler: typeof import("@/app/api/barangay/chat/messages/route").POST | null = null;
let cityPostHandler: typeof import("@/app/api/city/chat/messages/route").POST | null = null;

async function getBarangayPostHandler() {
  if (barangayPostHandler) return barangayPostHandler;
  const routeModule = await import("@/app/api/barangay/chat/messages/route");
  barangayPostHandler = routeModule.POST;
  return barangayPostHandler;
}

async function getCityPostHandler() {
  if (cityPostHandler) return cityPostHandler;
  const routeModule = await import("@/app/api/city/chat/messages/route");
  cityPostHandler = routeModule.POST;
  return cityPostHandler;
}

function makeRequest(pathname: string) {
  return new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify({
      content: "hello",
    }),
  });
}

describe("LGU chat route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    barangayPostHandler = null;
    cityPostHandler = null;
  });

  it("tells city officials to use the city route", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "user-1",
      role: "city_official",
      scope: { kind: "city", id: "city-1" },
    });

    const post = await getBarangayPostHandler();
    const response = await post(makeRequest("/api/barangay/chat/messages"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: "Use /api/city/chat/messages for city officials.",
    });
  });

  it("tells barangay officials to use the barangay route", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "user-2",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });

    const post = await getCityPostHandler();
    const response = await post(makeRequest("/api/city/chat/messages"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: "Use /api/barangay/chat/messages for barangay officials.",
    });
  });

  it("returns authentication required when no actor is resolved", async () => {
    mockGetActorContext.mockResolvedValue(null);

    const post = await getBarangayPostHandler();
    const response = await post(makeRequest("/api/barangay/chat/messages"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: "Authentication required.",
    });
  });

  it("rejects unsupported roles with a forbidden message", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "user-3",
      role: "admin",
      scope: { kind: "none" },
    });

    const post = await getBarangayPostHandler();
    const response = await post(makeRequest("/api/barangay/chat/messages"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: "Only barangay and city officials can use the LGU chatbot.",
    });
  });
});
