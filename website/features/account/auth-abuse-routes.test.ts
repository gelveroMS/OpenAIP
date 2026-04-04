import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseServer = vi.fn();
const mockGetOtpVerifyThrottleStatus = vi.fn();
const mockRecordOtpVerifyFailure = vi.fn();
const mockClearOtpVerifyEmailFailureState = vi.fn();
const mockConsumeOtpResendThrottle = vi.fn();
const mockConsumeForgotPasswordThrottle = vi.fn();
const mockMonitorAuthProviderCallSuppressed = vi.fn();
const mockApplySessionPolicyCookies = vi.fn();
const mockGetSecuritySettings = vi.fn();
const mockGetCitizenProfileByUserId = vi.fn();
const mockIsCitizenProfileComplete = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

vi.mock("@/lib/security/login-attempts.server", () => ({
  getOtpVerifyThrottleStatus: (...args: unknown[]) => mockGetOtpVerifyThrottleStatus(...args),
  recordOtpVerifyFailure: (...args: unknown[]) => mockRecordOtpVerifyFailure(...args),
  clearOtpVerifyEmailFailureState: (...args: unknown[]) => mockClearOtpVerifyEmailFailureState(...args),
  consumeOtpResendThrottle: (...args: unknown[]) => mockConsumeOtpResendThrottle(...args),
  consumeForgotPasswordThrottle: (...args: unknown[]) => mockConsumeForgotPasswordThrottle(...args),
  monitorAuthProviderCallSuppressed: (...args: unknown[]) =>
    mockMonitorAuthProviderCallSuppressed(...args),
}));

vi.mock("@/lib/security/session-cookies.server", () => ({
  applySessionPolicyCookies: (...args: unknown[]) => mockApplySessionPolicyCookies(...args),
  clearSessionPolicyCookies: vi.fn(),
}));

vi.mock("@/lib/security/security-settings.server", () => ({
  getSecuritySettings: () => mockGetSecuritySettings(),
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

describe("auth abuse controls routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetOtpVerifyThrottleStatus.mockResolvedValue({ isThrottled: false });
    mockRecordOtpVerifyFailure.mockResolvedValue({ isThrottled: false });
    mockClearOtpVerifyEmailFailureState.mockResolvedValue(undefined);
    mockConsumeOtpResendThrottle.mockResolvedValue({ isThrottled: false });
    mockConsumeForgotPasswordThrottle.mockResolvedValue({ isThrottled: false });
    mockMonitorAuthProviderCallSuppressed.mockImplementation(() => undefined);
    mockApplySessionPolicyCookies.mockImplementation(() => undefined);
    mockGetSecuritySettings.mockResolvedValue(defaultSecuritySettings);
    mockGetCitizenProfileByUserId.mockResolvedValue({
      role: "citizen",
      full_name: "Citizen User",
      barangay_id: "barangay-1",
    });
    mockIsCitizenProfileComplete.mockReturnValue(true);
  });

  it("POST /auth/verify-otp returns 429 when OTP precheck is throttled", async () => {
    mockGetOtpVerifyThrottleStatus.mockResolvedValueOnce({
      isThrottled: true,
    });

    const { POST } = await import("@/app/auth/verify-otp/route");
    const request = new Request("http://localhost/auth/verify-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "citizen@example.com",
        token: "123456",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.ok).toBe(false);
    expect(body.error?.message).toBe("Too many attempts. Please wait and try again.");
    expect(mockSupabaseServer).not.toHaveBeenCalled();
  });

  it("POST /auth/verify-otp records failed attempts and returns generic error", async () => {
    const client = {
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({
          error: { message: "invalid otp" },
        }),
      },
    };
    mockSupabaseServer.mockResolvedValue(client);

    const { POST } = await import("@/app/auth/verify-otp/route");
    const request = new Request("http://localhost/auth/verify-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "citizen@example.com",
        token: "123456",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.message).toBe("Invalid or expired verification code. Please try again.");
    expect(mockRecordOtpVerifyFailure).toHaveBeenCalledTimes(1);
  });

  it("POST /auth/verify-otp clears email failure state on success", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({ error: null }),
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
        signOut,
      },
      rpc: vi.fn().mockResolvedValue({
        data: "citizen",
        error: null,
      }),
    };
    mockSupabaseServer.mockResolvedValue(client);

    const { POST } = await import("@/app/auth/verify-otp/route");
    const request = new Request("http://localhost/auth/verify-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "citizen@example.com",
        token: "123456",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
    expect(mockClearOtpVerifyEmailFailureState).toHaveBeenCalledTimes(1);
    expect(mockApplySessionPolicyCookies).toHaveBeenCalledTimes(1);
  });

  it("POST /auth/resend-otp returns 429 when resend is throttled", async () => {
    mockConsumeOtpResendThrottle.mockResolvedValueOnce({
      isThrottled: true,
    });

    const { POST } = await import("@/app/auth/resend-otp/route");
    const request = new Request("http://localhost/auth/resend-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "citizen@example.com",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.ok).toBe(false);
    expect(body.error?.message).toBe("Too many attempts. Please wait and try again.");
    expect(mockSupabaseServer).not.toHaveBeenCalled();
    expect(mockMonitorAuthProviderCallSuppressed).toHaveBeenCalledTimes(1);
  });

  it("POST /auth/resend-otp returns generic provider error message", async () => {
    const client = {
      auth: {
        resend: vi.fn().mockResolvedValue({
          error: { message: "unexpected resend failure" },
        }),
      },
    };
    mockSupabaseServer.mockResolvedValue(client);

    const { POST } = await import("@/app/auth/resend-otp/route");
    const request = new Request("http://localhost/auth/resend-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "citizen@example.com",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.message).toBe("Unable to process request right now. Please try again later.");
  });

  it("POST /auth/forgot-password returns uniform success when throttled", async () => {
    mockConsumeForgotPasswordThrottle.mockResolvedValueOnce({
      isThrottled: true,
    });

    const { POST } = await import("@/app/auth/forgot-password/route");
    const request = new Request("http://localhost/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "citizen@example.com",
        role: "citizen",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message).toBe(
      "If an account exists for that email, password reset instructions will be sent."
    );
    expect(mockSupabaseServer).not.toHaveBeenCalled();
  });

  it("POST /auth/forgot-password returns uniform success when provider fails", async () => {
    const client = {
      auth: {
        resetPasswordForEmail: vi.fn().mockResolvedValue({
          error: { message: "provider unavailable" },
        }),
      },
    };
    mockSupabaseServer.mockResolvedValue(client);

    const { POST } = await import("@/app/auth/forgot-password/route");
    const request = new Request("http://localhost/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "citizen@example.com",
        role: "city",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message).toBe(
      "If an account exists for that email, password reset instructions will be sent."
    );
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith("citizen@example.com", {
      redirectTo: "http://localhost/city/update-password",
    });
  });

  it("POST /auth/forgot-password rejects invalid request shape", async () => {
    const { POST } = await import("@/app/auth/forgot-password/route");
    const request = new Request("http://localhost/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "citizen@example.com",
        role: "super_admin",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.message).toBe("A valid email is required.");
  });
});
