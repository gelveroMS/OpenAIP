import { describe, expect, it } from "vitest";
import { buildNotificationActionUrl } from "@/lib/notifications/action-url";

describe("buildNotificationActionUrl()", () => {
  it("routes aip workflow events to their fixed destinations", () => {
    expect(
      buildNotificationActionUrl({
        eventType: "AIP_CLAIMED",
        recipientScopeType: "barangay",
        entityType: "aip",
        aipId: "aip-1",
      })
    ).toBe("/barangay/aips/aip-1");

    expect(
      buildNotificationActionUrl({
        eventType: "AIP_REVISION_REQUESTED",
        recipientScopeType: "barangay",
        entityType: "aip",
        aipId: "aip-1",
      })
    ).toBe("/barangay/aips/aip-1");

    expect(
      buildNotificationActionUrl({
        eventType: "AIP_SUBMITTED",
        recipientScopeType: "city",
        entityType: "aip",
        aipId: "aip-1",
      })
    ).toBe("/city/submissions/aip/aip-1");

    expect(
      buildNotificationActionUrl({
        eventType: "AIP_RESUBMITTED",
        recipientScopeType: "city",
        entityType: "aip",
        aipId: "aip-1",
      })
    ).toBe("/city/submissions/aip/aip-1");

    expect(
      buildNotificationActionUrl({
        eventType: "AIP_EXTRACTION_SUCCEEDED",
        recipientScopeType: "barangay",
        entityType: "aip",
        aipId: "aip-1",
        runId: "run-1",
      })
    ).toBe("/barangay/aips/aip-1?run=run-1");

    expect(
      buildNotificationActionUrl({
        eventType: "AIP_EXTRACTION_FAILED",
        recipientScopeType: "city",
        entityType: "aip",
        aipId: "aip-1",
        runId: "run-2",
      })
    ).toBe("/city/aips/aip-1?run=run-2");
  });

  it("routes aip published per recipient scope", () => {
    expect(
      buildNotificationActionUrl({
        eventType: "AIP_PUBLISHED",
        recipientScopeType: "barangay",
        entityType: "aip",
        aipId: "aip-1",
      })
    ).toBe("/barangay/aips/aip-1");

    expect(
      buildNotificationActionUrl({
        eventType: "AIP_PUBLISHED",
        recipientScopeType: "city",
        entityType: "aip",
        aipId: "aip-1",
      })
    ).toBe("/city/aips/aip-1");

    expect(
      buildNotificationActionUrl({
        eventType: "AIP_PUBLISHED",
        recipientScopeType: "citizen",
        entityType: "aip",
        aipId: "aip-1",
      })
    ).toBe("/aips/aip-1");
  });

  it("builds deep feedback links for aip and project targets", () => {
    expect(
      buildNotificationActionUrl({
        eventType: "FEEDBACK_CREATED",
        recipientScopeType: "city",
        entityType: "feedback",
        aipId: "aip-1",
        feedbackId: "fb-2",
        rootFeedbackId: "fb-1",
        feedbackTargetType: "aip",
      })
    ).toBe("/city/aips/aip-1?tab=comments&thread=fb-1&comment=fb-2");

    expect(
      buildNotificationActionUrl({
        eventType: "FEEDBACK_VISIBILITY_CHANGED",
        recipientScopeType: "citizen",
        entityType: "feedback",
        aipId: "aip-1",
        feedbackId: "fb-2",
        rootFeedbackId: "fb-1",
        feedbackTargetType: "aip",
      })
    ).toBe("/aips/aip-1?tab=feedback&thread=fb-1&comment=fb-2");

    expect(
      buildNotificationActionUrl({
        eventType: "FEEDBACK_CREATED",
        recipientScopeType: "barangay",
        entityType: "feedback",
        aipId: "aip-1",
        projectId: "proj-1",
        projectCategory: "health",
        feedbackId: "fb-2",
        rootFeedbackId: "fb-1",
        feedbackTargetType: "project",
      })
    ).toBe("/barangay/projects/health/proj-1?tab=feedback&thread=fb-1&comment=fb-2");

    expect(
      buildNotificationActionUrl({
        eventType: "FEEDBACK_CREATED",
        recipientScopeType: "city",
        entityType: "feedback",
        aipId: "aip-1",
        projectId: "proj-1",
        projectCategory: "other",
        feedbackId: "fb-2",
        rootFeedbackId: "fb-1",
        feedbackTargetType: "project",
      })
    ).toBe("/city/aips/aip-1/proj-1?thread=fb-1&comment=fb-2");
  });

  it("builds deep project update links with fallback", () => {
    expect(
      buildNotificationActionUrl({
        eventType: "PROJECT_UPDATE_STATUS_CHANGED",
        recipientScopeType: "citizen",
        entityType: "project_update",
        projectId: "proj-1",
        projectUpdateId: "update-1",
        projectCategory: "infrastructure",
      })
    ).toBe("/projects/infrastructure/proj-1?tab=updates&update=update-1");

    expect(
      buildNotificationActionUrl({
        eventType: "PROJECT_UPDATE_STATUS_CHANGED",
        recipientScopeType: "barangay",
        entityType: "project_update",
        aipId: "aip-1",
        projectId: "proj-1",
        projectUpdateId: "update-1",
        projectCategory: "other",
      })
    ).toBe("/barangay/aips/aip-1/proj-1?update=update-1");
  });

  it("routes admin operational events to admin pages", () => {
    expect(
      buildNotificationActionUrl({
        eventType: "OUTBOX_FAILURE_THRESHOLD_REACHED",
        recipientScopeType: "admin",
        entityType: "system",
      })
    ).toBe("/admin/notifications");

    expect(
      buildNotificationActionUrl({
        eventType: "MODERATION_ACTION_AUDIT",
        recipientScopeType: "admin",
        entityType: "feedback",
        transition: "visible->hidden",
      })
    ).toBe("/admin/audit-logs?event=feedback_hidden");

    expect(
      buildNotificationActionUrl({
        eventType: "MODERATION_ACTION_AUDIT",
        recipientScopeType: "admin",
        entityType: "project_update",
        transition: "hidden->published",
      })
    ).toBe("/admin/audit-logs?event=project_update_unhidden");

    expect(
      buildNotificationActionUrl({
        eventType: "PIPELINE_JOB_FAILED",
        recipientScopeType: "admin",
        entityType: "system",
      })
    ).toBe("/admin/aip-monitoring");

    expect(
      buildNotificationActionUrl({
        eventType: "AIP_EXTRACTION_FAILED",
        recipientScopeType: "admin",
        entityType: "aip",
        runId: "run-3",
      })
    ).toBe("/admin/aip-monitoring?run=run-3");
  });
});
