import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseServer = vi.fn();
const mockEnforceCsrfProtection = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

vi.mock("@/lib/security/csrf", () => ({
  enforceCsrfProtection: (...args: unknown[]) => mockEnforceCsrfProtection(...args),
}));

import { GET as listNotifications } from "@/app/api/notifications/route";
import { POST as markAllRead } from "@/app/api/notifications/read-all/route";
import { PATCH as markOneRead } from "@/app/api/notifications/[notificationId]/read/route";

describe("notifications api routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceCsrfProtection.mockReturnValue({ ok: true });
  });

  it("requires auth for notifications list", async () => {
    mockSupabaseServer.mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { message: "Unauthorized." },
        }),
      },
    });

    const response = await listNotifications(new Request("http://localhost/api/notifications"));
    expect(response.status).toBe(401);
  });

  it("marks only current user's rows as read in mark-all endpoint", async () => {
    const eqRecipient = vi.fn(() => ({
      is: async () => ({ error: null }),
    }));
    const update = vi.fn(() => ({
      eq: eqRecipient,
    }));

    mockSupabaseServer.mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
      from: () => ({
        update,
      }),
    });

    const response = await markAllRead(
      new Request("http://localhost/api/notifications/read-all", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(eqRecipient).toHaveBeenCalledWith("recipient_user_id", "user-123");
  });

  it("marks a single notification row for the current user only", async () => {
    const eqUser = vi.fn(async () => ({ error: null }));
    const eqNotificationId = vi.fn(() => ({
      eq: eqUser,
    }));
    const update = vi.fn(() => ({
      eq: eqNotificationId,
    }));

    mockSupabaseServer.mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: { user: { id: "user-999" } },
          error: null,
        }),
      },
      from: () => ({
        update,
      }),
    });

    const response = await markOneRead(
      new Request("http://localhost/api/notifications/abc/read", {
        method: "PATCH",
        headers: {
          origin: "http://localhost:3000",
        },
      }),
      { params: Promise.resolve({ notificationId: "notif-abc" }) }
    );

    expect(response.status).toBe(200);
    expect(eqNotificationId).toHaveBeenCalledWith("id", "notif-abc");
    expect(eqUser).toHaveBeenCalledWith("recipient_user_id", "user-999");
  });
});
