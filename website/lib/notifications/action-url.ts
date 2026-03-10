import type {
  NotificationEntityType,
  NotificationEventType,
  NotificationScopeType,
} from "./events";

type ProjectCategory = "health" | "infrastructure" | "other" | null;
type FeedbackTargetType = "aip" | "project" | null;

type BuildNotificationActionUrlInput = {
  eventType: NotificationEventType;
  recipientScopeType: NotificationScopeType;
  entityType: NotificationEntityType;
  actionUrlOverride?: string | null;
  transition?: string | null;
  aipId?: string | null;
  runId?: string | null;
  projectId?: string | null;
  feedbackId?: string | null;
  rootFeedbackId?: string | null;
  projectUpdateId?: string | null;
  projectCategory?: ProjectCategory;
  feedbackTargetType?: FeedbackTargetType;
};

function withQuery(path: string, query: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (!value) continue;
    params.set(key, value);
  }
  const queryString = params.toString();
  if (!queryString) return path;
  return `${path}?${queryString}`;
}

function getScopePrefix(scopeType: NotificationScopeType): string {
  if (scopeType === "citizen") return "";
  return `/${scopeType}`;
}

function getScopedProjectPath(input: {
  scopeType: NotificationScopeType;
  projectId: string | null | undefined;
  projectCategory: ProjectCategory;
}): string | null {
  if (!input.projectId) return null;
  if (input.projectCategory !== "health" && input.projectCategory !== "infrastructure") {
    return null;
  }

  if (input.scopeType === "admin") return null;
  const prefix = getScopePrefix(input.scopeType);
  return `${prefix}/projects/${input.projectCategory}/${input.projectId}`;
}

function getScopedAipProjectPath(input: {
  scopeType: NotificationScopeType;
  aipId: string | null | undefined;
  projectId: string | null | undefined;
}): string | null {
  if (!input.aipId || !input.projectId) return null;
  if (input.scopeType === "admin") return null;
  const prefix = getScopePrefix(input.scopeType);
  return `${prefix}/aips/${input.aipId}/${input.projectId}`;
}

function resolveModerationAuditEvent(input: {
  entityType: NotificationEntityType;
  transition: string | null | undefined;
}): string | null {
  const transition = input.transition?.trim().toLowerCase() ?? null;

  if (input.entityType === "feedback") {
    if (transition?.endsWith("->hidden")) return "feedback_hidden";
    if (transition?.endsWith("->visible")) return "feedback_unhidden";
    return null;
  }

  if (input.entityType === "project_update") {
    if (transition?.endsWith("->hidden")) return "project_update_hidden";
    if (transition?.endsWith("->published")) return "project_update_unhidden";
    return null;
  }

  return null;
}

function buildFeedbackActionUrl(input: {
  recipientScopeType: NotificationScopeType;
  feedbackTargetType: FeedbackTargetType;
  aipId: string | null | undefined;
  projectId: string | null | undefined;
  projectCategory: ProjectCategory;
  rootFeedbackId: string | null | undefined;
  feedbackId: string | null | undefined;
}): string {
  if (input.feedbackTargetType === "aip" && input.aipId) {
    if (input.recipientScopeType === "citizen") {
      return withQuery(`/aips/${input.aipId}`, {
        tab: "feedback",
        thread: input.rootFeedbackId,
        comment: input.feedbackId,
      });
    }

    if (input.recipientScopeType === "barangay" || input.recipientScopeType === "city") {
      return withQuery(`/${input.recipientScopeType}/aips/${input.aipId}`, {
        tab: "comments",
        thread: input.rootFeedbackId,
        comment: input.feedbackId,
      });
    }
  }

  if (input.feedbackTargetType === "project" && input.projectId) {
    const scopedProjectPath = getScopedProjectPath({
      scopeType: input.recipientScopeType,
      projectId: input.projectId,
      projectCategory: input.projectCategory,
    });
    if (scopedProjectPath) {
      return withQuery(scopedProjectPath, {
        tab: "feedback",
        thread: input.rootFeedbackId,
        comment: input.feedbackId,
      });
    }

    const aipProjectPath = getScopedAipProjectPath({
      scopeType: input.recipientScopeType,
      aipId: input.aipId,
      projectId: input.projectId,
    });
    if (aipProjectPath) {
      return withQuery(aipProjectPath, {
        thread: input.rootFeedbackId,
        comment: input.feedbackId,
      });
    }
  }

  if (input.recipientScopeType === "city") return "/city/feedback";
  if (input.recipientScopeType === "barangay") return "/barangay/feedback";
  if (input.recipientScopeType === "admin") return "/admin/feedback-moderation";
  return "/feedback";
}

