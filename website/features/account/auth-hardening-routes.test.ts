import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseServer = vi.fn();
const mockGetSecuritySettings = vi.fn();
const mockGetLoginAttemptStatus = vi.fn();
const mockRecordLoginFailure = vi.fn();
const mockClearLoginAttemptState = vi.fn();
const mockGetRequestFingerprint = vi.fn();
const mockApplySessionPolicyCookies = vi.fn();
const mockGetCitizenProfileByUserId = vi.fn();
const mockIsCitizenProfileComplete = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

vi.mock("@/lib/security/security-settings.server", () => ({
  getSecuritySettings: () => mockGetSecuritySettings(),
}));

vi.mock("@/lib/security/login-attempts.server", () => ({
  getLoginAttemptStatus: (...args: unknown[]) => mockGetLoginAttemptStatus(...args),
  recordLoginFailure: (...args: unknown[]) => mockRecordLoginFailure(...args),
  clearLoginAttemptState: (...args: unknown[]) => mockClearLoginAttemptState(...args),
  getRequestFingerprint: (...args: unknown[]) => mockGetRequestFingerprint(...args),
}));

vi.mock("@/lib/security/session-cookies.server", () => ({
  applySessionPolicyCookies: (...args: unknown[]) => mockApplySessionPolicyCookies(...args),
  clearSessionPolicyCookies: vi.fn(),
}));

vi.mock("@/lib/auth/citizen-profile-completion", () => ({
  getCitizenProfileByUserId: (...args: unknown[]) => mockGetCitizenProfileByUserId(...args),
  isCitizenProfileComplete: (...args: unknown[]) => mockIsCitizenProfileComplete(...args),
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

describe("auth hardening routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetSecuritySettings.mockResolvedValue(defaultSecuritySettings);
    mockGetLoginAttemptStatus.mockResolvedValue({
      isLocked: false,
      failedCount: 0,
      lockedUntil: null,
    });
    mockRecordLoginFailure.mockResolvedValue({
      isLocked: false,
      failedCount: 1,
      lockedUntil: null,
    });
    mockClearLoginAttemptState.mockResolvedValue(undefined);
    mockGetRequestFingerprint.mockReturnValue("203.0.113.50");
    mockGetCitizenProfileByUserId.mockResolvedValue({
      role: "citizen",
      full_name: "Citizen User",
      barangay_id: "barangay-1",
    });
    mockIsCitizenProfileComplete.mockReturnValue(true);
    mockApplySessionPolicyCookies.mockImplementation(() => undefined);
  });

  it("POST /auth/sign-in returns 429 when citizen email is locked", async () => {
    mockGetLoginAttemptStatus.mockResolvedValue({
      isLocked: true,
      failedCount: 0,
      lockedUntil: "2099-01-01T00:00:00.000Z",
    });

    const { POST } = await import("@/app/auth/sign-in/route");
    const request = new Request("http://localhost/auth/sign-in", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "citizen@example.com",
        password: "Password123!",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.ok).toBe(false);
    expect(body.error?.message).toBe("Too many failed login attempts. Please try again later.");
    expect(body.error?.message).not.toContain("Try again in");
    expect(mockSupabaseServer).not.toHaveBeenCalled();
  });

  it("POST /auth/staff-sign-in returns 429 when email is locked", async () => {
    mockGetLoginAttemptStatus.mockResolvedValue({
      isLocked: true,
      failedCount: 0,
      lockedUntil: "2099-01-01T00:00:00.000Z",
    });

    const { POST } = await import("@/app/auth/staff-sign-in/route");
    const request = new Request("http://localhost/auth/staff-sign-in", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        role: "admin",
        email: "admin@example.com",
        password: "Password123!",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.ok).toBe(false);
    expect(body.error?.message).toBe("Too many failed login attempts. Please try again later.");
    expect(body.error?.message).not.toContain("Try again in");
    expect(mockSupabaseServer).not.toHaveBeenCalled();
  });

  it("POST /auth/staff-sign-in treats role mismatch as failed attempt", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
        signOut,
      },
      rpc: vi.fn().mockResolvedValue({
        data: "city_official",
        error: null,
      }),
    };
    mockSupabaseServer.mockResolvedValue(client);

    const { POST } = await import("@/app/auth/staff-sign-in/route");
    const request = new Request("http://localhost/auth/staff-sign-in", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        role: "admin",
        email: "official@example.com",
        password: "Password123!",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error?.message).toBe("Invalid email or password.");
    expect(body.error?.message).not.toContain("Role Validation Failed");
    expect(body.error?.message).not.toContain("Try again in");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(mockRecordLoginFailure).toHaveBeenCalledTimes(1);
  });

  it("POST /auth/update-password enforces password policy server-side", async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
        updateUser,
      },
    };
    mockSupabaseServer.mockResolvedValue(client);

    const { POST } = await import("@/app/auth/update-password/route");
    const request = new Request("http://localhost/auth/update-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        password: "weak",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("POST /auth/update-password refreshes session policy cookies on success", async () => {
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
        updateUser: vi.fn().mockResolvedValue({ error: null }),
      },
    };
    mockSupabaseServer.mockResolvedValue(client);

    const { POST } = await import("@/app/auth/update-password/route");
    const request = new Request("http://localhost/auth/update-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        password: "ValidPassword123!",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockApplySessionPolicyCookies).toHaveBeenCalledTimes(1);
  });

  it("POST /auth/session/activity returns 401 without active session", async () => {
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    };
    mockSupabaseServer.mockResolvedValue(client);

    const { POST } = await import("@/app/auth/session/activity/route");
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
  });

  it("POST /auth/session/activity returns timeout policy and refreshes cookies", async () => {
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
    };
    mockSupabaseServer.mockResolvedValue(client);

    const { POST } = await import("@/app/auth/session/activity/route");
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.timeoutMs).toBe("number");
    expect(typeof body.warningMs).toBe("number");
    expect(typeof body.lastActivityAtMs).toBe("number");
    expect(mockApplySessionPolicyCookies).toHaveBeenCalledTimes(1);
  });
});
