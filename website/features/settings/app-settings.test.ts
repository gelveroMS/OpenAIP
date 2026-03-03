import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseAdmin = vi.fn();

type AdminClientOptions = {
  readErrorMessage?: string;
  writeErrorMessage?: string;
};

function createAdminClient(options: AdminClientOptions = {}) {
  return {
    schema: vi.fn(() => ({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => {
              if (options.readErrorMessage) {
                return { data: null, error: { message: options.readErrorMessage } };
              }
              return { data: null, error: null };
            }),
          })),
        })),
        upsert: vi.fn(async () => {
          if (options.writeErrorMessage) {
            return { error: { message: options.writeErrorMessage } };
          }
          return { error: null };
        }),
      })),
    })),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));

describe("app settings fallback behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSupabaseAdmin.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns default chatbot rate limit when app schema is unavailable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSupabaseAdmin.mockReturnValue(
      createAdminClient({ readErrorMessage: "Invalid schema: app" })
    );

    const { getTypedAppSetting } = await import("@/lib/settings/app-settings");
    const chatbotRateLimit = await getTypedAppSetting("controls.chatbot_rate_limit");

    expect(chatbotRateLimit).toMatchObject({
      maxRequests: 20,
      timeWindow: "per_hour",
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("returns default citizen about-us content when app schema is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSupabaseAdmin.mockReturnValue(
      createAdminClient({ readErrorMessage: "Invalid schema: app" })
    );

    const { getTypedAppSetting } = await import("@/lib/settings/app-settings");
    const aboutUs = await getTypedAppSetting("content.citizen_about_us");

    expect(aboutUs.referenceDocs).toHaveLength(4);
    expect(aboutUs.referenceDocs[0]).toMatchObject({
      id: "dbm_primer_cover",
      kind: "storage",
      bucketId: "about-us-docs",
    });
    expect(aboutUs.referenceDocs[1]).toMatchObject({
      id: "dbm_primer_cover_volume_2",
      kind: "storage",
      bucketId: "about-us-docs",
    });
    expect(aboutUs.quickLinks).toEqual(
      expect.arrayContaining([
        { id: "dashboard", href: "/" },
        { id: "budget_allocation", href: "/budget-allocation" },
        { id: "aips", href: "/aips" },
        { id: "projects", href: "/projects" },
      ])
    );
  });

  it("treats user as not blocked when settings store read is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSupabaseAdmin.mockReturnValue(
      createAdminClient({ readErrorMessage: "PGRST106: Invalid schema: app" })
    );

    const { isUserBlocked } = await import("@/lib/settings/app-settings");
    const blocked = await isUserBlocked("user-1");

    expect(blocked).toBe(false);
  });

  it("throws normalized error for writes when settings store is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSupabaseAdmin.mockReturnValue(
      createAdminClient({ writeErrorMessage: "permission denied for schema app" })
    );

    const {
      SETTINGS_STORE_UNAVAILABLE_MESSAGE,
      isSettingsStoreUnavailableError,
      setTypedAppSetting,
    } = await import("@/lib/settings/app-settings");

    let capturedError: unknown;
    try {
      await setTypedAppSetting("controls.chatbot_rate_limit", {
        maxRequests: 20,
        timeWindow: "per_hour",
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toMatchObject({
      name: "SettingsStoreUnavailableError",
      message: SETTINGS_STORE_UNAVAILABLE_MESSAGE,
    });
    expect(isSettingsStoreUnavailableError(capturedError)).toBe(true);
  });
});
