import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetActorContext = vi.fn();
const mockSupabaseServer = vi.fn();
const mockEnforceCsrfProtection = vi.fn();
const mockWriteActivityLog = vi.fn();
const mockNotifySafely = vi.fn();

vi.mock("@/lib/domain/get-actor-context", () => ({
  getActorContext: () => mockGetActorContext(),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => mockSupabaseServer(),
}));

vi.mock("@/lib/security/csrf", () => ({
  enforceCsrfProtection: (...args: unknown[]) => mockEnforceCsrfProtection(...args),
}));

vi.mock("@/lib/audit/activity-log", () => ({
  writeActivityLog: (...args: unknown[]) => mockWriteActivityLog(...args),
}));

vi.mock("@/lib/notifications", () => ({
  notifySafely: (...args: unknown[]) => mockNotifySafely(...args),
}));

import {
  GET as getFeedbackModeration,
  POST as postFeedbackModeration,
} from "@/app/api/admin/feedback-moderation/route";
import { POST as postProjectUpdatesModeration } from "@/app/api/admin/project-updates-moderation/route";

function createFeedbackScopeClient() {
  return {
    from: (table: string) => {
      if (table !== "feedback") throw new Error(`Unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "feedback-1",
                target_type: "aip",
                aip_id: "aip-1",
                project_id: null,
                is_public: true,
              },
              error: null,
            }),
          }),
        }),
      };
    },
  };
}

function createAipScopeClient() {
  return {
    from: (table: string) => {
      if (table !== "aips") throw new Error(`Unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "aip-1", barangay_id: "brgy-1", city_id: "city-1" },
              error: null,
            }),
          }),
        }),
      };
    },
  };
}

function createFeedbackUpdateClient() {
  return {
    from: (table: string) => {
      if (table !== "feedback") throw new Error(`Unexpected table ${table}`);
      return {
        update: () => ({
          eq: async () => ({ error: null }),
        }),
      };
    },
  };
}

function createFeedbackDatasetClient() {
  return {
    from: (table: string) => ({
      select: () => {
        if (table === "activity_log") {
          return {
            order: () => ({ data: [], error: null }),
          };
        }
        return { data: [], error: null };
      },
    }),
  };
}

function createProjectUpdateScopeClient() {
  return {
    from: (table: string) => {
      if (table !== "project_updates") throw new Error(`Unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "update-1",
                project_id: "project-1",
                aip_id: "aip-1",
                status: "active",
              },
              error: null,
            }),
          }),
        }),
      };
    },
  };
}

function createProjectUpdateWriteClient() {
  return {
    from: (table: string) => {
      if (table !== "project_updates") throw new Error(`Unexpected table ${table}`);
      return {
        update: () => ({
          eq: async () => ({ error: null }),
        }),
      };
    },
  };
}

function createProjectDatasetClient() {
  return {
    from: (table: string) => ({
      select: () => {
        if (
          table === "project_updates" ||
          table === "project_update_media" ||
          table === "activity_log"
        ) {
          return {
            order: () => ({ data: [], error: null }),
            in: () => ({
              eq: () => ({
                order: () => ({ data: [], error: null }),
              }),
            }),
          };
        }
        return { data: [], error: null };
      },
    }),
  };
}

describe("admin moderation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceCsrfProtection.mockReturnValue({ ok: true });
    mockWriteActivityLog.mockResolvedValue("activity-log-1");
    mockNotifySafely.mockResolvedValue(undefined);
  });

  it("blocks non-admin access to feedback moderation dataset", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "city-official-1",
      role: "city_official",
      scope: { kind: "city", id: "city-1" },
    });

    const response = await getFeedbackModeration();
    expect(response.status).toBe(401);
  });

  it("processes feedback hide action via admin route and emits moderation notifications", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "admin-1",
      role: "admin",
      scope: { kind: "none" },
    });
    mockSupabaseServer
      .mockResolvedValueOnce(createFeedbackScopeClient())
      .mockResolvedValueOnce(createAipScopeClient())
      .mockResolvedValueOnce(createFeedbackUpdateClient())
      .mockResolvedValueOnce(createFeedbackDatasetClient());

    const response = await postFeedbackModeration(
      new Request("http://localhost/api/admin/feedback-moderation", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "hide",
          input: {
            feedbackId: "feedback-1",
            reason: "Policy violation",
            violationCategory: "Spam",
            actorId: "admin-1",
            actorRole: "admin",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mockWriteActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "feedback_hidden",
        entityTable: "feedback",
        entityId: "feedback-1",
      })
    );
    expect(mockNotifySafely).toHaveBeenCalledTimes(2);
    expect(mockNotifySafely).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: "FEEDBACK_VISIBILITY_CHANGED",
        feedbackId: "feedback-1",
      })
    );
    expect(mockNotifySafely).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: "MODERATION_ACTION_AUDIT",
        entityType: "feedback",
      })
    );
  });

  it("processes project-update hide action via admin route and emits moderation notifications", async () => {
    mockGetActorContext.mockResolvedValue({
      userId: "admin-1",
      role: "admin",
      scope: { kind: "none" },
    });
    mockSupabaseServer
      .mockResolvedValueOnce(createProjectUpdateScopeClient())
      .mockResolvedValueOnce(createAipScopeClient())
      .mockResolvedValueOnce(createProjectUpdateWriteClient())
      .mockResolvedValueOnce(createProjectDatasetClient());

    const response = await postProjectUpdatesModeration(
      new Request("http://localhost/api/admin/project-updates-moderation", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "hide",
          input: {
            updateId: "update-1",
            reason: "Sensitive information",
            violationCategory: "Attendance Sheets",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mockWriteActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project_update_hidden",
        entityTable: "project_updates",
        entityId: "update-1",
      })
    );
    expect(mockNotifySafely).toHaveBeenCalledTimes(2);
    expect(mockNotifySafely).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: "PROJECT_UPDATE_STATUS_CHANGED",
        projectUpdateId: "update-1",
      })
    );
    expect(mockNotifySafely).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: "MODERATION_ACTION_AUDIT",
        entityType: "project_update",
      })
    );
  });
});
