import "server-only";

import type { NextResponse } from "next/server";
import type { SecuritySettingsValue } from "@/lib/settings/app-settings";
import {
  SESSION_LAST_ACTIVITY_COOKIE,
  SESSION_TIMEOUT_COOKIE,
  SESSION_WARNING_COOKIE,
  toTimeoutMs,
  toWarningMs,
} from "@/lib/security/session-timeout";

type CookieMutator = Pick<NextResponse, "cookies">;

function maxAgeSeconds(timeoutMs: number): number {
  return Math.max(60, Math.ceil(timeoutMs / 1000));
}

export function applySessionPolicyCookies(
  response: CookieMutator,
  settings: SecuritySettingsValue,
  lastActivityAtMs = Date.now()
) {
  const timeoutMs = toTimeoutMs(settings.sessionTimeout);
  const warningMs = toWarningMs(settings.sessionTimeout);
  const maxAge = maxAgeSeconds(timeoutMs);

  response.cookies.set(SESSION_TIMEOUT_COOKIE, String(timeoutMs), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge,
  });
  response.cookies.set(SESSION_WARNING_COOKIE, String(warningMs), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge,
  });
  response.cookies.set(SESSION_LAST_ACTIVITY_COOKIE, String(lastActivityAtMs), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge,
  });
}

export function clearSessionPolicyCookies(response: CookieMutator) {
  const options = {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  };
  response.cookies.set(SESSION_TIMEOUT_COOKIE, "", options);
  response.cookies.set(SESSION_WARNING_COOKIE, "", options);
  response.cookies.set(SESSION_LAST_ACTIVITY_COOKIE, "", options);
}

