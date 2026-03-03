import type { NotificationEntityType, NotificationEventType } from "./events";

function normalizePart(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.trim().replace(/\s+/g, "_");
  return normalized.length > 0 ? normalized : fallback;
}

export function toHourBucket(input: Date = new Date()): string {
  return input.toISOString().slice(0, 13);
}

export function buildNotificationDedupeKey(input: {
  eventType: NotificationEventType;
  entityType: NotificationEntityType;
  entityId?: string | null;
  transition?: string | null;
  bucket?: string | null;
}): string {
  const entityId = normalizePart(input.entityId, "none");
  const transitionOrBucket = normalizePart(input.transition ?? input.bucket, "event");
  return `${input.eventType}:${input.entityType}:${entityId}:${transitionOrBucket}`;
}
