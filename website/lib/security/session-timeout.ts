export type SessionTimeoutLike = {
  timeoutValue: number;
  timeUnit: "minutes" | "hours" | "days";
  warningMinutes: number;
};

export const SESSION_TIMEOUT_COOKIE = "oa_session_timeout_ms";
export const SESSION_WARNING_COOKIE = "oa_session_warning_ms";
export const SESSION_LAST_ACTIVITY_COOKIE = "oa_last_activity_at";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function toTimeoutMs(policy: SessionTimeoutLike): number {
  const value = Math.max(1, Number(policy.timeoutValue) || 1);
  if (policy.timeUnit === "hours") return value * HOUR_MS;
  if (policy.timeUnit === "days") return value * DAY_MS;
  return value * MINUTE_MS;
}

export function toWarningMs(policy: SessionTimeoutLike): number {
  const timeoutMs = toTimeoutMs(policy);
  const warningMs = Math.max(0, Number(policy.warningMinutes) || 0) * MINUTE_MS;
  return Math.min(warningMs, Math.max(timeoutMs - MINUTE_MS, 0));
}

export function parseNumericCookie(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

