import "server-only";

import type { SecuritySettingsValue } from "@/lib/settings/app-settings";
import { getTypedAppSetting } from "@/lib/settings/app-settings";
import { toTimeoutMs, toWarningMs } from "@/lib/security/session-timeout";

export type PublicSecurityPolicyResponse = {
  visibility: "public";
  summary: {
    passwordPolicyEnforced: boolean;
    sessionTimeoutEnabled: boolean;
    lockoutEnabled: boolean;
  };
};

export type StaffSecurityPolicyResponse = {
  visibility: "staff";
  securitySettings: SecuritySettingsValue;
  computed: {
    sessionTimeoutMs: number;
    warningMs: number;
    lockoutDurationMs: number;
  };
};

export type SecurityPolicyResponse = PublicSecurityPolicyResponse | StaffSecurityPolicyResponse;

export async function getSecuritySettings(): Promise<SecuritySettingsValue> {
  return getTypedAppSetting("system.security_settings");
}

export function lockoutDurationMs(input: {
  lockoutDuration: number;
  lockoutUnit: "minutes" | "hours";
}): number {
  const base = Math.max(1, Number(input.lockoutDuration) || 1);
  return input.lockoutUnit === "hours" ? base * 60 * 60 * 1000 : base * 60 * 1000;
}

export function toSecurityPolicyResponse(settings: SecuritySettingsValue): StaffSecurityPolicyResponse {
  return {
    visibility: "staff",
    securitySettings: settings,
    computed: {
      sessionTimeoutMs: toTimeoutMs(settings.sessionTimeout),
      warningMs: toWarningMs(settings.sessionTimeout),
      lockoutDurationMs: lockoutDurationMs(settings.loginAttemptLimits),
    },
  };
}

export function toPublicSecurityPolicyResponse(
  settings: SecuritySettingsValue
): PublicSecurityPolicyResponse {
  return {
    visibility: "public",
    summary: {
      passwordPolicyEnforced: Math.max(1, settings.passwordPolicy.minLength) > 0,
      sessionTimeoutEnabled: Math.max(1, settings.sessionTimeout.timeoutValue) > 0,
      lockoutEnabled:
        Math.max(1, settings.loginAttemptLimits.maxAttempts) > 0 &&
        Math.max(1, settings.loginAttemptLimits.lockoutDuration) > 0,
    },
  };
}

export function validateSecuritySettings(settings: SecuritySettingsValue): string | null {
  if (!Number.isFinite(settings.passwordPolicy.minLength) || settings.passwordPolicy.minLength < 6) {
    return "Password minimum length must be at least 6.";
  }

  if (
    !Number.isFinite(settings.sessionTimeout.timeoutValue) ||
    settings.sessionTimeout.timeoutValue < 1
  ) {
    return "Session timeout value must be at least 1.";
  }

  if (
    !Number.isFinite(settings.sessionTimeout.warningMinutes) ||
    settings.sessionTimeout.warningMinutes < 0
  ) {
    return "Session warning minutes must be 0 or greater.";
  }

  if (
    !Number.isFinite(settings.loginAttemptLimits.maxAttempts) ||
    settings.loginAttemptLimits.maxAttempts < 1
  ) {
    return "Maximum login attempts must be at least 1.";
  }

  if (
    !Number.isFinite(settings.loginAttemptLimits.lockoutDuration) ||
    settings.loginAttemptLimits.lockoutDuration < 1
  ) {
    return "Lockout duration must be at least 1.";
  }

  const timeoutMs = toTimeoutMs(settings.sessionTimeout);
  const warningMs = toWarningMs(settings.sessionTimeout);
  if (warningMs >= timeoutMs) {
    return "Session warning must be lower than total session timeout.";
  }

  return null;
}
