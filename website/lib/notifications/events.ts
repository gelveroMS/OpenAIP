import type { RoleType } from "@/lib/contracts/databasev2";

export const NOTIFICATION_EVENT_TYPES = [
  "AIP_CLAIMED",
  "AIP_REVISION_REQUESTED",
  "AIP_PUBLISHED",
  "AIP_SUBMITTED",
  "AIP_RESUBMITTED",
  "AIP_EXTRACTION_SUCCEEDED",
  "AIP_EXTRACTION_FAILED",
  "FEEDBACK_CREATED",
  "FEEDBACK_VISIBILITY_CHANGED",
  "PROJECT_UPDATE_STATUS_CHANGED",
  "OUTBOX_FAILURE_THRESHOLD_REACHED",
  "MODERATION_ACTION_AUDIT",
  "PIPELINE_JOB_FAILED",
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export type NotificationScopeType = "barangay" | "city" | "citizen" | "admin";
export type NotificationEntityType = "aip" | "project" | "feedback" | "project_update" | "system";

export type NotifyInput = {
  eventType: NotificationEventType;
  scopeType: NotificationScopeType;
  entityType: NotificationEntityType;
  entityId?: string | null;
  aipId?: string | null;
  projectId?: string | null;
  feedbackId?: string | null;
  projectUpdateId?: string | null;
  barangayId?: string | null;
  cityId?: string | null;
  actorUserId?: string | null;
  actorRole?: RoleType | null;
  actorName?: string | null;
  transition?: string | null;
  note?: string | null;
  reason?: string | null;
  actionUrl?: string | null;
  metadata?: Record<string, unknown>;
  sendEmail?: boolean;
  dedupeBucket?: string | null;
};

export type NotifyResult = {
  recipientCount: number;
  notificationsInserted: number;
  emailsQueued: number;
};
