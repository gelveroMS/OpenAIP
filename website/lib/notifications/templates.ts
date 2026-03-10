import type { NotifyInput } from "./events";
import { buildNotificationActionUrl } from "./action-url";

export type NotificationTemplate = {
  title: string;
  message: string;
  emailSubject: string;
  templateKey: string;
};

type DisplaySurface = "dropdown" | "page";

type NotificationMetadata = Record<string, unknown>;

export type NotificationDisplayRow = {
  id?: string;
  event_type?: string | null;
  scope_type?: string | null;
  recipient_role?: string | null;
  title?: string | null;
  message?: string | null;
  action_url?: string | null;
  metadata?: unknown;
  created_at?: string;
  read_at?: string | null;
};

export type NotificationIconKey =
  | "clipboard-check"
  | "pencil-alert"
  | "globe"
  | "inbox"
  | "refresh-cw"
  | "message-square"
  | "corner-down-right"
  | "shield"
  | "megaphone"
  | "alert-triangle"
  | "clipboard-list"
  | "x-circle"
  | "bell";

export type NotificationDisplay = {
  title: string;
  context: string;
  excerpt?: string;
  iconKey: NotificationIconKey;
  pill?: string;
  actionUrl: string | null;
};

const DROPDOWN_TITLE_MAX = 60;
const FEEDBACK_EXCERPT_MAX = 120;
const REVISION_EXCERPT_MAX = 120;
const PIPELINE_EXCERPT_MAX = 180;
const AIP_EXTRACTION_EXCERPT_MAX = 120;
const AIP_EMBED_EXCERPT_MAX = 120;

function withActorPrefix(actorName: string | null | undefined, fallback: string): string {
  const actor = actorName?.trim();
  if (!actor) return fallback;
  return `${actor}: ${fallback}`;
}

function asRecord(value: unknown): NotificationMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as NotificationMetadata;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toTitleCaseToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .trim()
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ");
  if (!cleaned) return null;
  return cleaned
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function toActorRoleLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (normalized === "city_official" || normalized === "municipal_official") {
    return "City Official";
  }
  if (normalized === "barangay_official") return "Barangay Official";
  if (normalized === "citizen") return "Citizen";
  if (normalized === "admin") return "Admin";
  if (normalized === "system") return "System";
  return toTitleCaseToken(normalized);
}

