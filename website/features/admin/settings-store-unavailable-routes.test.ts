import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteActivityLog = vi.fn();
const mockGetActivityScopeFromActor = vi.fn();
const mockGetActorContext = vi.fn();
const mockGetTypedAppSetting = vi.fn();
const mockSetTypedAppSetting = vi.fn();
const mockSetBlockedUser = vi.fn();
const mockClearBlockedUser = vi.fn();
const mockIsSettingsStoreUnavailableError = vi.fn();
const mockSupabaseAdmin = vi.fn();
const mockMapFlaggedUsers = vi.fn();
const mockMapUserAuditHistory = vi.fn();
const mockDeriveChatbotMetrics = vi.fn();

function createSystemAdminClient() {
  return {
    from: (table: string) => {
      if (table !== "activity_log") {
        throw new Error(`Unexpected table ${table}`);
      }

      return {
        select: () => ({
          in: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      };
    },
  };
}

vi.mock("@/lib/audit/activity-log", () => ({
  writeActivityLog: mockWriteActivityLog,
}));

vi.mock("@/lib/auth/actor-scope-guards", () => ({
  getActivityScopeFromActor: mockGetActivityScopeFromActor,
}));

vi.mock("@/lib/domain/get-actor-context", () => ({
  getActorContext: mockGetActorContext,
}));

vi.mock("@/lib/settings/app-settings", () => ({
  clearBlockedUser: mockClearBlockedUser,
  getTypedAppSetting: mockGetTypedAppSetting,
  isSettingsStoreUnavailableError: mockIsSettingsStoreUnavailableError,
  setBlockedUser: mockSetBlockedUser,
  setTypedAppSetting: mockSetTypedAppSetting,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));

vi.mock("@/lib/repos/usage-controls/mappers/usage-controls.mapper", () => ({
  deriveChatbotMetrics: mockDeriveChatbotMetrics,
  mapFlaggedUsers: mockMapFlaggedUsers,
  mapUserAuditHistory: mockMapUserAuditHistory,
}));

describe("admin routes settings-store unavailable behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockGetActorContext.mockResolvedValue({ role: "admin", userId: "admin-1" });
    mockGetActivityScopeFromActor.mockReturnValue({});
    mockWriteActivityLog.mockResolvedValue(undefined);
    mockSetTypedAppSetting.mockResolvedValue({});
    mockSetBlockedUser.mockResolvedValue({});
    mockClearBlockedUser.mockResolvedValue({});
    mockIsSettingsStoreUnavailableError.mockReturnValue(false);
    mockDeriveChatbotMetrics.mockReturnValue({
      chatbotUsageTrend: [],
    });
    mockMapFlaggedUsers.mockReturnValue([]);
    mockMapUserAuditHistory.mockReturnValue([]);
    mockSupabaseAdmin.mockReturnValue(createSystemAdminClient());
  });

  it("returns 503 for usage-controls POST when settings store is unavailable", async () => {
    const unavailableError = new Error(
      'Settings store unavailable: expose schema "app" in Supabase Data API and ensure app.settings exists with service_role grants.'
    );
    mockSetTypedAppSetting.mockRejectedValue(unavailableError);
    mockIsSettingsStoreUnavailableError.mockReturnValue(true);

    const { POST } = await import("@/app/api/admin/usage-controls/route");
    const request = new Request("http://localhost/api/admin/usage-controls", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "update_chatbot_rate_limit",
        payload: {
          maxRequests: 25,
          timeWindow: "per_hour",
        },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ message: unavailableError.message });
  });

  it("returns 503 for system-administration POST when settings store is unavailable", async () => {
    const unavailableError = new Error(
      'Settings store unavailable: expose schema "app" in Supabase Data API and ensure app.settings exists with service_role grants.'
    );
    mockGetTypedAppSetting.mockResolvedValueOnce({
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialCharacters: true,
      },
      sessionTimeout: {
        timeoutValue: 30,
        timeUnit: "minutes",
        warningMinutes: 5,
      },
      loginAttemptLimits: {
        maxAttempts: 5,
        lockoutDuration: 30,
        lockoutUnit: "minutes",
      },
    });
    mockSetTypedAppSetting.mockRejectedValue(unavailableError);
    mockIsSettingsStoreUnavailableError.mockReturnValue(true);

    const { POST } = await import("@/app/api/admin/system-administration/route");
    const request = new Request(
      "http://localhost/api/admin/system-administration",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "update_security_settings",
          payload: {
            next: {
              passwordPolicy: {
                minLength: 14,
                requireUppercase: true,
                requireLowercase: true,
                requireNumbers: true,
                requireSpecialCharacters: true,
              },
              sessionTimeout: {
                timeoutValue: 45,
                timeUnit: "minutes",
                warningMinutes: 5,
              },
              loginAttemptLimits: {
                maxAttempts: 5,
                lockoutDuration: 30,
                lockoutUnit: "minutes",
              },
            },
          },
        }),
      }
    );

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ message: unavailableError.message });
  });

  it("returns 200 for system-administration GET with default settings payload", async () => {
    const securitySettings = {
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialCharacters: true,
      },
      sessionTimeout: {
        timeoutValue: 30,
        timeUnit: "minutes",
        warningMinutes: 5,
      },
      loginAttemptLimits: {
        maxAttempts: 5,
        lockoutDuration: 30,
        lockoutUnit: "minutes",
      },
    };
    const systemBannerDraft = {
      title: null,
      message: "",
      severity: "Info",
      startAt: null,
      endAt: null,
    };
    const systemBannerPublished = null;

    mockGetTypedAppSetting.mockImplementation(async (key: string) => {
      if (key === "system.security_settings") return securitySettings;
      if (key === "system.banner_draft") return systemBannerDraft;
      if (key === "system.banner_published") return systemBannerPublished;
      return {};
    });

    const { GET } = await import("@/app/api/admin/system-administration/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      securitySettings,
      systemBannerDraft,
      systemBannerPublished,
      auditLogs: [],
    });
  });
});
