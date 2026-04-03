import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseServer = vi.fn();
const mockGetSecuritySettings = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

vi.mock("@/lib/security/security-settings.server", () => ({
  getSecuritySettings: () => mockGetSecuritySettings(),
}));

const defaultSecuritySettings = {
  passwordPolicy: {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialCharacters: true,
  },
  sessionTimeout: {
    timeoutValue: 30,
    timeUnit: "minutes" as const,
    warningMinutes: 5,
  },
  loginAttemptLimits: {
    maxAttempts: 5,
    lockoutDuration: 30,
    lockoutUnit: "minutes" as const,
  },
};

function buildRequest(input?: { email?: string; password?: string }) {
  return new Request("http://localhost/auth/sign-up", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: input?.email ?? "citizen@example.com",
      password: input?.password ?? "ValidPassword123!",
    }),
  });
}

describe("POST /auth/sign-up enumeration resistance", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetSecuritySettings.mockResolvedValue(defaultSecuritySettings);
  });

  it("returns indistinguishable responses for existing and new accounts", async () => {
    const existingClient = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: {
            user: {
              identities: [],
            },
          },
          error: null,
        }),
      },
    };
    const newClient = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: {
            user: {
              identities: [{}],
            },
          },
          error: null,
        }),
      },
    };

    mockSupabaseServer.mockResolvedValueOnce(existingClient);
    const { POST } = await import("@/app/auth/sign-up/route");
    const existingResponse = await POST(buildRequest());
    const existingBody = await existingResponse.json();

    mockSupabaseServer.mockResolvedValueOnce(newClient);
    const newResponse = await POST(buildRequest());
    const newBody = await newResponse.json();

    expect(existingResponse.status).toBe(200);
    expect(newResponse.status).toBe(200);
    expect(existingBody).toEqual(newBody);
    expect(existingBody).toEqual({
      ok: true,
      next: "verify_otp",
      message: "If the request can be processed, check your email for the next step.",
    });
  });

  it("returns the same generic success shape when provider returns existing-account style error", async () => {
    const client = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: "User already registered" },
        }),
      },
    };
    mockSupabaseServer.mockResolvedValue(client);

    const { POST } = await import("@/app/auth/sign-up/route");
    const response = await POST(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      next: "verify_otp",
      message: "If the request can be processed, check your email for the next step.",
    });
  });

  it("keeps malformed input validation behavior", async () => {
    const { POST } = await import("@/app/auth/sign-up/route");
    const response = await POST(
      buildRequest({
        email: "invalid-email",
        password: "ValidPassword123!",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.message).toBe("A valid email and password are required.");
  });

  it("keeps password policy validation behavior", async () => {
    const { POST } = await import("@/app/auth/sign-up/route");
    const response = await POST(
      buildRequest({
        password: "weakpass",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
  });
});
