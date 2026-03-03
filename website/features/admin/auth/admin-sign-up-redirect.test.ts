import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRedirect = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

describe("admin sign-up route policy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRedirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("redirects /admin/sign-up to /admin/sign-in", async () => {
    const page = (await import("@/app/admin/(auth)/sign-up/page")).default;
    expect(() => page()).toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/admin/sign-in");
  });
});
