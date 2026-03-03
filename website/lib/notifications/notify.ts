import "server-only";

import type { SupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildNotificationDedupeKey, toHourBucket } from "./dedupe";
import type { NotificationScopeType, NotifyInput, NotifyResult } from "./events";
import {
  getAdminRecipients,
  getBarangayOfficialRecipients,
  getCitizenRecipientsForBarangay,
  getCitizenRecipientsForCity,
  getCityOfficialRecipients,
  getRecipientByUserId,
  mergeRecipients,
  resolveAipScope,
  resolveFeedbackContext,
  resolveProjectScope,
  resolveProjectUpdateContext,
  type NotificationRecipient,
} from "./recipients";
import { buildNotificationTemplate, defaultActionUrl } from "./templates";

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
}> {
  let resolvedAipId = input.aipId ?? null;
  let resolvedProjectId = input.projectId ?? null;
  let resolvedFeedbackId = input.feedbackId ?? null;
  let resolvedProjectUpdateId = input.projectUpdateId ?? null;
  let resolvedBarangayId = input.barangayId ?? null;
  let resolvedCityId = input.cityId ?? null;

  if (resolvedAipId && (!resolvedBarangayId || !resolvedCityId)) {
    const scope = await resolveAipScope(admin, resolvedAipId);
    resolvedBarangayId = resolvedBarangayId ?? scope?.barangayId ?? null;
    resolvedCityId = resolvedCityId ?? scope?.cityId ?? null;
  }

  if (resolvedProjectId && (!resolvedAipId || !resolvedBarangayId || !resolvedCityId)) {
    const projectScope = await resolveProjectScope(admin, resolvedProjectId);
    if (projectScope) {
      resolvedAipId = resolvedAipId ?? projectScope.aipId;
      resolvedBarangayId = resolvedBarangayId ?? projectScope.scope?.barangayId ?? null;
      resolvedCityId = resolvedCityId ?? projectScope.scope?.cityId ?? null;
    }
  }

  if (resolvedFeedbackId && (!resolvedAipId || !resolvedProjectId || !resolvedBarangayId || !resolvedCityId)) {
    const feedbackContext = await resolveFeedbackContext(admin, resolvedFeedbackId);
    if (feedbackContext) {
      resolvedAipId = resolvedAipId ?? feedbackContext.aipId;
      resolvedProjectId = resolvedProjectId ?? feedbackContext.projectId;
      resolvedBarangayId = resolvedBarangayId ?? feedbackContext.scope?.barangayId ?? null;
      resolvedCityId = resolvedCityId ?? feedbackContext.scope?.cityId ?? null;
    }
  }

  if (resolvedProjectUpdateId && (!resolvedAipId || !resolvedProjectId || !resolvedBarangayId || !resolvedCityId)) {
    const updateContext = await resolveProjectUpdateContext(admin, resolvedProjectUpdateId);
    if (updateContext) {
      resolvedAipId = resolvedAipId ?? updateContext.aipId;
      resolvedProjectId = resolvedProjectId ?? updateContext.projectId;
      resolvedBarangayId = resolvedBarangayId ?? updateContext.scope?.barangayId ?? null;
      resolvedCityId = resolvedCityId ?? updateContext.scope?.cityId ?? null;
    }
  }

  if ((input.eventType === "FEEDBACK_VISIBILITY_CHANGED" || input.eventType === "FEEDBACK_CREATED") && resolvedFeedbackId) {
    const feedbackContext = await resolveFeedbackContext(admin, resolvedFeedbackId);
    if (feedbackContext) {
      resolvedAipId = resolvedAipId ?? feedbackContext.aipId;
      resolvedProjectId = resolvedProjectId ?? feedbackContext.projectId;
      resolvedBarangayId = resolvedBarangayId ?? feedbackContext.scope?.barangayId ?? null;
      resolvedCityId = resolvedCityId ?? feedbackContext.scope?.cityId ?? null;
    }
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
      if (resolvedBarangayId) {
        recipients.push(...(await getBarangayOfficialRecipients(admin, resolvedBarangayId)));
      } else if (resolvedCityId) {
        recipients.push(...(await getCityOfficialRecipients(admin, resolvedCityId)));
      }
      break;
    case "FEEDBACK_VISIBILITY_CHANGED":
      if (resolvedFeedbackId) {
        const feedback = await resolveFeedbackContext(admin, resolvedFeedbackId);
        if (feedback?.authorUserId) {
          const author = await getRecipientByUserId(admin, feedback.authorUserId);
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
  } = await resolveRecipientsForEvent(admin, input);

  if (recipients.length === 0) {
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
  const actionUrl = defaultActionUrl(templateInput);

  const metadata = {
    ...(input.metadata ?? {}),
    actor_user_id: input.actorUserId ?? null,
    actor_role: input.actorRole ?? null,
    actor_name: input.actorName ?? null,
    scope_type: input.scopeType,
    aip_id: resolvedAipId,
    project_id: resolvedProjectId,
    feedback_id: resolvedFeedbackId,
    project_update_id: resolvedProjectUpdateId,
    barangay_id: resolvedBarangayId,
    city_id: resolvedCityId,
    transition,
    reason: input.reason ?? null,
    note: input.note ?? null,
  };

  const preferences = await loadPreferencesByUserId(
    admin,
    recipients.map((recipient) => recipient.userId),
    input.eventType
  );

  const notificationRows: Array<Record<string, unknown>> = [];
  for (const recipient of recipients) {
    const pref = preferences.get(recipient.userId);
    const inAppEnabled = pref?.inAppEnabled ?? true;
    if (!inAppEnabled) continue;

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
    for (const recipient of recipients) {
      const pref = preferences.get(recipient.userId);
      const emailEnabled = pref?.emailEnabled ?? true;
      if (!emailEnabled) continue;

      const toEmail = await resolveRecipientEmail(admin, recipient);
      if (!toEmail) continue;

      emailRows.push({
        recipient_user_id: recipient.userId,
        to_email: toEmail,
        template_key: template.templateKey,
        subject: template.emailSubject,
        payload: {
          title: template.title,
          message: template.message,
          action_url: actionUrl,
          event_type: input.eventType,
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
    recipientCount: recipients.length,
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
