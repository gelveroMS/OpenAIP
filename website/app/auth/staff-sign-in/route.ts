import { supabaseServer } from "@/lib/supabase/server";
import {
  fail,
  normalizeEmail,
  normalizePassword,
  ok,
} from "@/lib/auth/citizen-auth-route";
import { dbRoleToRouteRole } from "@/lib/auth/route-roles";
import {
  clearLoginAttemptState,
  getRequestFingerprint,
  getLoginAttemptStatus,
  recordLoginFailure,
} from "@/lib/security/login-attempts.server";
import { applySessionPolicyCookies } from "@/lib/security/session-cookies.server";
import { getSecuritySettings } from "@/lib/security/security-settings.server";

type StaffSignInBody = {
  email?: unknown;
  password?: unknown;
  role?: unknown;
};

const LOCKOUT_ERROR_MESSAGE = "Too many failed login attempts. Please try again later.";
const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";

function isStaffRole(value: unknown): value is "admin" | "city" | "barangay" {
  return value === "admin" || value === "city" || value === "barangay";
}

async function safeRecordFailure(input: {
  email: string;
  settings: Awaited<ReturnType<typeof getSecuritySettings>>;
  requestFingerprint: string | null;
}) {
  try {
    return await recordLoginFailure({
      email: input.email,
      settings: input.settings,
      monitoring: {
        route: "staff_sign_in",
        requestFingerprint: input.requestFingerprint,
      },
    });
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as StaffSignInBody | null;
    const email = normalizeEmail(body?.email);
    const password = normalizePassword(body?.password);
    const role = body?.role;
    const requestFingerprint = getRequestFingerprint(request);

    if (!email || !password || !isStaffRole(role)) {
      return fail("A valid role, email, and password are required.", 400);
    }

    const settings = await getSecuritySettings();
    const status = await getLoginAttemptStatus({ email }).catch(() => ({
      isLocked: false,
      failedCount: 0,
      lockedUntil: null,
    }));
    if (status.isLocked) {
      return fail(LOCKOUT_ERROR_MESSAGE, 429);
    }

    const client = await supabaseServer();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      const nextStatus = await safeRecordFailure({
        email,
        settings,
        requestFingerprint,
      });
      return fail(nextStatus?.isLocked ? LOCKOUT_ERROR_MESSAGE : INVALID_CREDENTIALS_MESSAGE, nextStatus?.isLocked ? 429 : 401);
    }

    if (!data.user?.id) {
      await safeRecordFailure({
        email,
        settings,
        requestFingerprint,
      });
      return fail(INVALID_CREDENTIALS_MESSAGE, 401);
    }

    const { data: roleValue, error: roleError } = await client.rpc("current_role");
    if (roleError) {
      await client.auth.signOut();
      return fail("Unable to sign in.", 500);
    }

    const resolvedRole = dbRoleToRouteRole(roleValue);
    if (!resolvedRole) {
      await client.auth.signOut();
      const nextStatus = await safeRecordFailure({
        email,
        settings,
        requestFingerprint,
      });
      return fail(nextStatus?.isLocked ? LOCKOUT_ERROR_MESSAGE : INVALID_CREDENTIALS_MESSAGE, nextStatus?.isLocked ? 429 : 401);
    }
    if (resolvedRole !== role) {
      await client.auth.signOut();
      const nextStatus = await safeRecordFailure({
        email,
        settings,
        requestFingerprint,
      });
      return fail(nextStatus?.isLocked ? LOCKOUT_ERROR_MESSAGE : INVALID_CREDENTIALS_MESSAGE, nextStatus?.isLocked ? 429 : 401);
    }

    await clearLoginAttemptState({ email }).catch(() => undefined);

    const response = ok({ role: resolvedRole });
    applySessionPolicyCookies(response, settings);
    return response;
  } catch {
    return fail("Unable to sign in.", 500);
  }
}
