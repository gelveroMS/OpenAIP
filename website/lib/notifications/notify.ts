import "server-only";

import type { SupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildNotificationDedupeKey, toHourBucket } from "./dedupe";
import type { NotificationScopeType, NotifyInput, NotifyResult } from "./events";
import { buildNotificationActionUrl } from "./action-url";
import {
  getAdminRecipients,
  getBarangayOfficialRecipients,
  getCitizenRecipientsForBarangay,
  getCitizenRecipientsForCity,
  getCityOfficialRecipients,
  getRecipientByUserId,
  mergeRecipients,
  resolveAipScope,
  resolveAipTemplateContext,
  resolveActorDisplayName,
  resolveFeedbackContext,
  resolveFeedbackTemplateContext,
  resolveProjectTemplateContext,
  resolveProjectScope,
  resolveProjectUpdateContext,
  resolveProjectUpdateTemplateContext,
  type NotificationRecipient,
} from "./recipients";
import { buildNotificationTemplate } from "./templates";

type PreferenceRow = {
  user_id: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
};

type NotificationPreference = {
  inAppEnabled: boolean;
  emailEnabled: boolean;
};

function toNotificationScope(recipient: NotificationRecipient): NotificationScopeType {
  return recipient.scopeType;
}

function normalizeTransition(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const MAX_FEEDBACK_EXCERPT_LENGTH = 200;
const MAX_REASON_LENGTH = 240;
const MAX_DISPLAY_EXCERPT_LENGTH = 120;

function sanitizeTemplateText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  const sanitized = value
    .replaceAll(/[\u0000-\u001f\u007f]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (!sanitized) return null;
  if (sanitized.length <= maxLength) return sanitized;
  return `${sanitized.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function humanizeToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ");
  if (!normalized) return null;

  return normalized
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function parseTransition(
  transition: string | null
): { from: string | null; to: string | null } {
  if (!transition) return { from: null, to: null };
  const [fromRaw, toRaw] = transition.split("->", 2);
  return {
    from: fromRaw?.trim() || null,
    to: toRaw?.trim() || null,
  };
}

function normalizeStatusLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "active") return "Published";
  return humanizeToken(normalized);
}

function toVisibilityAction(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? null;
  if (!normalized) return null;
  if (normalized === "hidden") return "hidden";
  if (normalized === "visible" || normalized === "published" || normalized === "active") {
    return "unhidden";
  }
  return null;
}

function toModerationActionLabel(input: {
  eventType: NotifyInput["eventType"];
  entityType: NotifyInput["entityType"];
  transition: string | null;
}): string | null {
  if (input.eventType !== "MODERATION_ACTION_AUDIT") return null;
  const parsed = parseTransition(input.transition);
  const next = parsed.to?.toLowerCase() ?? null;

  if (input.entityType === "feedback") {
    if (next === "hidden") return "feedback_hidden";
    if (next === "visible") return "feedback_unhidden";
  }

  if (input.entityType === "project_update") {
    if (next === "hidden") return "project_update_hidden";
    if (next === "published" || next === "active") return "project_update_unhidden";
  }

  return null;
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    output[key] = value;
  }
  return output;
}

function toActorRoleToken(value: NotifyInput["actorRole"] | null | undefined): string | null {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  return normalized;
}

function toActorRoleLabel(value: NotifyInput["actorRole"] | null | undefined): string | null {
  const token = toActorRoleToken(value);
  if (!token) return null;
  if (token === "citizen") return "Citizen";
  if (token === "barangay_official") return "Barangay Official";
  if (token === "city_official" || token === "municipal_official") return "City Official";
  if (token === "admin") return "Administrator";
  if (token === "system") return "System";
  return humanizeToken(token);
}

function formatEntityLabelForMetadata(input: {
  entityType: NotifyInput["entityType"];
  fiscalYear: number | null;
  projectName: string | null;
  updateTitle: string | null;
  targetLabel: string | null;
}): string {
  if (input.entityType === "aip") {
    if (typeof input.fiscalYear === "number") {
      return `AIP FY ${input.fiscalYear}`;
    }
    return "AIP";
  }

  if (input.entityType === "project") {
    return input.projectName ? `Project: ${input.projectName}` : "Project";
  }

  if (input.entityType === "project_update") {
    return input.updateTitle ? `Update: ${input.updateTitle}` : "Project update";
  }

  if (input.entityType === "feedback") {
    const label = input.targetLabel ?? input.projectName;
    return label ? `Feedback on ${label}` : "Feedback";
  }

  return "Notification";
}

function toPipelineErrorExcerpt(value: string | null | undefined): string | null {
  const sanitized = sanitizeTemplateText(value ?? null, MAX_REASON_LENGTH);
  if (!sanitized) return null;
  const [firstLine] = sanitized.split(/\r?\n/, 1);
  if (!firstLine) return null;
  return sanitizeTemplateText(firstLine, MAX_DISPLAY_EXCERPT_LENGTH);
}

async function loadPreferencesByUserId(
  admin: SupabaseAdminClient,
  userIds: string[],
  eventType: string
): Promise<Map<string, NotificationPreference>> {
  const uniqueUserIds = Array.from(new Set(userIds));
  if (uniqueUserIds.length === 0) return new Map();

  const { data, error } = await admin
    .from("notification_preferences")
    .select("user_id,in_app_enabled,email_enabled")
    .eq("event_type", eventType)
    .in("user_id", uniqueUserIds);
  if (error) {
    throw new Error(error.message);
  }

  const map = new Map<string, NotificationPreference>();
  for (const row of (data ?? []) as PreferenceRow[]) {
    map.set(row.user_id, {
      inAppEnabled: row.in_app_enabled,
      emailEnabled: row.email_enabled,
    });
  }
  return map;
}

async function resolveRecipientEmail(
  admin: SupabaseAdminClient,
  recipient: NotificationRecipient
): Promise<string | null> {
  const profileEmail = recipient.email?.trim() ?? "";
  if (profileEmail.length > 0) return profileEmail;

  const { data, error } = await admin.auth.admin.getUserById(recipient.userId);
  if (error) {
    return null;
  }
  const authEmail = data.user?.email?.trim() ?? "";
  return authEmail.length > 0 ? authEmail : null;
}

async function resolveRecipientsForEvent(
  admin: SupabaseAdminClient,
  input: NotifyInput
): Promise<{
  recipients: NotificationRecipient[];
  resolvedAipId: string | null;
  resolvedProjectId: string | null;
  resolvedFeedbackId: string | null;
  resolvedProjectUpdateId: string | null;
  resolvedBarangayId: string | null;
  resolvedCityId: string | null;
  resolvedFeedbackContext: Awaited<ReturnType<typeof resolveFeedbackContext>>;
  resolvedProjectScope: Awaited<ReturnType<typeof resolveProjectScope>>;
  resolvedProjectUpdateContext: Awaited<ReturnType<typeof resolveProjectUpdateContext>>;
}> {
  let resolvedAipId = input.aipId ?? null;
  let resolvedProjectId = input.projectId ?? null;
  const resolvedFeedbackId = input.feedbackId ?? null;
  const resolvedProjectUpdateId = input.projectUpdateId ?? null;
  let resolvedBarangayId = input.barangayId ?? null;
  let resolvedCityId = input.cityId ?? null;
  let resolvedFeedbackContext: Awaited<ReturnType<typeof resolveFeedbackContext>> = null;
  let resolvedProjectScope: Awaited<ReturnType<typeof resolveProjectScope>> = null;
  let resolvedProjectUpdateContext: Awaited<ReturnType<typeof resolveProjectUpdateContext>> = null;

  if (resolvedAipId && (!resolvedBarangayId || !resolvedCityId)) {
    const scope = await resolveAipScope(admin, resolvedAipId);
    resolvedBarangayId = resolvedBarangayId ?? scope?.barangayId ?? null;
    resolvedCityId = resolvedCityId ?? scope?.cityId ?? null;
  }

  if (resolvedProjectId && (!resolvedAipId || !resolvedBarangayId || !resolvedCityId)) {
    resolvedProjectScope = await resolveProjectScope(admin, resolvedProjectId);
    if (resolvedProjectScope) {
      resolvedAipId = resolvedAipId ?? resolvedProjectScope.aipId;
      resolvedBarangayId = resolvedBarangayId ?? resolvedProjectScope.scope?.barangayId ?? null;
      resolvedCityId = resolvedCityId ?? resolvedProjectScope.scope?.cityId ?? null;
    }
  }

  if (resolvedFeedbackId && (!resolvedAipId || !resolvedProjectId || !resolvedBarangayId || !resolvedCityId)) {
    resolvedFeedbackContext = await resolveFeedbackContext(admin, resolvedFeedbackId);
    if (resolvedFeedbackContext) {
      resolvedAipId = resolvedAipId ?? resolvedFeedbackContext.aipId;
      resolvedProjectId = resolvedProjectId ?? resolvedFeedbackContext.projectId;
      resolvedBarangayId = resolvedBarangayId ?? resolvedFeedbackContext.scope?.barangayId ?? null;
      resolvedCityId = resolvedCityId ?? resolvedFeedbackContext.scope?.cityId ?? null;
    }
  }

  if (resolvedProjectUpdateId && (!resolvedAipId || !resolvedProjectId || !resolvedBarangayId || !resolvedCityId)) {
    resolvedProjectUpdateContext = await resolveProjectUpdateContext(admin, resolvedProjectUpdateId);
    if (resolvedProjectUpdateContext) {
      resolvedAipId = resolvedAipId ?? resolvedProjectUpdateContext.aipId;
      resolvedProjectId = resolvedProjectId ?? resolvedProjectUpdateContext.projectId;
      resolvedBarangayId = resolvedBarangayId ?? resolvedProjectUpdateContext.scope?.barangayId ?? null;
      resolvedCityId = resolvedCityId ?? resolvedProjectUpdateContext.scope?.cityId ?? null;
    }
  }

  if ((input.eventType === "FEEDBACK_VISIBILITY_CHANGED" || input.eventType === "FEEDBACK_CREATED") && resolvedFeedbackId) {
    resolvedFeedbackContext = resolvedFeedbackContext ?? (await resolveFeedbackContext(admin, resolvedFeedbackId));
    if (resolvedFeedbackContext) {
      resolvedAipId = resolvedAipId ?? resolvedFeedbackContext.aipId;
      resolvedProjectId = resolvedProjectId ?? resolvedFeedbackContext.projectId;
      resolvedBarangayId = resolvedBarangayId ?? resolvedFeedbackContext.scope?.barangayId ?? null;
      resolvedCityId = resolvedCityId ?? resolvedFeedbackContext.scope?.cityId ?? null;
    }
  }

  if (resolvedProjectId && !resolvedProjectScope) {
    resolvedProjectScope = await resolveProjectScope(admin, resolvedProjectId);
  }

  if (resolvedProjectUpdateId && !resolvedProjectUpdateContext) {
    resolvedProjectUpdateContext = await resolveProjectUpdateContext(admin, resolvedProjectUpdateId);
  }

  const recipients: NotificationRecipient[] = [];

  switch (input.eventType) {
    case "AIP_CLAIMED":
    case "AIP_REVISION_REQUESTED":
      if (resolvedBarangayId) {
        recipients.push(...(await getBarangayOfficialRecipients(admin, resolvedBarangayId)));
      }
      break;
    case "AIP_PUBLISHED":
      if (input.scopeType === "city") {
        if (resolvedCityId) {
          recipients.push(...(await getCityOfficialRecipients(admin, resolvedCityId)));
          recipients.push(...(await getCitizenRecipientsForCity(admin, resolvedCityId)));
        }
      } else if (resolvedBarangayId) {
        recipients.push(...(await getBarangayOfficialRecipients(admin, resolvedBarangayId)));
        recipients.push(...(await getCitizenRecipientsForBarangay(admin, resolvedBarangayId)));
      }
      break;
    case "AIP_SUBMITTED":
    case "AIP_RESUBMITTED":
      if (resolvedCityId) {
        recipients.push(...(await getCityOfficialRecipients(admin, resolvedCityId)));
      }
      break;
    case "FEEDBACK_CREATED":
      if (resolvedFeedbackId) {
        const feedbackContext =
          resolvedFeedbackContext ?? (await resolveFeedbackContext(admin, resolvedFeedbackId));
        resolvedFeedbackContext = feedbackContext;
        if (feedbackContext?.parentFeedbackId && feedbackContext.rootAuthorUserId) {
          const rootAuthor = await getRecipientByUserId(admin, feedbackContext.rootAuthorUserId);
          if (rootAuthor?.role === "citizen") {
            recipients.push(rootAuthor);
          }
        }
      }
      if (resolvedBarangayId) {
        recipients.push(...(await getBarangayOfficialRecipients(admin, resolvedBarangayId)));
      } else if (resolvedCityId) {
        recipients.push(...(await getCityOfficialRecipients(admin, resolvedCityId)));
      }
      break;
    case "FEEDBACK_VISIBILITY_CHANGED":
      if (resolvedFeedbackId) {
        const feedbackContext =
          resolvedFeedbackContext ?? (await resolveFeedbackContext(admin, resolvedFeedbackId));
        resolvedFeedbackContext = feedbackContext;
        if (feedbackContext?.authorUserId) {
          const author = await getRecipientByUserId(admin, feedbackContext.authorUserId);
          if (author) recipients.push(author);
        }
      }
      if (resolvedCityId && (input.scopeType === "city" || !resolvedBarangayId)) {
        recipients.push(...(await getCityOfficialRecipients(admin, resolvedCityId)));
      }
      if (resolvedBarangayId && input.scopeType !== "city") {
        recipients.push(...(await getBarangayOfficialRecipients(admin, resolvedBarangayId)));
      }
      break;
    case "PROJECT_UPDATE_STATUS_CHANGED":
      if (input.scopeType === "city" && resolvedCityId) {
        recipients.push(...(await getCityOfficialRecipients(admin, resolvedCityId)));
      }
      if (input.scopeType === "barangay" && resolvedBarangayId) {
        recipients.push(...(await getBarangayOfficialRecipients(admin, resolvedBarangayId)));
        if (
          input.transition === "draft->published" ||
          input.transition === "draft->active" ||
          input.transition === "hidden->published" ||
          input.transition === "hidden->active"
        ) {
          recipients.push(...(await getCitizenRecipientsForBarangay(admin, resolvedBarangayId)));
        }
      }
      break;
    case "OUTBOX_FAILURE_THRESHOLD_REACHED":
    case "MODERATION_ACTION_AUDIT":
    case "PIPELINE_JOB_FAILED":
      recipients.push(...(await getAdminRecipients(admin)));
      break;
    default:
      break;
  }

  return {
    recipients: mergeRecipients(recipients),
    resolvedAipId,
    resolvedProjectId,
    resolvedFeedbackId,
    resolvedProjectUpdateId,
    resolvedBarangayId,
    resolvedCityId,
    resolvedFeedbackContext,
    resolvedProjectScope,
    resolvedProjectUpdateContext,
  };
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const admin = supabaseAdmin();
  const {
    recipients,
    resolvedAipId,
    resolvedProjectId,
    resolvedFeedbackId,
    resolvedProjectUpdateId,
    resolvedBarangayId,
    resolvedCityId,
    resolvedFeedbackContext,
    resolvedProjectScope,
    resolvedProjectUpdateContext,
  } = await resolveRecipientsForEvent(admin, input);

  const filteredRecipients =
    input.eventType === "FEEDBACK_CREATED" && input.actorUserId
      ? recipients.filter((recipient) => recipient.userId !== input.actorUserId)
      : recipients;

  if (filteredRecipients.length === 0) {
    return {
      recipientCount: 0,
      notificationsInserted: 0,
      emailsQueued: 0,
    };
  }

  const resolvedEntityId =
    input.entityId ??
    resolvedProjectUpdateId ??
    resolvedFeedbackId ??
    resolvedProjectId ??
    resolvedAipId ??
    null;

  const transition = normalizeTransition(input.transition);
  const dedupeBucket =
    input.dedupeBucket ??
    (input.eventType === "OUTBOX_FAILURE_THRESHOLD_REACHED" ? toHourBucket() : null);

  const dedupeKey = buildNotificationDedupeKey({
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: resolvedEntityId,
    transition,
    bucket: dedupeBucket,
  });
  const isReply = Boolean(resolvedFeedbackContext?.parentFeedbackId);

  const templateInput: NotifyInput = {
    ...input,
    aipId: resolvedAipId,
    projectId: resolvedProjectId,
    feedbackId: resolvedFeedbackId,
    projectUpdateId: resolvedProjectUpdateId,
    barangayId: resolvedBarangayId,
    cityId: resolvedCityId,
    entityId: resolvedEntityId,
    metadata: {
      ...(input.metadata ?? {}),
      is_reply: isReply,
    },
  };
  const template = buildNotificationTemplate(templateInput);
  const resolvedProjectCategory =
    resolvedProjectUpdateContext?.projectCategory ??
    resolvedProjectScope?.projectCategory ??
    resolvedFeedbackContext?.projectCategory ??
    null;
  const resolvedFeedbackTargetType = resolvedFeedbackContext?.targetType ?? null;
  const resolvedRootFeedbackId =
    resolvedFeedbackContext?.rootFeedbackId ?? resolvedFeedbackContext?.feedbackId ?? null;
  const occurredAt = new Date().toISOString();
  const aipTemplateContext = resolvedAipId
    ? await resolveAipTemplateContext(admin, resolvedAipId)
    : null;
  const projectTemplateContext = resolvedProjectId
    ? await resolveProjectTemplateContext(admin, resolvedProjectId)
    : null;
  const projectUpdateTemplateContext = resolvedProjectUpdateId
    ? await resolveProjectUpdateTemplateContext(admin, resolvedProjectUpdateId)
    : null;
  const feedbackTemplateContext = resolvedFeedbackId
    ? await resolveFeedbackTemplateContext(admin, resolvedFeedbackId)
    : null;
  const actorNameFromProfile =
    input.actorName?.trim() || (await resolveActorDisplayName(admin, input.actorUserId));
  const actorName = sanitizeTemplateText(actorNameFromProfile, 120);
  const actorRoleToken = toActorRoleToken(input.actorRole);
  const actorRoleLabel = toActorRoleLabel(input.actorRole);
  const parsedTransition = parseTransition(transition);
  const oldStatusLabel = normalizeStatusLabel(parsedTransition.from);
  const newStatusLabel = normalizeStatusLabel(parsedTransition.to);
  const visibilityAction = toVisibilityAction(parsedTransition.to);
  const newVisibility = normalizeStatusLabel(parsedTransition.to);
  const moderationAction = toModerationActionLabel({
    eventType: input.eventType,
    entityType: input.entityType,
    transition,
  });
  const feedbackExcerpt = sanitizeTemplateText(
    feedbackTemplateContext?.feedbackBody ?? null,
    MAX_FEEDBACK_EXCERPT_LENGTH
  );
  const displayExcerpt = sanitizeTemplateText(
    feedbackTemplateContext?.feedbackBody ?? input.note ?? input.reason ?? null,
    MAX_DISPLAY_EXCERPT_LENGTH
  );
  const sanitizedReason = sanitizeTemplateText(input.reason ?? null, MAX_REASON_LENGTH);
  const sanitizedNote = sanitizeTemplateText(input.note ?? null, MAX_REASON_LENGTH);
  const targetLabel = sanitizeTemplateText(
    feedbackTemplateContext?.targetLabel ?? feedbackTemplateContext?.entityLabel ?? null,
    MAX_REASON_LENGTH
  );
  const projectName = sanitizeTemplateText(projectTemplateContext?.projectName ?? null, MAX_REASON_LENGTH);
  const updateTitle = sanitizeTemplateText(
    projectUpdateTemplateContext?.updateTitle ??
      ((input.metadata?.update_title as string | null | undefined) ?? null),
    MAX_REASON_LENGTH
  );
  const updateExcerpt = sanitizeTemplateText(
    projectUpdateTemplateContext?.updateBody ??
      ((input.metadata?.excerpt as string | null | undefined) ?? null),
    MAX_DISPLAY_EXCERPT_LENGTH
  );
  const entityLabel = formatEntityLabelForMetadata({
    entityType: input.entityType,
    fiscalYear: aipTemplateContext?.fiscalYear ?? null,
    projectName,
    updateTitle,
    targetLabel,
  });
  const replyContext = resolvedFeedbackContext?.parentFeedbackId
    ? {
        root_feedback_id: resolvedFeedbackContext.rootFeedbackId,
        parent_feedback_id: resolvedFeedbackContext.parentFeedbackId,
        target_type: resolvedFeedbackContext.targetType,
      }
    : null;
  const pipelineErrorMessage = sanitizeTemplateText(
    (input.metadata?.error_message as string | null | undefined) ?? null,
    MAX_REASON_LENGTH
  );
  const pipelineErrorExcerpt = toPipelineErrorExcerpt(pipelineErrorMessage);
  const replyExcerpt = isReply ? displayExcerpt ?? feedbackExcerpt : null;
  const threadLabel = isReply ? "Feedback Thread" : null;
  const audienceLabel = humanizeToken(input.scopeType);

  const commonTemplateData = compactRecord({
    app_name: "OpenAIP",
    event_type: input.eventType,
    scope_type: input.scopeType,
    entity_type: input.entityType,
    entity_id: resolvedEntityId,
    occurred_at: occurredAt,
    actor_name: actorName,
    actor_role: actorRoleLabel,
    actor_role_label: actorRoleLabel,
    audience_label: audienceLabel,
    aip_id: resolvedAipId,
    project_id: resolvedProjectId,
    feedback_id: resolvedFeedbackId,
    project_update_id: resolvedProjectUpdateId,
    transition,
    action_url: input.actionUrl ?? null,
  });

  const eventTemplateData = compactRecord(
    input.eventType === "AIP_CLAIMED" ||
      input.eventType === "AIP_REVISION_REQUESTED" ||
      input.eventType === "AIP_PUBLISHED" ||
      input.eventType === "AIP_SUBMITTED" ||
      input.eventType === "AIP_RESUBMITTED"
      ? {
          fiscal_year: aipTemplateContext?.fiscalYear ?? null,
          lgu_name: aipTemplateContext?.lguName ?? null,
          barangay_name: aipTemplateContext?.scopeLabel === "barangay" ? aipTemplateContext?.lguName ?? null : null,
          city_name: aipTemplateContext?.scopeLabel === "city" ? aipTemplateContext?.lguName ?? null : null,
          scope_label: humanizeToken(aipTemplateContext?.scopeLabel ?? null),
          revision_notes: sanitizedNote,
          revision_reason: sanitizedReason ?? sanitizedNote,
          entity_label: entityLabel,
          excerpt: sanitizedNote,
        }
      : input.eventType === "FEEDBACK_CREATED" || input.eventType === "FEEDBACK_VISIBILITY_CHANGED"
        ? {
            lgu_name: aipTemplateContext?.lguName ?? null,
            barangay_name: aipTemplateContext?.scopeLabel === "barangay" ? aipTemplateContext?.lguName ?? null : null,
            city_name: aipTemplateContext?.scopeLabel === "city" ? aipTemplateContext?.lguName ?? null : null,
            entity_label: entityLabel,
            target_label: targetLabel,
            feedback_kind: humanizeToken(feedbackTemplateContext?.feedbackKind ?? null),
            feedback_excerpt: feedbackExcerpt,
            reply_excerpt: replyExcerpt,
            thread_label: threadLabel,
            excerpt: displayExcerpt ?? feedbackExcerpt,
            is_reply: isReply,
            reply_context: replyContext,
            visibility_action: visibilityAction,
            new_visibility: newVisibility,
            moderation_reason: sanitizedReason,
          }
        : input.eventType === "PROJECT_UPDATE_STATUS_CHANGED"
          ? {
              lgu_name: aipTemplateContext?.lguName ?? null,
              barangay_name: aipTemplateContext?.scopeLabel === "barangay" ? aipTemplateContext?.lguName ?? null : null,
              city_name: aipTemplateContext?.scopeLabel === "city" ? aipTemplateContext?.lguName ?? null : null,
              project_name: projectName,
              update_title: updateTitle,
              update_excerpt: updateExcerpt,
              excerpt: updateExcerpt,
              entity_label: entityLabel,
              old_status_label: oldStatusLabel,
              new_status_label: newStatusLabel,
              visibility_action: visibilityAction,
              moderation_reason: sanitizedReason,
            }
          : input.eventType === "MODERATION_ACTION_AUDIT"
            ? {
                lgu_name: aipTemplateContext?.lguName ?? null,
                moderation_action: moderationAction,
                moderation_reason: sanitizedReason,
                entity_type: humanizeToken(input.entityType),
                entity_label: entityLabel,
                entity_id: resolvedEntityId,
              }
            : input.eventType === "OUTBOX_FAILURE_THRESHOLD_REACHED"
              ? {
                  failed_count:
                    (input.metadata?.failed_count as number | null | undefined) ??
                    (input.metadata?.failed_count_last_hour as number | null | undefined) ??
                    null,
                  threshold: (input.metadata?.threshold as number | null | undefined) ?? null,
                  window:
                    (input.metadata?.window as string | null | undefined) ??
                    "Last 60 minutes",
                  window_label: "Last 60 minutes",
                  last_error_sample: sanitizeTemplateText(
                    (input.metadata?.last_error_sample as string | null | undefined) ??
                      (input.metadata?.last_error as string | null | undefined) ??
                      null,
                    MAX_REASON_LENGTH
                  ),
                }
              : input.eventType === "PIPELINE_JOB_FAILED"
                ? {
                    run_id: input.metadata?.run_id ?? null,
                    aip_id: input.metadata?.aip_id ?? resolvedAipId,
                    stage: input.metadata?.stage ?? null,
                    error_code: input.metadata?.error_code ?? null,
                    error_message: pipelineErrorMessage,
                    excerpt: pipelineErrorExcerpt,
                  }
                : {}
  );
  const templateData = {
    ...commonTemplateData,
    ...eventTemplateData,
  };

  const metadata = {
    ...(input.metadata ?? {}),
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: resolvedEntityId,
    actor_user_id: input.actorUserId ?? null,
    actor_role: actorRoleToken ?? null,
    actor_name: actorName ?? null,
    scope_type: input.scopeType,
    lgu_name: aipTemplateContext?.lguName ?? null,
    barangay_name: aipTemplateContext?.scopeLabel === "barangay" ? aipTemplateContext?.lguName ?? null : null,
    city_name: aipTemplateContext?.scopeLabel === "city" ? aipTemplateContext?.lguName ?? null : null,
    fiscal_year: aipTemplateContext?.fiscalYear ?? null,
    entity_label: entityLabel,
    target_label: targetLabel,
    aip_id: resolvedAipId,
    project_id: resolvedProjectId,
    feedback_id: resolvedFeedbackId,
    project_update_id: resolvedProjectUpdateId,
    barangay_id: resolvedBarangayId,
    city_id: resolvedCityId,
    project_name: projectName,
    update_title: updateTitle,
    update_excerpt: updateExcerpt,
    feedback_kind: humanizeToken(feedbackTemplateContext?.feedbackKind ?? null),
    reply_excerpt: replyExcerpt,
    thread_label: threadLabel,
    actor_role_label: actorRoleLabel ?? null,
    audience_label: audienceLabel,
    excerpt:
      input.eventType === "PROJECT_UPDATE_STATUS_CHANGED"
        ? updateExcerpt ?? null
        : input.eventType === "PIPELINE_JOB_FAILED"
          ? pipelineErrorExcerpt ?? null
          : displayExcerpt ?? feedbackExcerpt ?? null,
    is_reply: isReply,
    reply_context: replyContext,
    moderation_reason: sanitizedReason ?? null,
    visibility_action: visibilityAction,
    old_status_label: oldStatusLabel,
    new_status_label: newStatusLabel,
    stage: (input.metadata?.stage as string | null | undefined) ?? null,
    run_id: (input.metadata?.run_id as string | null | undefined) ?? null,
    error_message: pipelineErrorMessage,
    transition,
    reason: sanitizedReason ?? null,
    note: sanitizedNote ?? null,
  };

  const preferences = await loadPreferencesByUserId(
    admin,
    filteredRecipients.map((recipient) => recipient.userId),
    input.eventType
  );

  const actionUrlByRecipientUserId = new Map<string, string>();
  for (const recipient of filteredRecipients) {
    const recipientScopeType = toNotificationScope(recipient);
    actionUrlByRecipientUserId.set(
      recipient.userId,
      buildNotificationActionUrl({
        eventType: input.eventType,
        recipientScopeType,
        entityType: input.entityType,
        actionUrlOverride: input.actionUrl ?? null,
        transition,
        aipId: resolvedAipId,
        runId: (input.metadata?.run_id as string | null | undefined) ?? null,
        projectId: resolvedProjectId,
        feedbackId: resolvedFeedbackId,
        rootFeedbackId: resolvedRootFeedbackId,
        projectUpdateId: resolvedProjectUpdateId,
        projectCategory: resolvedProjectCategory,
        feedbackTargetType: resolvedFeedbackTargetType,
      })
    );
  }

  const notificationRows: Array<Record<string, unknown>> = [];
  for (const recipient of filteredRecipients) {
    const pref = preferences.get(recipient.userId);
    const inAppEnabled = pref?.inAppEnabled ?? true;
    if (!inAppEnabled) continue;

    const actionUrl = actionUrlByRecipientUserId.get(recipient.userId) ?? null;
    notificationRows.push({
      recipient_user_id: recipient.userId,
      recipient_role: recipient.role,
      scope_type: toNotificationScope(recipient),
      event_type: input.eventType,
      entity_type: input.entityType,
      entity_id: resolvedEntityId,
      title: template.title,
      message: template.message,
      action_url: actionUrl,
      metadata,
      dedupe_key: dedupeKey,
    });
  }

  const sendEmail = input.sendEmail !== false;
  const emailRows: Array<Record<string, unknown>> = [];
  if (sendEmail) {
    for (const recipient of filteredRecipients) {
      const pref = preferences.get(recipient.userId);
      const emailEnabled = pref?.emailEnabled ?? true;
      if (!emailEnabled) continue;

      const toEmail = await resolveRecipientEmail(admin, recipient);
      if (!toEmail) continue;
      const actionUrl = actionUrlByRecipientUserId.get(recipient.userId) ?? null;

      emailRows.push({
        recipient_user_id: recipient.userId,
        to_email: toEmail,
        template_key: template.templateKey,
        subject: template.emailSubject,
        payload: {
          title: template.title,
          message: template.message,
          action_url: actionUrl,
          notification_ref: dedupeKey,
          event_type: input.eventType,
          scope_type: toNotificationScope(recipient),
          entity_type: input.entityType,
          entity_id: resolvedEntityId,
          template_data: templateData,
          metadata,
        },
        status: "queued",
        dedupe_key: dedupeKey,
      });
    }
  }

  if (notificationRows.length > 0) {
    const { error } = await admin.from("notifications").upsert(notificationRows, {
      onConflict: "recipient_user_id,dedupe_key",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(error.message);
  }

  if (emailRows.length > 0) {
    const { error } = await admin.from("email_outbox").upsert(emailRows, {
      onConflict: "to_email,dedupe_key",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(error.message);
  }

  return {
    recipientCount: filteredRecipients.length,
    notificationsInserted: notificationRows.length,
    emailsQueued: emailRows.length,
  };
}

export async function notifySafely(input: NotifyInput): Promise<void> {
  try {
    await notify(input);
  } catch (error) {
    console.error("[NOTIFICATIONS][EMIT_FAILED]", {
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
