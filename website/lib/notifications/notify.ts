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
        if (input.transition === "draft->published" || input.transition === "hidden->published") {
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

  const templateInput: NotifyInput = {
    ...input,
    aipId: resolvedAipId,
    projectId: resolvedProjectId,
    feedbackId: resolvedFeedbackId,
    projectUpdateId: resolvedProjectUpdateId,
    barangayId: resolvedBarangayId,
    cityId: resolvedCityId,
    entityId: resolvedEntityId,
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
  const feedbackTemplateContext = resolvedFeedbackId
    ? await resolveFeedbackTemplateContext(admin, resolvedFeedbackId)
    : null;
  const actorNameFromProfile =
    input.actorName?.trim() || (await resolveActorDisplayName(admin, input.actorUserId));
  const actorName = sanitizeTemplateText(actorNameFromProfile, 120);
  const actorRoleLabel = humanizeToken(input.actorRole ?? null);
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
  const sanitizedReason = sanitizeTemplateText(input.reason ?? null, MAX_REASON_LENGTH);
  const sanitizedNote = sanitizeTemplateText(input.note ?? null, MAX_REASON_LENGTH);

  const commonTemplateData = compactRecord({
    event_type: input.eventType,
    scope_type: input.scopeType,
    entity_type: input.entityType,
    entity_id: resolvedEntityId,
    occurred_at: occurredAt,
    actor_name: actorName,
    actor_role: actorRoleLabel,
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
          scope_label: humanizeToken(aipTemplateContext?.scopeLabel ?? null),
          revision_notes: sanitizedNote,
          revision_reason: sanitizedReason ?? sanitizedNote,
          entity_label:
            aipTemplateContext?.lguName && typeof aipTemplateContext.fiscalYear === "number"
              ? `${aipTemplateContext.lguName} FY ${aipTemplateContext.fiscalYear} AIP`
              : aipTemplateContext?.lguName
                ? `${aipTemplateContext.lguName} AIP`
                : typeof aipTemplateContext?.fiscalYear === "number"
                  ? `FY ${aipTemplateContext.fiscalYear} AIP`
                  : "AIP",
        }
      : input.eventType === "FEEDBACK_CREATED" || input.eventType === "FEEDBACK_VISIBILITY_CHANGED"
        ? {
            entity_label: feedbackTemplateContext?.entityLabel ?? null,
            feedback_kind: humanizeToken(feedbackTemplateContext?.feedbackKind ?? null),
            feedback_excerpt: feedbackExcerpt,
            visibility_action: visibilityAction,
            new_visibility: newVisibility,
            moderation_reason: sanitizedReason,
          }
        : input.eventType === "PROJECT_UPDATE_STATUS_CHANGED"
          ? {
              project_name: projectTemplateContext?.projectName ?? null,
              old_status_label: oldStatusLabel,
              new_status_label: newStatusLabel,
              moderation_reason: sanitizedReason,
            }
          : input.eventType === "MODERATION_ACTION_AUDIT"
            ? {
                moderation_action: moderationAction,
                moderation_reason: sanitizedReason,
                entity_type: humanizeToken(input.entityType),
                entity_id: resolvedEntityId,
              }
            : input.eventType === "OUTBOX_FAILURE_THRESHOLD_REACHED"
              ? {
                  failed_count:
                    (input.metadata?.failed_count as number | null | undefined) ??
                    (input.metadata?.failed_count_last_hour as number | null | undefined) ??
                    null,
                  threshold: (input.metadata?.threshold as number | null | undefined) ?? null,
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
                    error_message: sanitizeTemplateText(
                      (input.metadata?.error_message as string | null | undefined) ?? null,
                      MAX_REASON_LENGTH
                    ),
                  }
                : {}
  );
  const templateData = {
    ...commonTemplateData,
    ...eventTemplateData,
  };

  const metadata = {
    ...(input.metadata ?? {}),
    actor_user_id: input.actorUserId ?? null,
    actor_role: input.actorRole ?? null,
    actor_name: actorName ?? null,
    scope_type: input.scopeType,
    aip_id: resolvedAipId,
    project_id: resolvedProjectId,
    feedback_id: resolvedFeedbackId,
    project_update_id: resolvedProjectUpdateId,
    barangay_id: resolvedBarangayId,
    city_id: resolvedCityId,
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
