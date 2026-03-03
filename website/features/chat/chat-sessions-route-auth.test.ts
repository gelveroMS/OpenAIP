import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetActorContext = vi.fn();

vi.mock("@/lib/domain/get-actor-context", () => ({
  getActorContext: () => mockGetActorContext(),
}));

let barangayGetHandler: typeof import("@/app/api/barangay/chat/sessions/route").GET | null = null;
let cityGetHandler: typeof import("@/app/api/city/chat/sessions/route").GET | null = null;

async function getBarangayGetHandler() {
  if (barangayGetHandler) return barangayGetHandler;
  const routeModule = await import("@/app/api/barangay/chat/sessions/route");
  barangayGetHandler = routeModule.GET;
  return barangayGetHandler;
}

async function getCityGetHandler() {
  if (cityGetHandler) return cityGetHandler;
  const routeModule = await import("@/app/api/city/chat/sessions/route");
  cityGetHandler = routeModule.GET;
  return cityGetHandler;
}

function makeRequest(pathname: string) {
  return new Request(`http://localhost${pathname}`, {
    method: "GET",
  });
}

describe("LGU chat session route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    barangayGetHandler = null;
    cityGetHandler = null;
  });

  it("tells city officials to use the city sessions route", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "user-1",
      role: "city_official",
      scope: { kind: "city", id: "city-1" },
    });

    const get = await getBarangayGetHandler();
    const response = await get(makeRequest("/api/barangay/chat/sessions"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: "Use /api/city/chat/sessions for city officials.",
    });
  });

  it("tells barangay officials to use the barangay sessions route", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "user-2",
      role: "barangay_official",
      scope: { kind: "barangay", id: "brgy-1" },
    });

    const get = await getCityGetHandler();
    const response = await get(makeRequest("/api/city/chat/sessions"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: "Use /api/barangay/chat/sessions for barangay officials.",
    });
  });

  it("returns authentication required when no actor is resolved", async () => {
    mockGetActorContext.mockResolvedValue(null);

    const get = await getBarangayGetHandler();
    const response = await get(makeRequest("/api/barangay/chat/sessions"));

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

    const get = await getBarangayGetHandler();
    const response = await get(makeRequest("/api/barangay/chat/sessions"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: "Only barangay and city officials can use the LGU chatbot.",
    });
  });
});