function removeControlChars(value: string): string {
  return value
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll(/[\u0000-\u001f\u007f]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function firstLine(value: string): string {
  const [line = ""] = value.split(/\r?\n/, 1);
  return line.trim();
}

function isVisibleStatus(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === "active" || normalized === "published" || normalized === "visible";
}

function isHiddenStatus(value: string | null): boolean {
  return value?.toLowerCase() === "hidden";
}

function getAipIdShort(metadata: NotificationMetadata): string | null {
  const aipId = asString(metadata.aip_id);
  if (!aipId) return null;
  return aipId.length <= 8 ? aipId : aipId.slice(0, 8);
}

function withDropdownTitleLimit(value: string): string {
  return safeTruncate(value, DROPDOWN_TITLE_MAX);
}

function quoteExcerpt(value: string | null): string | undefined {
  if (!value) return undefined;
  return `"${value}"`;
}

function pickLguName(metadata: NotificationMetadata): string | null {
  return (
    asString(metadata.lgu_name) ??
    asString(metadata.barangay_name) ??
    asString(metadata.city_name) ??
    null
  );
}

function pickScopeLabel(metadata: NotificationMetadata): string {
  const scope = toTitleCaseToken(asString(metadata.scope_type));
  return scope ?? "System";
}

function normalizeAipScopeToken(
  value: string | null | undefined
): "city" | "municipality" | "barangay" | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (normalized === "city" || normalized === "municipality" || normalized === "barangay") {
    return normalized;
  }
  return null;
}

function resolveCitizenAipPublishedScope(metadata: NotificationMetadata): "city" | "barangay" | "unknown" {
  const scopeLabel = normalizeAipScopeToken(asString(metadata.scope_label));
  if (scopeLabel === "city" || scopeLabel === "municipality") return "city";
  if (scopeLabel === "barangay") return "barangay";

  const scopeType = normalizeAipScopeToken(asString(metadata.scope_type));
  if (scopeType === "city" || scopeType === "municipality") return "city";
  if (scopeType === "barangay") return "barangay";

  if (asString(metadata.city_name)) return "city";
  if (asString(metadata.barangay_name)) return "barangay";

  return "unknown";
}

function getCitizenAipPublishedDropdownTitle(metadata: NotificationMetadata): string {
  const scope = resolveCitizenAipPublishedScope(metadata);
  if (scope === "city") return "New city AIP published.";
  if (scope === "barangay") return "New barangay AIP published.";
  return "New AIP published.";
}

function pickFeedbackKindLabel(metadata: NotificationMetadata): string | null {
  return toTitleCaseToken(asString(metadata.feedback_kind));
}

function pickVisibilityAction(metadata: NotificationMetadata): string | null {
  return asString(metadata.visibility_action)?.toLowerCase() ?? null;
}

function pickUpdateVisibilityState(metadata: NotificationMetadata): {
  oldStatus: string | null;
  newStatus: string | null;
} {
  const oldStatus = asString(metadata.old_status_label) ?? null;
  const newStatus = asString(metadata.new_status_label) ?? null;
  return { oldStatus, newStatus };
}

function isReplyEvent(metadata: NotificationMetadata): boolean {
  return asBoolean(metadata.is_reply) || Object.keys(asRecord(metadata.reply_context)).length > 0;
}

function getFeedbackReplyDropdownTitle(metadata: NotificationMetadata): string {
  const actorRole = asString(metadata.actor_role)?.toLowerCase() ?? "";
  if (actorRole === "citizen") {
    return "A citizen replied to your comment.";
  }
  if (actorRole === "barangay_official" || actorRole === "city_official" || actorRole === "municipal_official") {
    return "An LGU replied to your feedback.";
  }
  return "New reply in feedback thread.";
}

function getFeedbackReplyDetail(metadata: NotificationMetadata): string | undefined {
  const actorName = asString(metadata.actor_name) ?? "A user";
  const roleLabel = toActorRoleLabel(asString(metadata.actor_role));
  if (!roleLabel) return `Reply from ${actorName}.`;
  return `Reply from ${actorName} (${roleLabel}).`;
}

function getFeedbackTopLevelDetail(metadata: NotificationMetadata): string | undefined {
  const roleLabel = toActorRoleLabel(asString(metadata.actor_role));
  const feedbackKind = pickFeedbackKindLabel(metadata);
  if (!roleLabel && !feedbackKind) return undefined;
  if (roleLabel && feedbackKind) return `From ${roleLabel} • ${feedbackKind}`;
  if (roleLabel) return `From ${roleLabel}`;
  return feedbackKind ?? undefined;
}

export function defaultActionUrl(input: NotifyInput): string | null {
  return buildNotificationActionUrl({
    eventType: input.eventType,
    recipientScopeType: input.scopeType,
    entityType: input.entityType,
    actionUrlOverride: input.actionUrl ?? null,
    transition: input.transition ?? null,
    aipId: input.aipId ?? null,
    projectId: input.projectId ?? null,
    feedbackId: input.feedbackId ?? null,
    rootFeedbackId: input.feedbackId ?? null,
    projectUpdateId: input.projectUpdateId ?? null,
    projectCategory: null,
    feedbackTargetType: null,
  });
}

export function safeTruncate(text: string | null | undefined, limit: number): string {
  if (!text) return "";
  const normalized = removeControlChars(text);
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  const truncated = normalized.slice(0, Math.max(1, limit - 3)).trimEnd();
  return `${truncated}...`;
}

export function formatEntityLabel(metadataInput: unknown): string {
  const metadata = asRecord(metadataInput);
  const entityType = asString(metadata.entity_type)?.toLowerCase() ?? null;

  if (entityType === "aip") {
    const fiscalYear = asNumber(metadata.fiscal_year);
    if (fiscalYear !== null) return `AIP FY ${fiscalYear}`;
    return "AIP";
  }

  if (entityType === "project") {
    const projectName = asString(metadata.project_name);
    if (projectName) return `Project: ${projectName}`;
    return "Project";
  }

  if (entityType === "project_update") {
    const updateTitle = asString(metadata.update_title);
    if (updateTitle) return `Update: ${updateTitle}`;
    return "Project update";
  }

  if (entityType === "feedback") {
    const targetLabel =
      asString(metadata.target_label) ??
      asString(metadata.project_name) ??
      asString(metadata.entity_label);
    if (targetLabel) return `Feedback on ${targetLabel}`;
    return "Feedback";
  }

  return asString(metadata.entity_label) ?? "Notification";
}

export function formatContextLine(metadataInput: unknown, surface: DisplaySurface): string {
  const metadata = asRecord(metadataInput);
  const entityLabel = formatEntityLabel(metadata);

  if (surface === "dropdown") {
    const lguOrScope = pickLguName(metadata) ?? pickScopeLabel(metadata);
    return `${lguOrScope} • ${entityLabel}`;
  }

  const lineParts: string[] = [];
  const lguName = asString(metadata.lgu_name) ?? pickLguName(metadata) ?? pickScopeLabel(metadata);
  lineParts.push(lguName);
  lineParts.push(entityLabel);

  const fiscalYear = asNumber(metadata.fiscal_year);
  if (fiscalYear !== null && !entityLabel.includes(`FY ${fiscalYear}`)) {
    lineParts.push(`FY ${fiscalYear}`);
  }

  return lineParts.join(" • ");
}

export function buildDisplay(
  row: NotificationDisplayRow,
  surface: DisplaySurface
): NotificationDisplay {
  const metadata = asRecord(row.metadata);
  const eventType = (row.event_type ?? asString(metadata.event_type) ?? "GENERIC_NOTIFICATION").toUpperCase();
  const context = formatContextLine(metadata, surface);
  const actionUrl = row.action_url ?? asString(metadata.action_url) ?? null;
  const messageFallback = asString(row.message);
  const titleFallback = asString(row.title) ?? messageFallback ?? "Notification";

  switch (eventType) {
    case "AIP_CLAIMED": {
      const dropdownTitle = "A city official claimed your AIP for review.";
      const pageTitle = "AIP claimed for review";
      const actorName = asString(metadata.actor_name);
      const excerpt = actorName ? `Claimed by ${actorName} (City Official).` : undefined;
      return {
        title: surface === "dropdown" ? withDropdownTitleLimit(dropdownTitle) : pageTitle,
        context,
        excerpt,
        iconKey: "clipboard-check",
        actionUrl,
      };
    }
    case "AIP_REVISION_REQUESTED": {
      const revisionNotes =
        safeTruncate(
          asString(metadata.revision_notes) ?? asString(metadata.note) ?? asString(metadata.revision_reason),
          REVISION_EXCERPT_MAX
        ) || "No comment provided.";
      return {
        title:
          surface === "dropdown"
            ? withDropdownTitleLimit("Revision requested for your AIP.")
            : "Revision requested for AIP",
        context,
        excerpt: revisionNotes,
        iconKey: "pencil-alert",
        pill: "Revision",
        actionUrl,
      };
    }
    case "AIP_PUBLISHED": {
      const isCitizenRecipient = (row.recipient_role ?? "").toLowerCase() === "citizen";
      const dropdownTitle = isCitizenRecipient
        ? getCitizenAipPublishedDropdownTitle(metadata)
        : "Your AIP has been published.";
      const actorName = asString(metadata.actor_name);
      return {
        title: surface === "dropdown" ? withDropdownTitleLimit(dropdownTitle) : "AIP published",
        context,
        excerpt: actorName ? `Published by ${actorName}.` : undefined,
        iconKey: "globe",
        actionUrl,
      };
    }
    case "AIP_SUBMITTED": {
      const actorName = asString(metadata.actor_name);
      return {
        title: surface === "dropdown" ? withDropdownTitleLimit("AIP submitted for review.") : "AIP submitted",
        context,
        excerpt: actorName ? `Submitted by ${actorName} (Barangay Official).` : undefined,
        iconKey: "inbox",
        actionUrl,
      };
    }
    case "AIP_RESUBMITTED": {
      const resubmissionNote = safeTruncate(
        asString(metadata.resubmission_note) ?? asString(metadata.note),
        REVISION_EXCERPT_MAX
      );
      return {
        title:
          surface === "dropdown"
            ? withDropdownTitleLimit("AIP resubmitted after revision.")
            : "AIP resubmitted",
        context,
        excerpt: resubmissionNote || undefined,
        iconKey: "refresh-cw",
        actionUrl,
      };
    }
    case "AIP_EXTRACTION_SUCCEEDED": {
      return {
        title:
          surface === "dropdown"
            ? withDropdownTitleLimit("Your AIP upload was processed successfully.")
            : "AIP processing completed",
        context,
        excerpt:
          surface === "page"
            ? "Extraction and validation completed successfully."
            : undefined,
        iconKey: "clipboard-check",
        actionUrl,
      };
    }
    case "AIP_EXTRACTION_FAILED": {
      const errorMessageRaw = asString(metadata.error_message) ?? messageFallback ?? "";
      const excerpt =
        safeTruncate(firstLine(errorMessageRaw), AIP_EXTRACTION_EXCERPT_MAX) ||
        "No error details were provided.";
      return {
        title:
          surface === "dropdown"
            ? withDropdownTitleLimit("AIP processing failed. Please review and retry.")
            : "AIP processing failed",
        context,
        excerpt,
        iconKey: "x-circle",
        pill: "Alert",
        actionUrl,
      };
    }
    case "AIP_EMBED_SUCCEEDED": {
      return {
        title:
          surface === "dropdown"
            ? withDropdownTitleLimit("Search indexing completed for your published AIP.")
            : "AIP embedding completed",
        context,
        excerpt:
          surface === "page"
            ? "Search indexing completed successfully and chatbot queries are now enabled."
            : undefined,
        iconKey: "clipboard-check",
        actionUrl,
      };
    }
    case "AIP_EMBED_FAILED": {
      const errorMessageRaw = asString(metadata.error_message) ?? messageFallback ?? "";
      const excerpt =
        safeTruncate(firstLine(errorMessageRaw), AIP_EMBED_EXCERPT_MAX) ||
        "No error details were provided.";
      return {
        title:
          surface === "dropdown"
            ? withDropdownTitleLimit("AIP embedding failed. Please review and retry indexing.")
            : "AIP embedding failed",
        context,
        excerpt,
        iconKey: "x-circle",
        pill: "Alert",
        actionUrl,
      };
    }
    case "FEEDBACK_CREATED": {
      const reply = isReplyEvent(metadata);
      const feedbackKind = pickFeedbackKindLabel(metadata);
      const excerpt = safeTruncate(
        asString(metadata.excerpt) ?? asString(metadata.feedback_excerpt) ?? messageFallback,
        FEEDBACK_EXCERPT_MAX
      );

      if (reply) {
        const replyDetail = getFeedbackReplyDetail(metadata);
        const replyExcerpt = quoteExcerpt(excerpt);
        return {
          title:
            surface === "dropdown"
              ? withDropdownTitleLimit(getFeedbackReplyDropdownTitle(metadata))
              : "New reply in feedback thread",
          context,
          excerpt:
            surface === "page"
              ? [replyExcerpt, replyDetail].filter((part) => !!part).join("\n") || undefined
              : replyExcerpt ?? replyDetail,
          iconKey: "corner-down-right",
          actionUrl,
        };
      }

      const topLevelExcerpt = quoteExcerpt(excerpt);
      const topLevelDetail = getFeedbackTopLevelDetail(metadata);
      return {
        title:
          surface === "dropdown"
            ? withDropdownTitleLimit("New feedback was posted.")
            : "New feedback posted",
        context,
        excerpt:
          surface === "page"
            ? [topLevelExcerpt, topLevelDetail].filter((part) => !!part).join("\n") || undefined
            : topLevelExcerpt,
        iconKey: "message-square",
        pill: feedbackKind ?? undefined,
        actionUrl,
      };
    }
    case "FEEDBACK_VISIBILITY_CHANGED": {
      const visibilityAction = pickVisibilityAction(metadata);
      const dropdownTitle =
        visibilityAction === "hidden"
          ? "Your feedback was hidden by an admin."
          : "Your feedback is visible again.";
      const moderationReason =
        safeTruncate(
          asString(metadata.moderation_reason) ?? asString(metadata.reason),
          FEEDBACK_EXCERPT_MAX
        ) || "No reason provided.";
      return {
        title:
          surface === "dropdown" ? withDropdownTitleLimit(dropdownTitle) : "Feedback moderation update",
        context,
        excerpt: `Reason: ${moderationReason}`,
        iconKey: "shield",
        pill: "Moderation",
        actionUrl,
      };
    }
    case "PROJECT_UPDATE_STATUS_CHANGED": {
      const { oldStatus, newStatus } = pickUpdateVisibilityState(metadata);
      const newVisible = isVisibleStatus(newStatus);
      const hidden = isHiddenStatus(newStatus);
      const isRestored = newVisible && isHiddenStatus(oldStatus);
      const dropdownTitle = hidden
        ? "A project update was removed from public view."
        : isRestored
          ? "A project update is visible again."
          : "A project update has been posted.";
      const pageTitle = hidden
        ? "Project update removed"
        : isRestored
          ? "Project update restored"
          : "Project update posted";
      const updateExcerpt = safeTruncate(
        asString(metadata.update_title) ?? asString(metadata.excerpt) ?? asString(row.message),
        FEEDBACK_EXCERPT_MAX
      );
      return {
        title: surface === "dropdown" ? withDropdownTitleLimit(dropdownTitle) : pageTitle,
        context,
        excerpt: updateExcerpt || undefined,
        iconKey: "megaphone",
        actionUrl,
      };
    }
    case "OUTBOX_FAILURE_THRESHOLD_REACHED": {
      const failedCount =
        asNumber(metadata.failed_count) ?? asNumber(metadata.failed_count_last_hour);
      const threshold = asNumber(metadata.threshold);
      const windowLabel =
        asString(metadata.window) ?? asString(metadata.window_label) ?? "Last 60 minutes";
      const sampleError = safeTruncate(
        asString(metadata.last_error_sample),
        FEEDBACK_EXCERPT_MAX
      );
      const lineOne = `Failed in ${windowLabel}: ${failedCount ?? "?"} (threshold ${threshold ?? "?"})`;
      const lineTwo = `Sample error: ${sampleError || "No sample available."}`;

      return {
        title:
          surface === "dropdown"
            ? withDropdownTitleLimit("Email delivery failures detected.")
            : "Outbox failure threshold reached",
        context: surface === "dropdown" ? "System • Outbox" : "System • Email Outbox",
        excerpt: `${lineOne}\n${lineTwo}`,
        iconKey: "alert-triangle",
        pill: "Alert",
        actionUrl,
      };
    }
    case "MODERATION_ACTION_AUDIT": {
      const entityType = toTitleCaseToken(asString(metadata.entity_type)) ?? "System";
      const lguName = pickLguName(metadata) ?? "System";
      const moderationAction = asString(metadata.moderation_action) ?? "Recorded";
      const moderationReason =
        safeTruncate(
          asString(metadata.moderation_reason) ?? asString(metadata.reason),
          FEEDBACK_EXCERPT_MAX
        ) || "-";
      const fullContext = `${entityType} • ${asString(metadata.entity_label) ?? formatEntityLabel(metadata)}`;

      return {
        title:
          surface === "dropdown"
            ? withDropdownTitleLimit("Moderation action recorded.")
            : "Moderation audit entry",
        context: surface === "dropdown" ? `${entityType} • ${lguName}` : fullContext,
        excerpt: `Action: ${moderationAction} • Reason: ${moderationReason}`,
        iconKey: "clipboard-list",
        pill: surface === "dropdown" ? undefined : "Moderation",
        actionUrl,
      };
    }
    case "PIPELINE_JOB_FAILED": {
      const stage = asString(metadata.stage) ?? "Unknown stage";
      const aipId = asString(metadata.aip_id);
      const aipShort = getAipIdShort(metadata);
      const errorMessageRaw = asString(metadata.error_message) ?? messageFallback ?? "";
      const pipelineExcerpt = safeTruncate(firstLine(errorMessageRaw), PIPELINE_EXCERPT_MAX);
      const pageContext = `Stage: ${stage}${aipId ? ` • AIP: ${aipId}` : ""}`;
      const dropdownContext = `${stage}${aipShort ? ` • AIP ${aipShort}` : ""}`;
      return {
        title: surface === "dropdown" ? withDropdownTitleLimit("Pipeline job failed.") : "Pipeline job failed",
        context: surface === "dropdown" ? dropdownContext : pageContext,
        excerpt: pipelineExcerpt || undefined,
        iconKey: "x-circle",
        pill: "Alert",
        actionUrl,
      };
    }
    default:
      return {
        title: surface === "dropdown" ? withDropdownTitleLimit(titleFallback) : titleFallback,
        context,
        excerpt: safeTruncate(messageFallback, FEEDBACK_EXCERPT_MAX) || undefined,
        iconKey: "bell",
        actionUrl,
      };
  }
}

export function buildNotificationTemplate(input: NotifyInput): NotificationTemplate {
  const transition = input.transition?.trim() || null;
  const note = input.note?.trim() || null;
  const reason = input.reason?.trim() || null;
  const metadata = asRecord(input.metadata);
  const isReply =
    asBoolean(metadata.is_reply) || Object.keys(asRecord(metadata.reply_context)).length > 0;
  const visibilityAction = asString(metadata.visibility_action)?.toLowerCase() ?? null;
  const normalizedTransition = transition?.toLowerCase() ?? null;
  const isRemovedTransition =
    visibilityAction === "hidden" ||
    normalizedTransition === "published->hidden" ||
    normalizedTransition === "active->hidden" ||
    normalizedTransition === "visible->hidden";
  const isRestoredTransition =
    visibilityAction === "unhidden" ||
    normalizedTransition === "hidden->published" ||
    normalizedTransition === "hidden->active" ||
    normalizedTransition === "hidden->visible";

  switch (input.eventType) {
    case "AIP_CLAIMED":
      return {
        title: "AIP Claimed For Review",
        message: withActorPrefix(input.actorName, "A city official claimed an AIP for review."),
        emailSubject: "OpenAIP - Your AIP was claimed for review",
        templateKey: "AIP_CLAIMED",
      };
    case "AIP_REVISION_REQUESTED":
      return {
        title: "AIP Revision Requested",
        message: note
          ? `Revision requested: ${note}`
          : withActorPrefix(input.actorName, "A city official requested revisions on an AIP."),
        emailSubject: "OpenAIP - Revision requested for your AIP",
        templateKey: "AIP_REVISION_REQUESTED",
      };
    case "AIP_PUBLISHED":
      return {
        title: "AIP Published",
        message: "An AIP was published and is now visible.",
        emailSubject: "OpenAIP - AIP Published",
        templateKey: "AIP_PUBLISHED",
      };
    case "AIP_SUBMITTED":
      return {
        title: "AIP Submitted For Review",
        message: "A barangay AIP was submitted for city review.",
        emailSubject: "OpenAIP - New AIP submitted for review",
        templateKey: "AIP_SUBMITTED",
      };
    case "AIP_RESUBMITTED":
      return {
        title: "AIP Resubmitted For Review",
        message: "A revised barangay AIP was resubmitted for city review.",
        emailSubject: "OpenAIP - AIP resubmitted after revision",
        templateKey: "AIP_RESUBMITTED",
      };
    case "AIP_EXTRACTION_SUCCEEDED":
      return {
        title: "AIP Processing Completed",
        message: "Your AIP upload was processed successfully.",
        emailSubject: "OpenAIP - AIP upload processing completed",
        templateKey: "aip_extraction_succeeded",
      };
    case "AIP_EXTRACTION_FAILED":
      return {
        title: "AIP Processing Failed",
        message: "AIP processing failed. Please review and retry.",
        emailSubject: "OpenAIP - AIP upload processing failed",
        templateKey: "aip_extraction_failed",
      };
    case "AIP_EMBED_SUCCEEDED":
      return {
        title: "AIP Embedding Completed",
        message: "Search indexing completed successfully for this published AIP.",
        emailSubject: "OpenAIP - AIP search indexing completed",
        templateKey: "aip_embed_succeeded",
      };
    case "AIP_EMBED_FAILED":
      return {
        title: "AIP Embedding Failed",
        message: "AIP search indexing failed. Please review and retry.",
        emailSubject: "OpenAIP - AIP search indexing failed",
        templateKey: "aip_embed_failed",
      };
    case "FEEDBACK_CREATED":
      if (isReply) {
        return {
          title: "New Reply in Feedback Thread",
          message: "A reply was posted in a feedback thread.",
          emailSubject: "OpenAIP — New reply in a feedback thread",
          templateKey: "feedback_reply",
        };
      }
      return {
        title: "New Feedback Posted",
        message: "New feedback was posted.",
        emailSubject: "OpenAIP — New feedback posted",
        templateKey: "feedback_posted",
      };
    case "FEEDBACK_VISIBILITY_CHANGED":
      return {
        title: "Feedback Moderation Update",
        message: reason
          ? `Feedback moderation update. Reason: ${reason}`
          : "Feedback visibility was updated by an administrator.",
        emailSubject: "OpenAIP — Feedback moderation update",
        templateKey: "feedback_visibility_changed",
      };
    case "PROJECT_UPDATE_STATUS_CHANGED":
      if (isRemovedTransition) {
        return {
          title: "Project Update Removed",
          message: "A project update was removed from public view.",
          emailSubject: "OpenAIP — Project update removed from public view",
          templateKey: "project_update_posted",
        };
      }
      if (isRestoredTransition) {
        return {
          title: "Project Update Restored",
          message: "A project update is visible again.",
          emailSubject: "OpenAIP — Project update is visible again",
          templateKey: "project_update_posted",
        };
      }
      return {
        title: "Project Update Posted",
        message: "A project update has been posted.",
        emailSubject: "OpenAIP — A project update has been posted",
        templateKey: "project_update_posted",
      };
    case "OUTBOX_FAILURE_THRESHOLD_REACHED":
      return {
        title: "Email Outbox Failure Threshold Reached",
        message: "Email delivery failures exceeded the configured threshold in the last hour.",
        emailSubject: "OpenAIP - Email delivery failures detected",
        templateKey: "OUTBOX_FAILURE_THRESHOLD_REACHED",
      };
    case "MODERATION_ACTION_AUDIT":
      return {
        title: "Moderation Action Recorded",
        message: reason
          ? `A moderation action was recorded. Reason: ${reason}`
          : "A moderation action was recorded for audit.",
        emailSubject: "OpenAIP - Moderation action recorded",
        templateKey: "MODERATION_ACTION_AUDIT",
      };
    case "PIPELINE_JOB_FAILED":
      return {
        title: "AIP Pipeline Job Failed",
        message: "A pipeline job failed and requires review.",
        emailSubject: "OpenAIP - Pipeline job failed",
        templateKey: "PIPELINE_JOB_FAILED",
      };
    default:
      return {
        title: "New Notification",
        message: "You have a new notification.",
        emailSubject: "OpenAIP - Notification",
        templateKey: "GENERIC_NOTIFICATION",
      };
  }
}
