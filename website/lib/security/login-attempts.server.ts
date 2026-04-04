import "server-only";

import { createHash } from "node:crypto";
import type {
  AuthThrottleStateEntryValue,
  AuthThrottleStateValue,
  LoginAttemptStateEntryValue,
  LoginAttemptStateValue,
  SecuritySettingsValue,
} from "@/lib/settings/app-settings";
import { getTypedAppSetting, setTypedAppSetting } from "@/lib/settings/app-settings";
import { lockoutDurationMs } from "@/lib/security/security-settings.server";

const POLICY_READ_WINDOW_MS = 10 * 60 * 1000;
const POLICY_READ_WINDOW_MINUTES = 10;
const POLICY_READ_PROBE_THRESHOLD = 5;
const POLICY_READ_CORRELATION_THRESHOLD = 3;
const POLICY_WARN_COOLDOWN_MS = 60 * 1000;
const POLICY_MONITOR_MAX_KEYS = 2048;

const AUTH_THROTTLE_MAX_KEYS = 4096;
const AUTH_THROTTLE_STALE_MS = 24 * 60 * 60 * 1000;
const AUTH_THROTTLE_MAX_EVENTS_PER_KEY = 128;
const AUTH_THROTTLE_FUTURE_SKEW_MS = 60 * 1000;

const LOGIN_SOURCE_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_SOURCE_MAX_LOCK_MS = 10 * 60 * 1000;

const OTP_VERIFY_WINDOW_MS = 15 * 60 * 1000;
const OTP_VERIFY_LOCK_MS = 15 * 60 * 1000;
const OTP_VERIFY_EMAIL_THRESHOLD = 6;
const OTP_VERIFY_SOURCE_THRESHOLD = 20;

const OTP_RESEND_WINDOW_MS = 10 * 60 * 1000;
const OTP_RESEND_EMAIL_LIMIT = 3;
const OTP_RESEND_SOURCE_LIMIT = 10;

const FORGOT_PASSWORD_WINDOW_MS = 15 * 60 * 1000;
const FORGOT_PASSWORD_EMAIL_LIMIT = 3;
const FORGOT_PASSWORD_SOURCE_LIMIT = 10;

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

type AuthThrottleFlow = "password_login" | "otp_verify" | "otp_resend" | "forgot_password";

type AuthThrottleResult = {
  isThrottled: boolean;
};

type FailureThrottlePolicy = {
  flow: AuthThrottleFlow;
  scope: "email" | "source";
  key: string;
  windowMs: number;
  threshold: number;
  lockMs: number;
};

