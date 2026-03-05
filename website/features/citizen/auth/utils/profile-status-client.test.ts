import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCitizenProfileStatus,
  invalidateCitizenProfileStatusCache,
} from "./profile-status-client";

function createUnauthorizedResponse(): Response {
  return {
    ok: false,
    status: 401,
    json: async () => ({ ok: false, error: { message: "Authentication required." } }),
  } as Response;
}

describe("profile-status-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    invalidateCitizenProfileStatusCache();
  });

  it("deduplicates concurrent /profile/status requests", async () => {
    const fetchMock = vi.fn(async () => createUnauthorizedResponse());
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      getCitizenProfileStatus(),
      getCitizenProfileStatus(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.kind).toBe("anonymous");
    expect(second.kind).toBe("anonymous");
  });

  it("bypasses passive non-auth reuse when force=true", async () => {
    const fetchMock = vi.fn(async () => createUnauthorizedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getCitizenProfileStatus();
    await getCitizenProfileStatus();
    await getCitizenProfileStatus({ force: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates non-auth reuse cache when explicitly reset", async () => {
    const fetchMock = vi.fn(async () => createUnauthorizedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getCitizenProfileStatus();
    await getCitizenProfileStatus();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    invalidateCitizenProfileStatusCache();

    await getCitizenProfileStatus();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
