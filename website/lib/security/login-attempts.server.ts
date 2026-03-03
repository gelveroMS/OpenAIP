import "server-only";

import { createHash } from "node:crypto";
import type { LoginAttemptStateEntryValue, LoginAttemptStateValue } from "@/lib/settings/app-settings";
import { getTypedAppSetting, setTypedAppSetting } from "@/lib/settings/app-settings";
import type { SecuritySettingsValue } from "@/lib/settings/app-settings";
import { lockoutDurationMs } from "@/lib/security/security-settings.server";

const POLICY_READ_WINDOW_MS = 10 * 60 * 1000;
const POLICY_READ_WINDOW_MINUTES = 10;
const POLICY_READ_PROBE_THRESHOLD = 5;
const POLICY_READ_CORRELATION_THRESHOLD = 3;
const POLICY_WARN_COOLDOWN_MS = 60 * 1000;
const POLICY_MONITOR_MAX_KEYS = 2048;

const policyReadsByFingerprint = new Map<string, number[]>();
const policyReadProbeWarnedAt = new Map<string, number>();
const failedLoginCorrelationWarnedAt = new Map<string, number>();

type LoginAttemptStatus = {
  isLocked: boolean;
  failedCount: number;
  lockedUntil: string | null;
};

type LoginFailureRoute = "citizen_sign_in" | "staff_sign_in";

type LoginFailureMonitoringContext = {
  route: LoginFailureRoute;
  requestFingerprint?: string | null;
};

function normalizeHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function firstForwardedAddress(value: string | null): string | null {
  if (!value) return null;
  const [first] = value.split(",");
  return normalizeHeaderValue(first ?? null);
}

export function getRequestFingerprint(request: Request): string | null {
  const cfConnectingIp = normalizeHeaderValue(request.headers.get("cf-connecting-ip"));
  if (cfConnectingIp) return cfConnectingIp;

  const xRealIp = normalizeHeaderValue(request.headers.get("x-real-ip"));
  if (xRealIp) return xRealIp;

  const xForwardedFor = firstForwardedAddress(request.headers.get("x-forwarded-for"));
  if (xForwardedFor) return xForwardedFor;

  const xClientIp = normalizeHeaderValue(request.headers.get("x-client-ip"));
  if (xClientIp) return xClientIp;

  return null;
}

function hashFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function pruneWindowValues(values: number[], nowMs: number): number[] {
  const cutoff = nowMs - POLICY_READ_WINDOW_MS;
  return values.filter((timestampMs) => timestampMs >= cutoff);
}

function pruneRollingWindowStore(store: Map<string, number[]>, nowMs: number): void {
  for (const [key, values] of store.entries()) {
    const pruned = pruneWindowValues(values, nowMs);
    if (pruned.length === 0) {
      store.delete(key);
      continue;
    }
    if (pruned.length !== values.length) {
      store.set(key, pruned);
    }
  }

  if (store.size <= POLICY_MONITOR_MAX_KEYS) return;
  const oldestKeys = [...store.entries()]
    .sort((a, b) => (a[1][a[1].length - 1] ?? 0) - (b[1][b[1].length - 1] ?? 0))
    .slice(0, store.size - POLICY_MONITOR_MAX_KEYS)
    .map(([key]) => key);
  for (const key of oldestKeys) {
    store.delete(key);
  }
}

function countRollingWindow(store: Map<string, number[]>, key: string, nowMs: number): number {
  const values = store.get(key);
  if (!values) return 0;
  const pruned = pruneWindowValues(values, nowMs);
  if (pruned.length === 0) {
    store.delete(key);
    return 0;
  }
  if (pruned.length !== values.length) {
    store.set(key, pruned);
  }
  return pruned.length;
}

function trackRollingWindowEvent(store: Map<string, number[]>, key: string, nowMs: number): number {
  const values = store.get(key) ?? [];
  const pruned = pruneWindowValues(values, nowMs);
  pruned.push(nowMs);
  store.set(key, pruned);
  pruneRollingWindowStore(store, nowMs);
  return pruned.length;
}

function shouldEmitWarning(store: Map<string, number>, key: string, nowMs: number): boolean {
  for (const [trackedKey, warnedAtMs] of store.entries()) {
    if (nowMs - warnedAtMs > POLICY_WARN_COOLDOWN_MS) {
      store.delete(trackedKey);
    }
  }

  const lastWarnedAtMs = store.get(key);
  if (typeof lastWarnedAtMs === "number" && nowMs - lastWarnedAtMs <= POLICY_WARN_COOLDOWN_MS) {
    return false;
  }

  store.set(key, nowMs);
  return true;
}

export function monitorSecurityPolicyRead(input: {
  request: Request;
  audience: "anon" | "citizen" | "staff";
}): void {
  try {
    const fingerprint = getRequestFingerprint(input.request);
    if (!fingerprint) return;

    const nowMs = Date.now();
    const fingerprintHash = hashFingerprint(fingerprint);
    const readCount = trackRollingWindowEvent(policyReadsByFingerprint, fingerprintHash, nowMs);
    if (
      readCount >= POLICY_READ_PROBE_THRESHOLD &&
      shouldEmitWarning(policyReadProbeWarnedAt, fingerprintHash, nowMs)
    ) {
      console.warn("security_policy_read_probe", {
        fingerprint: fingerprintHash,
        audience: input.audience,
        readCount,
        windowMinutes: POLICY_READ_WINDOW_MINUTES,
      });
    }
  } catch {
    // Best-effort monitoring only.
  }
}

