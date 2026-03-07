import { beforeEach, describe, expect, it, vi } from "vitest";

type MockRecipient = {
  userId: string;
  role: "admin" | "city_official" | "barangay_official" | "citizen";
  email: string | null;
  scopeType: "admin" | "city" | "barangay" | "citizen";
};

const mockGetAdminRecipients = vi.fn<() => Promise<MockRecipient[]>>();
const mockGetBarangayOfficialRecipients = vi.fn<() => Promise<MockRecipient[]>>();
const mockGetCityOfficialRecipients = vi.fn<() => Promise<MockRecipient[]>>();
const mockGetCitizenRecipientsForBarangay = vi.fn<() => Promise<MockRecipient[]>>();
const mockGetRecipientByUserId = vi.fn();
const mockResolveFeedbackContext = vi.fn();
const mockResolveAipTemplateContext = vi.fn();
const mockResolveProjectTemplateContext = vi.fn();
const mockResolveProjectUpdateTemplateContext = vi.fn();
const mockResolveFeedbackTemplateContext = vi.fn();
const mockResolveActorDisplayName = vi.fn();
const mockGetUserById = vi.fn();
const notificationUpserts: Array<{ rows: Array<Record<string, unknown>>; options: unknown }> = [];
const emailUpserts: Array<{ rows: Array<Record<string, unknown>>; options: unknown }> = [];
let preferenceRows: Array<{
  user_id: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
}> = [];

