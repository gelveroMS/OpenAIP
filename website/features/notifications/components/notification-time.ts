"use client";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatNotificationRelativeTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < MINUTE_MS) return "Just now";
  if (diffMs < HOUR_MS) {
    return `${Math.max(1, Math.floor(diffMs / MINUTE_MS))}m`;
  }
  if (diffMs < DAY_MS) {
    return `${Math.max(1, Math.floor(diffMs / HOUR_MS))}h`;
  }
  if (diffMs < DAY_MS * 2) return "Yesterday";
  if (diffMs < DAY_MS * 7) {
    return `${Math.max(1, Math.floor(diffMs / DAY_MS))}d`;
  }

  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: now.getFullYear() === date.getFullYear() ? undefined : "numeric",
  });
}
