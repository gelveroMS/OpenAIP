import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetActorContext = vi.fn();
const mockToPrivilegedActorContext = vi.fn();
const mockReadProjectMediaBlob = vi.fn();
const mockReadProjectCoverBlob = vi.fn();

vi.mock("@/lib/domain/get-actor-context", () => ({
  getActorContext: (...args: unknown[]) => mockGetActorContext(...args),
}));

vi.mock("@/lib/supabase/privileged-ops", () => ({
  toPrivilegedActorContext: (...args: unknown[]) => mockToPrivilegedActorContext(...args),
  readProjectMediaBlob: (...args: unknown[]) => mockReadProjectMediaBlob(...args),
  readProjectCoverBlob: (...args: unknown[]) => mockReadProjectCoverBlob(...args),
}));

describe("project media security route mapping", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("maps invariant errors in /api/projects/media/[mediaId] to 403", async () => {
    const { InvariantError } = await import("@/lib/security/invariants");
    mockGetActorContext.mockResolvedValue(null);
    mockToPrivilegedActorContext.mockReturnValue(null);
    mockReadProjectMediaBlob.mockRejectedValue(new InvariantError(403, "Unauthorized."));

    const { GET } = await import("@/app/api/projects/media/[mediaId]/route");
    const response = await GET(
      new Request("http://localhost/api/projects/media/media-1"),
      { params: Promise.resolve({ mediaId: "media-1" }) }
    );

    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body).toEqual({ message: "Unauthorized." });
  });

  it("maps invariant errors in /api/projects/cover/[projectId] to 401", async () => {
    const { InvariantError } = await import("@/lib/security/invariants");
    mockGetActorContext.mockResolvedValue(null);
    mockToPrivilegedActorContext.mockReturnValue(null);
    mockReadProjectCoverBlob.mockRejectedValue(new InvariantError(401, "Unauthorized."));

    const { GET } = await import("@/app/api/projects/cover/[projectId]/route");
    const response = await GET(
      new Request("http://localhost/api/projects/cover/project-1"),
      { params: Promise.resolve({ projectId: "project-1" }) }
    );

    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body).toEqual({ message: "Unauthorized." });
  });
});
