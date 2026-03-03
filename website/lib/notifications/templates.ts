import type { NotifyInput } from "./events";

export type NotificationTemplate = {
  title: string;
  message: string;
  emailSubject: string;
  templateKey: string;
};

function withActorPrefix(actorName: string | null | undefined, fallback: string): string {
  const actor = actorName?.trim();
  if (!actor) return fallback;
  return `${actor}: ${fallback}`;
}

export function defaultActionUrl(input: NotifyInput): string | null {
  if (input.actionUrl) return input.actionUrl;

  switch (input.eventType) {
    case "AIP_CLAIMED":
    case "AIP_REVISION_REQUESTED":
    case "AIP_SUBMITTED":
    case "AIP_RESUBMITTED":
      return input.aipId ? `/city/submissions/aip/${input.aipId}` : "/city/submissions";
    case "AIP_PUBLISHED":
      if (input.scopeType === "city") {
        return input.aipId ? `/city/aips/${input.aipId}` : "/city/aips";
      }
      if (input.scopeType === "citizen") {
        return input.aipId ? `/aips/${input.aipId}` : "/aips";
      }
      return input.aipId ? `/barangay/aips/${input.aipId}` : "/barangay/aips";
    case "FEEDBACK_CREATED":
      if (input.scopeType === "city") return "/city/feedback";
      if (input.scopeType === "barangay") return "/barangay/feedback";
      return "/feedback";
    case "FEEDBACK_VISIBILITY_CHANGED":
      return "/admin/feedback-moderation";
    case "PROJECT_UPDATE_STATUS_CHANGED":
      if (input.scopeType === "city") return "/city/projects";
      if (input.scopeType === "citizen") return "/projects";
      if (input.scopeType === "barangay") return "/barangay/projects";
      return "/admin/feedback-moderation";
    case "OUTBOX_FAILURE_THRESHOLD_REACHED":
      return "/admin/usage-controls";
    case "MODERATION_ACTION_AUDIT":
      return "/admin/feedback-moderation";
    case "PIPELINE_JOB_FAILED":
      return "/admin/aip-monitoring";
    default:
      return "/notifications";
  }
}

export function buildNotificationTemplate(input: NotifyInput): NotificationTemplate {
  const transition = input.transition?.trim() || null;
  const note = input.note?.trim() || null;
  const reason = input.reason?.trim() || null;

  switch (input.eventType) {
    case "AIP_CLAIMED":
      return {
        title: "AIP Claimed For Review",
        message: withActorPrefix(input.actorName, "A city official claimed an AIP for review."),
        emailSubject: "OpenAIP: AIP claimed for review",
        templateKey: "AIP_CLAIMED",
      };
    case "AIP_REVISION_REQUESTED":
      return {
        title: "AIP Revision Requested",
        message: note
          ? `Revision requested: ${note}`
          : withActorPrefix(input.actorName, "A city official requested revisions on an AIP."),
        emailSubject: "OpenAIP: AIP revision requested",
        templateKey: "AIP_REVISION_REQUESTED",
      };
    case "AIP_PUBLISHED":
      return {
        title: "AIP Published",
        message: "An AIP was published and is now visible.",
        emailSubject: "OpenAIP: AIP published",
        templateKey: "AIP_PUBLISHED",
      };
    case "AIP_SUBMITTED":
      return {
        title: "AIP Submitted For Review",
        message: "A barangay AIP was submitted for city review.",
        emailSubject: "OpenAIP: AIP submitted for review",
        templateKey: "AIP_SUBMITTED",
      };
    case "AIP_RESUBMITTED":
      return {
        title: "AIP Resubmitted For Review",
        message: "A revised barangay AIP was resubmitted for city review.",
        emailSubject: "OpenAIP: AIP resubmitted",
        templateKey: "AIP_RESUBMITTED",
      };
    case "FEEDBACK_CREATED":
      return {
        title: "New Feedback",
        message: "New feedback was posted.",
        emailSubject: "OpenAIP: new feedback",
        templateKey: "FEEDBACK_CREATED",
      };
    case "FEEDBACK_VISIBILITY_CHANGED":
      return {
        title: "Feedback Visibility Updated",
        message: reason
          ? `Feedback visibility changed. Reason: ${reason}`
          : "Feedback visibility was updated by an administrator.",
        emailSubject: "OpenAIP: feedback visibility updated",
        templateKey: "FEEDBACK_VISIBILITY_CHANGED",
      };
    case "PROJECT_UPDATE_STATUS_CHANGED":
      return {
        title: "Project Update Visibility Changed",
        message: transition
          ? `Project update status changed (${transition}).`
          : "A project update visibility/status changed.",
        emailSubject: "OpenAIP: project update status changed",
        templateKey: "PROJECT_UPDATE_STATUS_CHANGED",
      };
    case "OUTBOX_FAILURE_THRESHOLD_REACHED":
      return {
        title: "Email Outbox Failure Threshold Reached",
        message: "Email delivery failures exceeded the configured threshold in the last hour.",
        emailSubject: "OpenAIP: email outbox failures threshold reached",
        templateKey: "OUTBOX_FAILURE_THRESHOLD_REACHED",
      };
    case "MODERATION_ACTION_AUDIT":
      return {
        title: "Moderation Action Recorded",
        message: reason
          ? `A moderation action was recorded. Reason: ${reason}`
          : "A moderation action was recorded for audit.",
        emailSubject: "OpenAIP: moderation action audit",
        templateKey: "MODERATION_ACTION_AUDIT",
      };
    case "PIPELINE_JOB_FAILED":
      return {
        title: "AIP Pipeline Job Failed",
        message: "A pipeline job failed and requires review.",
        emailSubject: "OpenAIP: pipeline job failed",
        templateKey: "PIPELINE_JOB_FAILED",
      };
    default:
      return {
        title: "New Notification",
        message: "You have a new notification.",
        emailSubject: "OpenAIP: notification",
        templateKey: "GENERIC_NOTIFICATION",
      };
  }
}