vi.mock("@/lib/notifications/recipients", () => ({
  getAdminRecipients: () => mockGetAdminRecipients(),
  getBarangayOfficialRecipients: () => mockGetBarangayOfficialRecipients(),
  getCityOfficialRecipients: () => mockGetCityOfficialRecipients(),
  getCitizenRecipientsForBarangay: () => mockGetCitizenRecipientsForBarangay(),
  getCitizenRecipientsForCity: vi.fn(async () => []),
  getRecipientByUserId: (...args: unknown[]) => mockGetRecipientByUserId(...args),
  resolveAipScope: vi.fn(async () => null),
  resolveAipTemplateContext: (...args: unknown[]) => mockResolveAipTemplateContext(...args),
  resolveProjectTemplateContext: (...args: unknown[]) => mockResolveProjectTemplateContext(...args),
  resolveProjectUpdateTemplateContext: (...args: unknown[]) =>
    mockResolveProjectUpdateTemplateContext(...args),
  resolveFeedbackContext: (...args: unknown[]) => mockResolveFeedbackContext(...args),
  resolveFeedbackTemplateContext: (...args: unknown[]) => mockResolveFeedbackTemplateContext(...args),
  resolveProjectScope: vi.fn(async () => null),
  resolveProjectUpdateContext: vi.fn(async () => null),
  resolveActorDisplayName: (...args: unknown[]) => mockResolveActorDisplayName(...args),
  mergeRecipients: (...groups: Array<MockRecipient[]>) => {
    const merged = groups.flat();
    const seen = new Set<string>();
    return merged.filter((recipient) => {
      if (seen.has(recipient.userId)) return false;
      seen.add(recipient.userId);
      return true;
    });
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "notification_preferences") {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: preferenceRows, error: null }),
            }),
          }),
        };
      }

      if (table === "notifications") {
        return {
          upsert: async (rows: Array<Record<string, unknown>>, options: unknown) => {
            notificationUpserts.push({ rows, options });
            return { error: null };
          },
        };
      }

      if (table === "email_outbox") {
        return {
          upsert: async (rows: Array<Record<string, unknown>>, options: unknown) => {
            emailUpserts.push({ rows, options });
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table in notification test mock: ${table}`);
    },
    auth: {
      admin: {
        getUserById: (...args: unknown[]) => mockGetUserById(...args),
      },
    },
  }),
}));

import { notify } from "@/lib/notifications/notify";

describe("notify()", () => {
  beforeEach(() => {
    preferenceRows = [];
    notificationUpserts.length = 0;
    emailUpserts.length = 0;
    mockGetUserById.mockReset();
    mockGetUserById.mockResolvedValue({
      data: { user: { email: "fallback@example.com" } },
      error: null,
    });
    mockResolveAipTemplateContext.mockReset();
    mockResolveAipTemplateContext.mockResolvedValue({
      fiscalYear: 2026,
      lguName: "Barangay Uno",
      scopeLabel: "barangay",
    });
    mockResolveProjectTemplateContext.mockReset();
    mockResolveProjectTemplateContext.mockResolvedValue({
      projectName: "Rural Health Program",
    });
    mockResolveProjectUpdateTemplateContext.mockReset();
    mockResolveProjectUpdateTemplateContext.mockResolvedValue({
      updateTitle: null,
      updateBody: null,
      status: null,
    });
    mockResolveFeedbackTemplateContext.mockReset();
    mockResolveFeedbackTemplateContext.mockResolvedValue({
      feedbackKind: "question",
      feedbackBody: "Can you share update details for this project?",
      entityLabel: "Rural Health Program",
      targetLabel: "Rural Health Program",
      targetType: "project",
    });
    mockResolveActorDisplayName.mockReset();
    mockResolveActorDisplayName.mockResolvedValue("Default Actor");

    mockGetAdminRecipients.mockReset();
    mockGetAdminRecipients.mockResolvedValue([
      {
        userId: "admin-1",
        role: "admin",
        email: "admin1@example.com",
        scopeType: "admin",
      },
      {
        userId: "admin-2",
        role: "admin",
        email: "admin2@example.com",
        scopeType: "admin",
      },
    ]);
    mockGetBarangayOfficialRecipients.mockReset();
    mockGetBarangayOfficialRecipients.mockResolvedValue([]);
    mockGetCityOfficialRecipients.mockReset();
    mockGetCityOfficialRecipients.mockResolvedValue([]);
    mockGetCitizenRecipientsForBarangay.mockReset();
    mockGetCitizenRecipientsForBarangay.mockResolvedValue([]);
    mockGetRecipientByUserId.mockReset();
    mockGetRecipientByUserId.mockResolvedValue(null);
    mockResolveFeedbackContext.mockReset();
    mockResolveFeedbackContext.mockResolvedValue(null);
  });

  it("inserts notifications and outbox rows for multiple recipients", async () => {
    const result = await notify({
      eventType: "OUTBOX_FAILURE_THRESHOLD_REACHED",
      scopeType: "admin",
      entityType: "system",
      entityId: null,
      dedupeBucket: "2026-03-03T05",
    });

    expect(result.recipientCount).toBe(2);
    expect(notificationUpserts).toHaveLength(1);
    expect(notificationUpserts[0].rows).toHaveLength(2);
    expect(emailUpserts).toHaveLength(1);
    expect(emailUpserts[0].rows).toHaveLength(2);
    expect(notificationUpserts[0].rows[0].dedupe_key).toBe(
      "OUTBOX_FAILURE_THRESHOLD_REACHED:system:none:2026-03-03T05"
    );
    expect(emailUpserts[0].rows[0].payload).toMatchObject({
      notification_ref: "OUTBOX_FAILURE_THRESHOLD_REACHED:system:none:2026-03-03T05",
      template_data: expect.objectContaining({
        event_type: "OUTBOX_FAILURE_THRESHOLD_REACHED",
      }),
    });
  });

  it("respects preference rows and keeps missing rows enabled by default", async () => {
    preferenceRows = [
      { user_id: "admin-1", in_app_enabled: false, email_enabled: true },
      { user_id: "admin-2", in_app_enabled: true, email_enabled: false },
    ];

    const result = await notify({
      eventType: "OUTBOX_FAILURE_THRESHOLD_REACHED",
      scopeType: "admin",
      entityType: "system",
      entityId: null,
      dedupeBucket: "2026-03-03T06",
    });

    expect(result.recipientCount).toBe(2);
    expect(notificationUpserts).toHaveLength(1);
    expect(notificationUpserts[0].rows).toHaveLength(1);
    expect(notificationUpserts[0].rows[0].recipient_user_id).toBe("admin-2");
    expect(emailUpserts).toHaveLength(1);
    expect(emailUpserts[0].rows).toHaveLength(1);
    expect(emailUpserts[0].rows[0].recipient_user_id).toBe("admin-1");
  });

  it("uses idempotent conflict targets for repeat emissions", async () => {
    await notify({
      eventType: "OUTBOX_FAILURE_THRESHOLD_REACHED",
      scopeType: "admin",
      entityType: "system",
      entityId: null,
      dedupeBucket: "2026-03-03T07",
    });
    await notify({
      eventType: "OUTBOX_FAILURE_THRESHOLD_REACHED",
      scopeType: "admin",
      entityType: "system",
      entityId: null,
      dedupeBucket: "2026-03-03T07",
    });

    expect(notificationUpserts).toHaveLength(2);
    expect(notificationUpserts[0].options).toEqual({
      onConflict: "recipient_user_id,dedupe_key",
      ignoreDuplicates: true,
    });
    expect(emailUpserts).toHaveLength(2);
    expect(emailUpserts[0].options).toEqual({
      onConflict: "to_email,dedupe_key",
      ignoreDuplicates: true,
    });
    expect(notificationUpserts[0].rows[0].dedupe_key).toBe(
      notificationUpserts[1].rows[0].dedupe_key
    );
  });

  it("builds recipient-aware action URLs for mixed recipient events", async () => {
    mockGetBarangayOfficialRecipients.mockResolvedValueOnce([
      {
        userId: "bo-1",
        role: "barangay_official",
        email: "bo1@example.com",
        scopeType: "barangay",
      },
    ]);
    mockGetCitizenRecipientsForBarangay.mockResolvedValueOnce([
      {
        userId: "citizen-1",
        role: "citizen",
        email: "citizen1@example.com",
        scopeType: "citizen",
      },
    ]);

    await notify({
      eventType: "AIP_PUBLISHED",
      scopeType: "barangay",
      entityType: "aip",
      aipId: "aip-1",
      barangayId: "brgy-1",
      cityId: "city-1",
      entityId: "aip-1",
    });

    expect(notificationUpserts).toHaveLength(1);
    const rows = notificationUpserts[0].rows;
    const byUserId = new Map(rows.map((row) => [String(row.recipient_user_id), row]));
    expect(byUserId.get("bo-1")?.action_url).toBe("/barangay/aips/aip-1");
    expect(byUserId.get("citizen-1")?.action_url).toBe("/aips/aip-1");

    expect(emailUpserts).toHaveLength(1);
    const emailRows = emailUpserts[0].rows;
    const emailByUserId = new Map(emailRows.map((row) => [String(row.recipient_user_id), row]));
    expect(emailByUserId.get("bo-1")?.payload).toMatchObject({
      action_url: "/barangay/aips/aip-1",
    });
    expect(emailByUserId.get("citizen-1")?.payload).toMatchObject({
      action_url: "/aips/aip-1",
      template_data: expect.objectContaining({
        fiscal_year: 2026,
        lgu_name: "Barangay Uno",
      }),
    });
  });

  it("notifies root citizen on reply while excluding official replier", async () => {
    mockResolveFeedbackContext.mockResolvedValueOnce({
      feedbackId: "fb-reply-1",
      authorUserId: "bo-actor",
      rootAuthorUserId: "citizen-root",
      targetType: "project",
      aipId: "aip-1",
      projectId: "proj-1",
      parentFeedbackId: "fb-root",
      rootFeedbackId: "fb-root",
      projectCategory: "health",
      scope: {
        aipId: "aip-1",
        barangayId: "brgy-1",
        cityId: "city-1",
        municipalityId: null,
      },
    });
    mockGetRecipientByUserId.mockResolvedValueOnce({
      userId: "citizen-root",
      role: "citizen",
      email: "citizen.root@example.com",
      scopeType: "citizen",
    });
    mockGetBarangayOfficialRecipients.mockResolvedValueOnce([
      {
        userId: "bo-actor",
        role: "barangay_official",
        email: "actor@example.com",
        scopeType: "barangay",
      },
      {
        userId: "bo-2",
        role: "barangay_official",
        email: "bo2@example.com",
        scopeType: "barangay",
      },
    ]);

    const result = await notify({
      eventType: "FEEDBACK_CREATED",
      scopeType: "barangay",
      entityType: "feedback",
      entityId: "fb-reply-1",
      feedbackId: "fb-reply-1",
      actorUserId: "bo-actor",
      actorRole: "barangay_official",
    });

    expect(result.recipientCount).toBe(2);
    expect(notificationUpserts).toHaveLength(1);
    const byUserId = new Map(
      notificationUpserts[0].rows.map((row) => [String(row.recipient_user_id), row])
    );
    expect(byUserId.has("bo-actor")).toBe(false);
    expect(byUserId.get("bo-2")?.action_url).toBe(
      "/barangay/projects/health/proj-1?tab=feedback&thread=fb-root&comment=fb-reply-1"
    );
    expect(byUserId.get("citizen-root")?.action_url).toBe(
      "/projects/health/proj-1?tab=feedback&thread=fb-root&comment=fb-reply-1"
    );
    expect(byUserId.get("bo-2")?.metadata).toMatchObject({
      is_reply: true,
      reply_context: {
        root_feedback_id: "fb-root",
        parent_feedback_id: "fb-root",
        target_type: "project",
      },
    });

    expect(emailUpserts).toHaveLength(1);
    const emailRecipients = new Set(
      emailUpserts[0].rows.map((row) => String(row.recipient_user_id))
    );
    expect(emailRecipients.has("bo-actor")).toBe(false);
    expect(emailRecipients.has("bo-2")).toBe(true);
    expect(emailRecipients.has("citizen-root")).toBe(true);
    const firstReplyEmail = emailUpserts[0].rows[0];
    expect(firstReplyEmail.template_key).toBe("feedback_reply");
    expect(firstReplyEmail.subject).toBe("OpenAIP — New reply in a feedback thread");
  });

  it("suppresses self-notification when citizen replies to own feedback thread", async () => {
    mockResolveFeedbackContext.mockResolvedValueOnce({
      feedbackId: "fb-reply-2",
      authorUserId: "citizen-1",
      rootAuthorUserId: "citizen-1",
      targetType: "project",
      aipId: "aip-1",
      projectId: "proj-1",
      parentFeedbackId: "fb-root",
      rootFeedbackId: "fb-root",
      projectCategory: "health",
      scope: {
        aipId: "aip-1",
        barangayId: "brgy-1",
        cityId: "city-1",
        municipalityId: null,
      },
    });
    mockGetRecipientByUserId.mockResolvedValueOnce({
      userId: "citizen-1",
      role: "citizen",
      email: "citizen1@example.com",
      scopeType: "citizen",
    });
    mockGetBarangayOfficialRecipients.mockResolvedValueOnce([
      {
        userId: "bo-1",
        role: "barangay_official",
        email: "bo1@example.com",
        scopeType: "barangay",
      },
    ]);

    const result = await notify({
      eventType: "FEEDBACK_CREATED",
      scopeType: "citizen",
      entityType: "feedback",
      entityId: "fb-reply-2",
      feedbackId: "fb-reply-2",
      actorUserId: "citizen-1",
      actorRole: "citizen",
    });

    expect(result.recipientCount).toBe(1);
    expect(notificationUpserts).toHaveLength(1);
    expect(notificationUpserts[0].rows).toHaveLength(1);
    expect(notificationUpserts[0].rows[0].recipient_user_id).toBe("bo-1");
  });

  it("does not add root author recipient for root feedback creation", async () => {
    mockResolveFeedbackContext.mockResolvedValueOnce({
      feedbackId: "fb-root",
      authorUserId: "citizen-1",
      rootAuthorUserId: "citizen-1",
      targetType: "project",
      aipId: "aip-1",
      projectId: "proj-1",
      parentFeedbackId: null,
      rootFeedbackId: "fb-root",
      projectCategory: "health",
      scope: {
        aipId: "aip-1",
        barangayId: "brgy-1",
        cityId: "city-1",
        municipalityId: null,
      },
    });
    mockGetBarangayOfficialRecipients.mockResolvedValueOnce([
      {
        userId: "bo-1",
        role: "barangay_official",
        email: "bo1@example.com",
        scopeType: "barangay",
      },
    ]);

    const result = await notify({
      eventType: "FEEDBACK_CREATED",
      scopeType: "citizen",
      entityType: "feedback",
      entityId: "fb-root",
      feedbackId: "fb-root",
      actorUserId: "citizen-1",
      actorRole: "citizen",
    });

    expect(result.recipientCount).toBe(1);
    expect(mockGetRecipientByUserId).not.toHaveBeenCalled();
    expect(notificationUpserts).toHaveLength(1);
    expect(notificationUpserts[0].rows).toHaveLength(1);
    expect(notificationUpserts[0].rows[0].recipient_user_id).toBe("bo-1");
    expect(emailUpserts).toHaveLength(1);
    expect(emailUpserts[0].rows[0].template_key).toBe("feedback_posted");
    expect(emailUpserts[0].rows[0].subject).toBe("OpenAIP — New feedback posted");
  });

  it("enriches feedback payload template_data with sanitized excerpt and labels", async () => {
    mockGetBarangayOfficialRecipients.mockResolvedValueOnce([
      {
        userId: "bo-1",
        role: "barangay_official",
        email: "bo1@example.com",
        scopeType: "barangay",
      },
    ]);
    mockResolveFeedbackTemplateContext.mockResolvedValueOnce({
      feedbackKind: "concern",
      feedbackBody: "x".repeat(260),
      entityLabel: "Road Improvement Project",
      targetLabel: "Road Improvement Project",
      targetType: "project",
    });
    mockResolveProjectTemplateContext.mockResolvedValueOnce({
      projectName: "Road Improvement Project",
    });
    mockResolveActorDisplayName.mockResolvedValueOnce("Admin Reviewer");

    await notify({
      eventType: "FEEDBACK_VISIBILITY_CHANGED",
      scopeType: "barangay",
      entityType: "feedback",
      entityId: "fb-1",
      feedbackId: "fb-1",
      projectId: "proj-1",
      aipId: "aip-1",
      barangayId: "brgy-1",
      actorUserId: "admin-1",
      actorRole: "admin",
      transition: "visible->hidden",
      reason: "Contains personal information",
    });

    expect(emailUpserts).toHaveLength(1);
    const payload = emailUpserts[0].rows[0].payload as Record<string, unknown>;
    const templateData = payload.template_data as Record<string, unknown>;
    expect(templateData.entity_label).toBe("Feedback on Road Improvement Project");
    expect(templateData.feedback_kind).toBe("Concern");
    expect(String(templateData.feedback_excerpt)).toContain("...");
    expect(String(templateData.feedback_excerpt).length).toBeLessThanOrEqual(200);
    expect(templateData.visibility_action).toBe("hidden");
    expect(templateData.new_visibility).toBe("Hidden");
    expect(templateData.actor_role_label).toBe("Administrator");
    expect(templateData.target_label).toBe("Road Improvement Project");
    expect(templateData.reply_excerpt).toBeNull();
    expect(emailUpserts[0].rows[0].template_key).toBe("feedback_visibility_changed");
    expect(emailUpserts[0].rows[0].subject).toBe("OpenAIP — Feedback moderation update");
  });

  it("emits project update emails with canonical key and transition-specific subjects", async () => {
    mockGetBarangayOfficialRecipients.mockResolvedValue([
      {
        userId: "bo-1",
        role: "barangay_official",
        email: "bo1@example.com",
        scopeType: "barangay",
      },
    ]);
    mockResolveProjectUpdateTemplateContext.mockResolvedValue({
      updateTitle: "Drainage completed",
      updateBody: "Drainage work for phase 1 has been completed.",
      status: "active",
    });
    mockResolveActorDisplayName.mockResolvedValue("City Reviewer");

    await notify({
      eventType: "PROJECT_UPDATE_STATUS_CHANGED",
      scopeType: "barangay",
      entityType: "project_update",
      entityId: "upd-1",
      projectUpdateId: "upd-1",
      projectId: "proj-1",
      aipId: "aip-1",
      barangayId: "brgy-1",
      actorRole: "city_official",
      actorUserId: "co-1",
      transition: "draft->active",
    });

    await notify({
      eventType: "PROJECT_UPDATE_STATUS_CHANGED",
      scopeType: "barangay",
      entityType: "project_update",
      entityId: "upd-2",
      projectUpdateId: "upd-2",
      projectId: "proj-1",
      aipId: "aip-1",
      barangayId: "brgy-1",
      actorRole: "city_official",
      actorUserId: "co-1",
      transition: "active->hidden",
    });

    await notify({
      eventType: "PROJECT_UPDATE_STATUS_CHANGED",
      scopeType: "barangay",
      entityType: "project_update",
      entityId: "upd-3",
      projectUpdateId: "upd-3",
      projectId: "proj-1",
      aipId: "aip-1",
      barangayId: "brgy-1",
      actorRole: "city_official",
      actorUserId: "co-1",
      transition: "hidden->active",
    });

    expect(emailUpserts).toHaveLength(3);
    const [postedEmail, removedEmail, restoredEmail] = emailUpserts.map((entry) => entry.rows[0]);
    expect(postedEmail.template_key).toBe("project_update_posted");
    expect(postedEmail.subject).toBe("OpenAIP — A project update has been posted");
    expect(removedEmail.template_key).toBe("project_update_posted");
    expect(removedEmail.subject).toBe("OpenAIP — Project update removed from public view");
    expect(restoredEmail.template_key).toBe("project_update_posted");
    expect(restoredEmail.subject).toBe("OpenAIP — Project update is visible again");
    const postedPayload = postedEmail.payload as Record<string, unknown>;
    const postedTemplateData = postedPayload.template_data as Record<string, unknown>;
    expect(postedTemplateData.update_title).toBe("Drainage completed");
    expect(postedTemplateData.update_excerpt).toContain("Drainage work");
  });
});
