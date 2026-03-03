import { describe, expect, it, vi } from "vitest";
import { resolveBaseUrlFromHeaderValues } from "@/lib/actions/auth.actions";

describe("resolveBaseUrlFromHeaderValues", () => {
  it("uses BASE_URL when it is configured", () => {
    vi.stubEnv("BASE_URL", "https://example.com/");

    expect(
      resolveBaseUrlFromHeaderValues({
        host: "localhost:3000",
        forwardedHost: null,
        forwardedProto: null,
      })
    ).toBe("https://example.com");

    vi.unstubAllEnvs();
  });

  it("falls back to forwarded headers when BASE_URL is missing", () => {
    vi.unstubAllEnvs();
    delete process.env.BASE_URL;

    expect(
      resolveBaseUrlFromHeaderValues({
        host: "localhost:3000",
        forwardedHost: "demo.example.com",
        forwardedProto: "https",
      })
    ).toBe("https://demo.example.com");
  });

  it("falls back to localhost in development when no headers are available", () => {
    vi.unstubAllEnvs();
    delete process.env.BASE_URL;

    expect(
      resolveBaseUrlFromHeaderValues({
        host: null,
        forwardedHost: null,
        forwardedProto: null,
      })
    ).toBe("http://localhost:3000");
  });
});