function buildProjectUpdateActionUrl(input: {
  recipientScopeType: NotificationScopeType;
  aipId: string | null | undefined;
  projectId: string | null | undefined;
  projectUpdateId: string | null | undefined;
  projectCategory: ProjectCategory;
}): string {
  const updateId = input.projectUpdateId;
  const scopedProjectPath = getScopedProjectPath({
    scopeType: input.recipientScopeType,
    projectId: input.projectId,
    projectCategory: input.projectCategory,
  });
  if (scopedProjectPath) {
    return withQuery(scopedProjectPath, {
      tab: "updates",
      update: updateId,
    });
  }

  const aipProjectPath = getScopedAipProjectPath({
    scopeType: input.recipientScopeType,
    aipId: input.aipId,
    projectId: input.projectId,
  });
  if (aipProjectPath) {
    return withQuery(aipProjectPath, {
      update: updateId,
    });
  }

  if (input.recipientScopeType === "city") return "/city/projects";
  if (input.recipientScopeType === "barangay") return "/barangay/projects";
  if (input.recipientScopeType === "admin") return "/admin/feedback-moderation";
  return "/projects";
}

export function buildNotificationActionUrl(input: BuildNotificationActionUrlInput): string {
  if (input.actionUrlOverride?.trim()) {
    return input.actionUrlOverride.trim();
  }

  switch (input.eventType) {
    case "AIP_CLAIMED":
    case "AIP_REVISION_REQUESTED":
      return input.aipId ? `/barangay/aips/${input.aipId}` : "/barangay/aips";
    case "AIP_SUBMITTED":
    case "AIP_RESUBMITTED":
      return input.aipId ? `/city/submissions/aip/${input.aipId}` : "/city/submissions";
    case "AIP_EXTRACTION_SUCCEEDED":
    case "AIP_EXTRACTION_FAILED":
      if (input.recipientScopeType === "barangay") {
        if (input.aipId) {
          return withQuery(`/barangay/aips/${input.aipId}`, { run: input.runId });
        }
        return "/barangay/aips";
      }
      if (input.recipientScopeType === "city") {
        if (input.aipId) {
          return withQuery(`/city/aips/${input.aipId}`, { run: input.runId });
        }
        return "/city/aips";
      }
      if (input.recipientScopeType === "admin") {
        return withQuery("/admin/aip-monitoring", { run: input.runId });
      }
      return "/notifications";
    case "AIP_EMBED_SUCCEEDED":
    case "AIP_EMBED_FAILED":
      if (input.recipientScopeType === "barangay") {
        return input.aipId ? `/barangay/aips/${input.aipId}` : "/barangay/aips";
      }
      if (input.recipientScopeType === "city") {
        return input.aipId ? `/city/aips/${input.aipId}` : "/city/aips";
      }
      if (input.recipientScopeType === "admin") {
        return "/admin/aip-monitoring";
      }
      return "/notifications";
    case "AIP_PUBLISHED":
      if (input.recipientScopeType === "city") {
        return input.aipId ? `/city/aips/${input.aipId}` : "/city/aips";
      }
      if (input.recipientScopeType === "barangay") {
        return input.aipId ? `/barangay/aips/${input.aipId}` : "/barangay/aips";
      }
      return input.aipId ? `/aips/${input.aipId}` : "/aips";
    case "FEEDBACK_CREATED":
    case "FEEDBACK_VISIBILITY_CHANGED":
      return buildFeedbackActionUrl({
        recipientScopeType: input.recipientScopeType,
        feedbackTargetType: input.feedbackTargetType ?? null,
        aipId: input.aipId,
        projectId: input.projectId,
        projectCategory: input.projectCategory ?? null,
        rootFeedbackId: input.rootFeedbackId,
        feedbackId: input.feedbackId,
      });
    case "PROJECT_UPDATE_STATUS_CHANGED":
      return buildProjectUpdateActionUrl({
        recipientScopeType: input.recipientScopeType,
        aipId: input.aipId,
        projectId: input.projectId,
        projectUpdateId: input.projectUpdateId,
        projectCategory: input.projectCategory ?? null,
      });
    case "OUTBOX_FAILURE_THRESHOLD_REACHED":
      return "/admin/notifications";
    case "MODERATION_ACTION_AUDIT": {
      const event = resolveModerationAuditEvent({
        entityType: input.entityType,
        transition: input.transition,
      });
      return event ? `/admin/audit-logs?event=${encodeURIComponent(event)}` : "/admin/audit-logs";
    }
    case "PIPELINE_JOB_FAILED":
      return "/admin/aip-monitoring";
    default:
      return "/notifications";
  }
}
