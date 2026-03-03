import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteActivityLog = vi.fn();
const mockGetActivityScopeFromActor = vi.fn();
const mockGetActorContext = vi.fn();
const mockGetTypedAppSetting = vi.fn();
const mockSetTypedAppSetting = vi.fn();
const mockIsSettingsStoreUnavailableError = vi.fn();
const mockSupabaseAdmin = vi.fn();

function createSystemAdminClient(logs: unknown[] = []) {
  return {
    from: (table: string) => {
      if (table !== "activity_log") {
        throw new Error(`Unexpected table ${table}`);
      }
      return {
        select: () => ({
          in: () => ({
            order: () => ({
              limit: async () => ({ data: logs, error: null }),
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
  getTypedAppSetting: (...args: unknown[]) => mockGetTypedAppSetting(...args),
  setTypedAppSetting: (...args: unknown[]) => mockSetTypedAppSetting(...args),
  isSettingsStoreUnavailableError: (...args: unknown[]) =>
    mockIsSettingsStoreUnavailableError(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => mockSupabaseAdmin(),
}));

describe("system-administration route contract", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetActorContext.mockResolvedValue({ role: "admin", userId: "admin-1" });
    mockGetActivityScopeFromActor.mockReturnValue({});
    mockWriteActivityLog.mockResolvedValue(undefined);
    mockIsSettingsStoreUnavailableError.mockReturnValue(false);
    mockSupabaseAdmin.mockReturnValue(createSystemAdminClient());
  });

  it("GET returns the updated response shape", async () => {
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
      title: "Planned Maintenance",
      message: "Maintenance is scheduled tonight.",
      severity: "Warning",
      startAt: null,
      endAt: null,
    };
    const systemBannerPublished = {
      ...systemBannerDraft,
      publishedAt: "2026-03-01T00:00:00.000Z",
    };

    mockGetTypedAppSetting.mockImplementation(async (key: string) => {
      if (key === "system.security_settings") return securitySettings;
      if (key === "system.banner_draft") return systemBannerDraft;
      if (key === "system.banner_published") return systemBannerPublished;
      return null;
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

  it("POST rejects removed update_notification_settings action", async () => {
    const { POST } = await import("@/app/api/admin/system-administration/route");
    const request = new Request("http://localhost/api/admin/system-administration", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "update_notification_settings",
        payload: {
          next: {},
        },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: "Unsupported action." });
  });

  it("POST unpublish_system_banner clears published banner and writes audit log", async () => {
    const currentPublished = {
      title: "Critical Notice",
      message: "Emergency downtime.",
      severity: "Critical",
      startAt: null,
      endAt: null,
      publishedAt: "2026-03-01T00:00:00.000Z",
    };
    mockGetTypedAppSetting.mockImplementation(async (key: string) => {
      if (key === "system.banner_published") return currentPublished;
      return null;
    });
    mockSetTypedAppSetting.mockResolvedValue(null);

    const { POST } = await import("@/app/api/admin/system-administration/route");
    const request = new Request("http://localhost/api/admin/system-administration", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "unpublish_system_banner",
        payload: {
          meta: {
            performedBy: "Admin",
            reason: "Issue resolved",
          },
        },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ unpublished: true });
    expect(mockSetTypedAppSetting).toHaveBeenCalledWith("system.banner_published", null);
    expect(mockWriteActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "system_banner_unpublished",
      })
    );
  });

  it("POST publish_system_banner validates invalid schedule windows", async () => {
    const { POST } = await import("@/app/api/admin/system-administration/route");
    const request = new Request("http://localhost/api/admin/system-administration", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "publish_system_banner",
        payload: {
          draft: {
            title: "Test",
            message: "Window test",
            severity: "Info",
            startAt: "2026-03-02T10:00:00.000Z",
            endAt: "2026-03-02T09:00:00.000Z",
          },
        },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      message: "Banner end date must be later than the start date.",
    });
  });

  it("POST publish_system_banner blocks schedules that are already past", async () => {
    const { POST } = await import("@/app/api/admin/system-administration/route");
    const request = new Request("http://localhost/api/admin/system-administration", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "publish_system_banner",
        payload: {
          draft: {
            title: "Past Schedule",
            message: "Already ended",
            severity: "Warning",
            startAt: "2020-03-01T10:00:00.000Z",
            endAt: "2020-03-01T11:00:00.000Z",
          },
        },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      message: "Banner schedule is already in the past.",
    });
  });
});
