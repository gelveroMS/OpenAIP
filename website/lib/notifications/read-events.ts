"use client";

export const NOTIFICATION_READ_EVENT = "notifications:read";

type NotificationReadDetail = {
  notificationId?: unknown;
};

function normalizeNotificationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function emitNotificationRead(notificationId: string): void {
  const normalizedId = normalizeNotificationId(notificationId);
  if (!normalizedId || typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<NotificationReadDetail>(NOTIFICATION_READ_EVENT, {
      detail: { notificationId: normalizedId },
    })
  );
}

export function onNotificationRead(handler: (notificationId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<NotificationReadDetail>;
    const normalizedId = normalizeNotificationId(customEvent.detail?.notificationId);
    if (!normalizedId) return;
    handler(normalizedId);
  };

  window.addEventListener(NOTIFICATION_READ_EVENT, listener);
  return () => {
    window.removeEventListener(NOTIFICATION_READ_EVENT, listener);
  };
}
