import { describe, expect, it } from "vitest";
import { validateRequestOrigin } from "@/lib/security/csrf";

describe("validateRequestOrigin", () => {
  it("rejects a same-origin host when it is not in the configured allowlist", () => {
    const request = new Request("http://192.168.1.50:3000/api/barangay/chat/messages", {
      method: "POST",
      headers: {
        origin: "http://192.168.1.50:3000",
      },
    });

    expect(validateRequestOrigin(request, ["http://localhost:3000"])).toBe(false);
  });

  it("still rejects cross-origin requests", () => {
    const request = new Request("http://192.168.1.50:3000/api/barangay/chat/messages", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
      },
    });

    expect(validateRequestOrigin(request, ["http://localhost:3000"])).toBe(false);
  });
});