type RateThrottlePolicy = {
  flow: AuthThrottleFlow;
  scope: "email" | "source";
  key: string;
  windowMs: number;
  maxEvents: number;
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

function hashEmail(value: string): string {
  return hashFingerprint(`email:${normalizeEmailKey(value)}`);
}

function hashedSourceFromRequest(request: Request): string {
  const networkFingerprint = normalizeHeaderValue(getRequestFingerprint(request)) ?? "none";
  const userAgent = normalizeHeaderValue(request.headers.get("user-agent")) ?? "none";
  const acceptLanguage = normalizeHeaderValue(request.headers.get("accept-language")) ?? "none";

  return hashFingerprint(
    `network:${networkFingerprint.slice(0, 128)}|ua:${userAgent.slice(0, 256)}|lang:${acceptLanguage.slice(0, 128)}`
  );
}

function loginSourceFailureKey(request: Request): string {
  return `password_login:source:${hashedSourceFromRequest(request)}`;
}

function otpVerifyEmailFailureKey(email: string): string {
  return `otp_verify:email:${hashEmail(email)}`;
}

function otpVerifySourceFailureKey(request: Request): string {
  return `otp_verify:source:${hashedSourceFromRequest(request)}`;
}

function otpResendEmailRateKey(email: string): string {
  return `otp_resend:email:${hashEmail(email)}`;
}

function otpResendSourceRateKey(request: Request): string {
  return `otp_resend:source:${hashedSourceFromRequest(request)}`;
}

function forgotPasswordEmailRateKey(email: string): string {
  return `forgot_password:email:${hashEmail(email)}`;
}

function forgotPasswordSourceRateKey(request: Request): string {
  return `forgot_password:source:${hashedSourceFromRequest(request)}`;
}

function emitAuthThrottleTelemetry(input: {
  event: "auth_throttle_triggered" | "auth_throttle_locked" | "auth_provider_call_suppressed";
  flow: AuthThrottleFlow;
  scopes: Array<"email" | "source">;
  keys: string[];
  reason: "precheck" | "failure_recorded" | "rate_limit" | "throttled" | "provider_error";
}): void {
  try {
    console.warn(input.event, {
      flow: input.flow,
      scopes: input.scopes,
      keys: input.keys,
      reason: input.reason,
    });
  } catch {
    // Best-effort monitoring only.
  }
}

export function monitorAuthProviderCallSuppressed(input: {
  flow: "otp_resend" | "forgot_password";
  request: Request;
  email: string;
  reason: "throttled" | "provider_error";
}): void {
  const keys =
    input.flow === "otp_resend"
      ? [otpResendEmailRateKey(input.email), otpResendSourceRateKey(input.request)]
      : [forgotPasswordEmailRateKey(input.email), forgotPasswordSourceRateKey(input.request)];
  emitAuthThrottleTelemetry({
    event: "auth_provider_call_suppressed",
    flow: input.flow,
    scopes: ["email", "source"],
    keys,
    reason: input.reason,
  });
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

function isValidAuthThrottleEntry(
  entry: AuthThrottleStateEntryValue | undefined
): entry is AuthThrottleStateEntryValue {
  return Boolean(
    entry &&
      Array.isArray(entry.events) &&
      entry.events.every((value) => Number.isFinite(value)) &&
      (entry.lockedUntil === null || Number.isFinite(entry.lockedUntil)) &&
      Number.isFinite(entry.updatedAt)
  );
}

function capEvents(values: number[]): number[] {
  if (values.length <= AUTH_THROTTLE_MAX_EVENTS_PER_KEY) return values;
  return values.slice(values.length - AUTH_THROTTLE_MAX_EVENTS_PER_KEY);
}

function normalizeEvents(values: number[], nowMs: number, windowMs: number): number[] {
  const cutoff = nowMs - Math.max(1, windowMs);
  const normalized = values
    .filter(
      (value) =>
        Number.isFinite(value) && value >= cutoff && value <= nowMs + AUTH_THROTTLE_FUTURE_SKEW_MS
    )
    .sort((a, b) => a - b);
  return capEvents(normalized);
}

function pruneAuthThrottleState(input: {
  state: AuthThrottleStateValue;
  nowMs: number;
}): { state: AuthThrottleStateValue; didPrune: boolean } {
  const staleCutoff = input.nowMs - AUTH_THROTTLE_STALE_MS;
  const next: AuthThrottleStateValue = {};
  let didPrune = false;

  for (const [key, value] of Object.entries(input.state)) {
    if (!isValidAuthThrottleEntry(value)) {
      didPrune = true;
      continue;
    }

    const events = capEvents(
      value.events
        .filter(
          (eventMs) =>
            Number.isFinite(eventMs) &&
            eventMs >= staleCutoff &&
            eventMs <= input.nowMs + AUTH_THROTTLE_FUTURE_SKEW_MS
        )
        .sort((a, b) => a - b)
    );

    const lockedUntil =
      typeof value.lockedUntil === "number" && value.lockedUntil > input.nowMs
        ? value.lockedUntil
        : null;
    const updatedAt = Number.isFinite(value.updatedAt)
      ? value.updatedAt
      : events[events.length - 1] ?? input.nowMs;

    if (events.length === 0 && !lockedUntil && updatedAt < staleCutoff) {
      didPrune = true;
      continue;
    }

    next[key] = {
      events,
      lockedUntil,
      updatedAt,
    };

    if (
      !didPrune &&
      (events.length !== value.events.length ||
        lockedUntil !== value.lockedUntil ||
        updatedAt !== value.updatedAt)
    ) {
      didPrune = true;
    }
  }

  if (Object.keys(next).length > AUTH_THROTTLE_MAX_KEYS) {
    const keysToDrop = Object.entries(next)
      .sort((a, b) => (a[1].updatedAt ?? 0) - (b[1].updatedAt ?? 0))
      .slice(0, Object.keys(next).length - AUTH_THROTTLE_MAX_KEYS)
      .map(([key]) => key);

    for (const key of keysToDrop) {
      delete next[key];
    }
    didPrune = true;
  }

  return { state: next, didPrune };
}

async function getAuthThrottleState(nowMs: number): Promise<AuthThrottleStateValue> {
  const state = await getTypedAppSetting("system.auth_throttle_state");
  const { state: pruned, didPrune } = pruneAuthThrottleState({ state, nowMs });
  if (didPrune) {
    await setTypedAppSetting("system.auth_throttle_state", pruned).catch(() => undefined);
  }
  return pruned;
}

async function setAuthThrottleState(input: {
  state: AuthThrottleStateValue;
  nowMs: number;
}): Promise<void> {
  const { state } = pruneAuthThrottleState({
    state: input.state,
    nowMs: input.nowMs,
  });
  await setTypedAppSetting("system.auth_throttle_state", state);
}

function getFailureThresholdFromSettings(settings: SecuritySettingsValue): number {
  return Math.max(12, Math.max(1, settings.loginAttemptLimits.maxAttempts) * 2);
}

function getFailureLockMsFromSettings(settings: SecuritySettingsValue): number {
  return Math.min(LOGIN_SOURCE_MAX_LOCK_MS, lockoutDurationMs(settings.loginAttemptLimits));
}

function isPolicyLocked(
  state: AuthThrottleStateValue,
  policy: Pick<FailureThrottlePolicy, "key">,
  nowMs: number
): boolean {
  const entry = state[policy.key];
  if (!isValidAuthThrottleEntry(entry)) return false;
  if (typeof entry.lockedUntil !== "number") return false;
  return entry.lockedUntil > nowMs;
}

async function getFailureThrottleStatus(input: {
  flow: AuthThrottleFlow;
  policies: FailureThrottlePolicy[];
}): Promise<AuthThrottleResult> {
  const nowMs = Date.now();
  const state = await getAuthThrottleState(nowMs);
  const triggered = input.policies.filter((policy) => isPolicyLocked(state, policy, nowMs));
  if (triggered.length > 0) {
    emitAuthThrottleTelemetry({
      event: "auth_throttle_triggered",
      flow: input.flow,
      scopes: triggered.map((policy) => policy.scope),
      keys: triggered.map((policy) => policy.key),
      reason: "precheck",
    });
  }
  return { isThrottled: triggered.length > 0 };
}

async function recordFailureThrottle(input: {
  flow: AuthThrottleFlow;
  policies: FailureThrottlePolicy[];
}): Promise<AuthThrottleResult> {
  const nowMs = Date.now();
  const state = await getAuthThrottleState(nowMs);
  const triggered = new Set<string>();
  const locked = new Set<string>();

  for (const policy of input.policies) {
    const current = state[policy.key];
    const next = isValidAuthThrottleEntry(current)
      ? {
          events: [...current.events],
          lockedUntil: current.lockedUntil,
          updatedAt: current.updatedAt,
        }
      : { events: [], lockedUntil: null, updatedAt: nowMs };

    next.events = normalizeEvents(next.events, nowMs, policy.windowMs);

    const isCurrentlyLocked =
      typeof next.lockedUntil === "number" && next.lockedUntil > nowMs;
    if (!isCurrentlyLocked) {
      next.lockedUntil = null;
      next.events.push(nowMs);
      next.events = capEvents(next.events);
      if (next.events.length >= policy.threshold) {
        next.lockedUntil = nowMs + policy.lockMs;
        next.events = [];
        locked.add(policy.key);
      }
    }

    next.updatedAt = nowMs;
    state[policy.key] = next;

    if (typeof next.lockedUntil === "number" && next.lockedUntil > nowMs) {
      triggered.add(policy.key);
    }
  }

  await setAuthThrottleState({ state, nowMs });

  if (locked.size > 0) {
    const keys = [...locked];
    emitAuthThrottleTelemetry({
      event: "auth_throttle_locked",
      flow: input.flow,
      scopes: input.policies
        .filter((policy) => locked.has(policy.key))
        .map((policy) => policy.scope),
      keys,
      reason: "failure_recorded",
    });
  }

  return { isThrottled: triggered.size > 0 };
}

async function consumeRateThrottle(input: {
  flow: AuthThrottleFlow;
  policies: RateThrottlePolicy[];
}): Promise<AuthThrottleResult> {
  const nowMs = Date.now();
  const state = await getAuthThrottleState(nowMs);
  const blockedPolicies: RateThrottlePolicy[] = [];

  for (const policy of input.policies) {
    const current = state[policy.key];
    const events = normalizeEvents(
      isValidAuthThrottleEntry(current) ? current.events : [],
      nowMs,
      policy.windowMs
    );
    if (events.length >= policy.maxEvents) {
      blockedPolicies.push(policy);
    }
  }

  for (const policy of input.policies) {
    const current = state[policy.key];
    const next = isValidAuthThrottleEntry(current)
      ? {
          events: [...current.events],
          lockedUntil: null,
          updatedAt: current.updatedAt,
        }
      : { events: [], lockedUntil: null, updatedAt: nowMs };
    next.events = normalizeEvents(next.events, nowMs, policy.windowMs);
    if (blockedPolicies.length === 0) {
      next.events.push(nowMs);
      next.events = capEvents(next.events);
    }
    next.lockedUntil = null;
    next.updatedAt = nowMs;
    state[policy.key] = next;
  }

  await setAuthThrottleState({ state, nowMs });

  if (blockedPolicies.length > 0) {
    emitAuthThrottleTelemetry({
      event: "auth_throttle_triggered",
      flow: input.flow,
      scopes: blockedPolicies.map((policy) => policy.scope),
      keys: blockedPolicies.map((policy) => policy.key),
      reason: "rate_limit",
    });
    return { isThrottled: true };
  }

  return { isThrottled: false };
}

async function clearThrottleKey(input: { key: string }): Promise<void> {
  const nowMs = Date.now();
  const state = await getAuthThrottleState(nowMs);
  if (!(input.key in state)) return;
  const nextState = { ...state };
  delete nextState[input.key];
  await setAuthThrottleState({
    state: nextState,
    nowMs,
  });
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

export async function getPasswordLoginSourceThrottleStatus(input: {
  request: Request;
  settings: SecuritySettingsValue;
}): Promise<AuthThrottleResult> {
  return getFailureThrottleStatus({
    flow: "password_login",
    policies: [
      {
        flow: "password_login",
        scope: "source",
        key: loginSourceFailureKey(input.request),
        windowMs: LOGIN_SOURCE_WINDOW_MS,
        threshold: getFailureThresholdFromSettings(input.settings),
        lockMs: getFailureLockMsFromSettings(input.settings),
      },
    ],
  });
}

export async function recordPasswordLoginSourceFailure(input: {
  request: Request;
  settings: SecuritySettingsValue;
}): Promise<AuthThrottleResult> {
  return recordFailureThrottle({
    flow: "password_login",
    policies: [
      {
        flow: "password_login",
        scope: "source",
        key: loginSourceFailureKey(input.request),
        windowMs: LOGIN_SOURCE_WINDOW_MS,
        threshold: getFailureThresholdFromSettings(input.settings),
        lockMs: getFailureLockMsFromSettings(input.settings),
      },
    ],
  });
}

export async function getOtpVerifyThrottleStatus(input: {
  request: Request;
  email: string;
}): Promise<AuthThrottleResult> {
  const emailKey = normalizeEmailKey(input.email);
  if (!emailKey) return { isThrottled: false };

  return getFailureThrottleStatus({
    flow: "otp_verify",
    policies: [
      {
        flow: "otp_verify",
        scope: "email",
        key: otpVerifyEmailFailureKey(emailKey),
        windowMs: OTP_VERIFY_WINDOW_MS,
        threshold: OTP_VERIFY_EMAIL_THRESHOLD,
        lockMs: OTP_VERIFY_LOCK_MS,
      },
      {
        flow: "otp_verify",
        scope: "source",
        key: otpVerifySourceFailureKey(input.request),
        windowMs: OTP_VERIFY_WINDOW_MS,
        threshold: OTP_VERIFY_SOURCE_THRESHOLD,
        lockMs: OTP_VERIFY_LOCK_MS,
      },
    ],
  });
}

export async function recordOtpVerifyFailure(input: {
  request: Request;
  email: string;
}): Promise<AuthThrottleResult> {
  const emailKey = normalizeEmailKey(input.email);
  if (!emailKey) return { isThrottled: false };

  return recordFailureThrottle({
    flow: "otp_verify",
    policies: [
      {
        flow: "otp_verify",
        scope: "email",
        key: otpVerifyEmailFailureKey(emailKey),
        windowMs: OTP_VERIFY_WINDOW_MS,
        threshold: OTP_VERIFY_EMAIL_THRESHOLD,
        lockMs: OTP_VERIFY_LOCK_MS,
      },
      {
        flow: "otp_verify",
        scope: "source",
        key: otpVerifySourceFailureKey(input.request),
        windowMs: OTP_VERIFY_WINDOW_MS,
        threshold: OTP_VERIFY_SOURCE_THRESHOLD,
        lockMs: OTP_VERIFY_LOCK_MS,
      },
    ],
  });
}

export async function clearOtpVerifyEmailFailureState(input: { email: string }): Promise<void> {
  const emailKey = normalizeEmailKey(input.email);
  if (!emailKey) return;
  await clearThrottleKey({
    key: otpVerifyEmailFailureKey(emailKey),
  });
}

export async function consumeOtpResendThrottle(input: {
  request: Request;
  email: string;
}): Promise<AuthThrottleResult> {
  const emailKey = normalizeEmailKey(input.email);
  if (!emailKey) return { isThrottled: false };

  return consumeRateThrottle({
    flow: "otp_resend",
    policies: [
      {
        flow: "otp_resend",
        scope: "email",
        key: otpResendEmailRateKey(emailKey),
        windowMs: OTP_RESEND_WINDOW_MS,
        maxEvents: OTP_RESEND_EMAIL_LIMIT,
      },
      {
        flow: "otp_resend",
        scope: "source",
        key: otpResendSourceRateKey(input.request),
        windowMs: OTP_RESEND_WINDOW_MS,
        maxEvents: OTP_RESEND_SOURCE_LIMIT,
      },
    ],
  });
}

export async function consumeForgotPasswordThrottle(input: {
  request: Request;
  email: string;
}): Promise<AuthThrottleResult> {
  const emailKey = normalizeEmailKey(input.email);
  if (!emailKey) return { isThrottled: false };

  return consumeRateThrottle({
    flow: "forgot_password",
    policies: [
      {
        flow: "forgot_password",
        scope: "email",
        key: forgotPasswordEmailRateKey(emailKey),
        windowMs: FORGOT_PASSWORD_WINDOW_MS,
        maxEvents: FORGOT_PASSWORD_EMAIL_LIMIT,
      },
      {
        flow: "forgot_password",
        scope: "source",
        key: forgotPasswordSourceRateKey(input.request),
        windowMs: FORGOT_PASSWORD_WINDOW_MS,
        maxEvents: FORGOT_PASSWORD_SOURCE_LIMIT,
      },
    ],
  });
}
