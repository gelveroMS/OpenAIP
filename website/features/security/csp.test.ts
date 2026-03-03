import { describe, expect, it } from "vitest";
import { withSecurityHeaders } from "@/lib/security/csp";

describe("withSecurityHeaders", () => {
  it("allows inline styles in development without a style nonce", () => {
    const response = new Response(null);

    withSecurityHeaders(response, {
      isProduction: false,
      nonce: "dev-nonce",
    });

    const csp = response.headers.get("Content-Security-Policy");

    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("style-src 'self' 'nonce-dev-nonce'");
  });

  it("requires a style nonce in production", () => {
    const response = new Response(null);

    withSecurityHeaders(response, {
      isProduction: true,
      nonce: "prod-nonce",
    });

    const csp = response.headers.get("Content-Security-Policy");

    expect(csp).toContain("style-src 'self' 'nonce-prod-nonce'");
    expect(csp).not.toContain("style-src 'self' 'unsafe-inline'");
  });
});
