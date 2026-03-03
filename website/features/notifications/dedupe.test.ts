import { describe, expect, it } from "vitest";
import { buildNotificationDedupeKey, toHourBucket } from "@/lib/notifications/dedupe";

describe("notification dedupe keys", () => {
  it("is deterministic for the same transition payload", () => {
    const first = buildNotificationDedupeKey({
      eventType: "PROJECT_UPDATE_STATUS_CHANGED",
      entityType: "project_update",
      entityId: "11111111-1111-1111-1111-111111111111",
      transition: "draft->published",
    });
    const second = buildNotificationDedupeKey({
      eventType: "PROJECT_UPDATE_STATUS_CHANGED",
      entityType: "project_update",
      entityId: "11111111-1111-1111-1111-111111111111",
      transition: "draft->published",
    });

    expect(first).toBe(second);
  });

  it("changes when transition changes", () => {
    const hidden = buildNotificationDedupeKey({
      eventType: "PROJECT_UPDATE_STATUS_CHANGED",
      entityType: "project_update",
      entityId: "11111111-1111-1111-1111-111111111111",
      transition: "published->hidden",
    });
    const unhidden = buildNotificationDedupeKey({
      eventType: "PROJECT_UPDATE_STATUS_CHANGED",
      entityType: "project_update",
      entityId: "11111111-1111-1111-1111-111111111111",
      transition: "hidden->published",
    });

    expect(hidden).not.toBe(unhidden);
  });

  it("uses hourly buckets for periodic system alerts", () => {
    const bucket = toHourBucket(new Date("2026-03-03T05:45:10.000Z"));
    expect(bucket).toBe("2026-03-03T05");

    const key = buildNotificationDedupeKey({
      eventType: "OUTBOX_FAILURE_THRESHOLD_REACHED",
      entityType: "system",
      entityId: "none",
      bucket,
    });
    expect(key).toContain("OUTBOX_FAILURE_THRESHOLD_REACHED:system:none:2026-03-03T05");
  });
});