function monitorFailedLoginAfterPolicyRead(input: {
  monitoring: LoginFailureMonitoringContext | undefined;
  status: LoginAttemptStatus;
}): void {
  try {
    if (!input.monitoring?.requestFingerprint) return;
    const normalizedFingerprint = normalizeHeaderValue(input.monitoring.requestFingerprint);
    if (!normalizedFingerprint) return;

    const nowMs = Date.now();
    const fingerprintHash = hashFingerprint(normalizedFingerprint);
    const recentPolicyReadCount = countRollingWindow(policyReadsByFingerprint, fingerprintHash, nowMs);
    if (
      recentPolicyReadCount >= POLICY_READ_CORRELATION_THRESHOLD &&
      shouldEmitWarning(failedLoginCorrelationWarnedAt, fingerprintHash, nowMs)
    ) {
      console.warn("failed_login_after_policy_probe", {
        fingerprint: fingerprintHash,
        route: input.monitoring.route,
        policyReadCount: recentPolicyReadCount,
        windowMinutes: POLICY_READ_WINDOW_MINUTES,
        isLocked: input.status.isLocked,
      });
    }
  } catch {
    // Best-effort monitoring only.
  }
}

function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

function nowIso(): string {
  return new Date().toISOString();
}

function isFutureIso(value: string | null, nowMs: number): boolean {
  if (!value) return false;
  const target = new Date(value).getTime();
  return Number.isFinite(target) && target > nowMs;
}

function isValidEntry(entry: LoginAttemptStateEntryValue | undefined): entry is LoginAttemptStateEntryValue {
  return Boolean(
    entry &&
      Number.isFinite(entry.failedCount) &&
      entry.failedCount >= 0 &&
      typeof entry.updatedAt === "string"
  );
}

function pruneState(state: LoginAttemptStateValue, nowMs: number): LoginAttemptStateValue {
  const next: LoginAttemptStateValue = {};
  for (const [key, entry] of Object.entries(state)) {
    if (!isValidEntry(entry)) continue;
    if (entry.failedCount <= 0 && !isFutureIso(entry.lockedUntil, nowMs)) continue;
    next[key] = entry;
  }
  return next;
}

function withEntry(
  state: LoginAttemptStateValue,
  emailKey: string,
  updater: (current: LoginAttemptStateEntryValue | null) => LoginAttemptStateEntryValue | null
): LoginAttemptStateValue {
  const current = isValidEntry(state[emailKey]) ? state[emailKey] : null;
  const updated = updater(current);
  const next = { ...state };
  if (!updated) {
    delete next[emailKey];
    return next;
  }
  next[emailKey] = updated;
  return next;
}

export async function getLoginAttemptStatus(input: {
  email: string;
}): Promise<LoginAttemptStatus> {
  const key = normalizeEmailKey(input.email);
  if (!key) return { isLocked: false, failedCount: 0, lockedUntil: null };

  const nowMs = Date.now();
  const state = await getTypedAppSetting("system.login_attempt_state");
  const pruned = pruneState(state, nowMs);
  if (Object.keys(pruned).length !== Object.keys(state).length) {
    await setTypedAppSetting("system.login_attempt_state", pruned).catch(() => undefined);
  }

  const entry = pruned[key];
  if (!entry) return { isLocked: false, failedCount: 0, lockedUntil: null };
  const isLocked = isFutureIso(entry.lockedUntil, nowMs);
  return {
    isLocked,
    failedCount: Math.max(0, entry.failedCount),
    lockedUntil: isLocked ? entry.lockedUntil : null,
  };
}

export async function clearLoginAttemptState(input: { email: string }): Promise<void> {
  const key = normalizeEmailKey(input.email);
  if (!key) return;
  const state = await getTypedAppSetting("system.login_attempt_state");
  if (!(key in state)) return;
  const next = withEntry(state, key, () => null);
  await setTypedAppSetting("system.login_attempt_state", next);
}

export async function recordLoginFailure(input: {
  email: string;
  settings: SecuritySettingsValue;
  monitoring?: LoginFailureMonitoringContext;
}): Promise<LoginAttemptStatus> {
  const key = normalizeEmailKey(input.email);
  if (!key) return { isLocked: false, failedCount: 0, lockedUntil: null };

  const nowMs = Date.now();
  const now = nowIso();
  const maxAttempts = Math.max(1, input.settings.loginAttemptLimits.maxAttempts);
  const lockMs = lockoutDurationMs(input.settings.loginAttemptLimits);
  const currentState = await getTypedAppSetting("system.login_attempt_state");
  const state = pruneState(currentState, nowMs);

  const nextState = withEntry(state, key, (current) => {
    if (current && isFutureIso(current.lockedUntil, nowMs)) {
      return {
        ...current,
        updatedAt: now,
        lastFailedAt: now,
      };
    }

    const failedCount = (current?.failedCount ?? 0) + 1;
    const shouldLock = failedCount >= maxAttempts;
    return {
      failedCount: shouldLock ? 0 : failedCount,
      firstFailedAt: current?.firstFailedAt ?? now,
      lastFailedAt: now,
      lockedUntil: shouldLock ? new Date(nowMs + lockMs).toISOString() : null,
      updatedAt: now,
    };
  });

  await setTypedAppSetting("system.login_attempt_state", nextState);
  const updated = nextState[key];
  if (!updated) return { isLocked: false, failedCount: 0, lockedUntil: null };

  const isLocked = isFutureIso(updated.lockedUntil, nowMs);
  const status = {
    isLocked,
    failedCount: Math.max(0, updated.failedCount),
    lockedUntil: isLocked ? updated.lockedUntil : null,
  };
  monitorFailedLoginAfterPolicyRead({
    monitoring: input.monitoring,
    status,
  });
  return status;
}
