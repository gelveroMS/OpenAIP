import { supabaseServer } from "@/lib/supabase/server";
import {
  fail,
  normalizeEmail,
  normalizePassword,
  ok,
} from "@/lib/auth/citizen-auth-route";
import {
  getCitizenProfileByUserId,
  isCitizenProfileComplete,
} from "@/lib/auth/citizen-profile-completion";
import {
  clearLoginAttemptState,
  getRequestFingerprint,
  getLoginAttemptStatus,
  recordLoginFailure,
} from "@/lib/security/login-attempts.server";
import { applySessionPolicyCookies } from "@/lib/security/session-cookies.server";
import { getSecuritySettings } from "@/lib/security/security-settings.server";

type SignInRequestBody = {
  email?: unknown;
  password?: unknown;
};

const LOCKOUT_ERROR_MESSAGE = "Too many failed login attempts. Please try again later.";
const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";

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
        route: "citizen_sign_in",
        requestFingerprint: input.requestFingerprint,
      },
    });
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as SignInRequestBody | null;
    const email = normalizeEmail(payload?.email);
    const password = normalizePassword(payload?.password);
    const requestFingerprint = getRequestFingerprint(request);

    if (!email || !password) {
      return fail("A valid email and password are required.", 400);
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
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const nextStatus = await safeRecordFailure({
        email,
        settings,
        requestFingerprint,
      });
      return fail(nextStatus?.isLocked ? LOCKOUT_ERROR_MESSAGE : INVALID_CREDENTIALS_MESSAGE, nextStatus?.isLocked ? 429 : 401);
    }

    const userId = data.user?.id;
    if (!userId) {
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
    if (typeof roleValue === "string" && roleValue !== "citizen") {
      await client.auth.signOut();
      const nextStatus = await safeRecordFailure({
        email,
        settings,
        requestFingerprint,
      });
      return fail(nextStatus?.isLocked ? LOCKOUT_ERROR_MESSAGE : INVALID_CREDENTIALS_MESSAGE, nextStatus?.isLocked ? 429 : 401);
    }

    const profile = await getCitizenProfileByUserId(client, userId);
    if (profile && profile.role !== "citizen") {
      await client.auth.signOut();
      const nextStatus = await safeRecordFailure({
        email,
        settings,
        requestFingerprint,
      });
      return fail(nextStatus?.isLocked ? LOCKOUT_ERROR_MESSAGE : INVALID_CREDENTIALS_MESSAGE, nextStatus?.isLocked ? 429 : 401);
    }

    await clearLoginAttemptState({ email }).catch(() => undefined);

    const response = ok({
      next: isCitizenProfileComplete(profile) ? "redirect" : "complete_profile",
    });
    applySessionPolicyCookies(response, settings);
    return response;
  } catch {
    return fail("Unable to sign in.", 500);
  }
}
