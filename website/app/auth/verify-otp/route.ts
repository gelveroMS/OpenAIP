import { supabaseServer } from "@/lib/supabase/server";
import {
  fail,
  normalizeEmail,
  normalizeOtpToken,
  ok,
} from "@/lib/auth/citizen-auth-route";
import {
  getCitizenProfileByUserId,
  isCitizenProfileComplete,
} from "@/lib/auth/citizen-profile-completion";
import {
  clearOtpVerifyEmailFailureState,
  getOtpVerifyThrottleStatus,
  recordOtpVerifyFailure,
} from "@/lib/security/login-attempts.server";
import { applySessionPolicyCookies } from "@/lib/security/session-cookies.server";
import { getSecuritySettings } from "@/lib/security/security-settings.server";

type VerifyOtpRequestBody = {
  email?: unknown;
  token?: unknown;
};

const OTP_THROTTLE_MESSAGE = "Too many attempts. Please wait and try again.";
const OTP_FAILURE_MESSAGE = "Invalid or expired verification code. Please try again.";
const OTP_GENERIC_ERROR_MESSAGE = "Unable to verify OTP code.";

async function safeRecordOtpFailure(input: { request: Request; email: string }) {
  try {
    return await recordOtpVerifyFailure({
      request: input.request,
      email: input.email,
    });
  } catch {
    return { isThrottled: false };
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as VerifyOtpRequestBody | null;
    const email = normalizeEmail(payload?.email);
    const token = normalizeOtpToken(payload?.token);

    if (!email || !token) {
      return fail("A valid email and 6-digit OTP code are required.", 400);
    }
    const throttleStatus = await getOtpVerifyThrottleStatus({
      request,
      email,
    }).catch(() => ({ isThrottled: false }));
    if (throttleStatus.isThrottled) {
      return fail(OTP_THROTTLE_MESSAGE, 429);
    }

    const client = await supabaseServer();
    const { error } = await client.auth.verifyOtp({
      email,
      token,
      type: "email",
    });

    if (error) {
      const nextStatus = await safeRecordOtpFailure({
        request,
        email,
      });
      return fail(nextStatus.isThrottled ? OTP_THROTTLE_MESSAGE : OTP_FAILURE_MESSAGE, nextStatus.isThrottled ? 429 : 400);
    }

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user?.id) {
      const nextStatus = await safeRecordOtpFailure({
        request,
        email,
      });
      return fail(nextStatus.isThrottled ? OTP_THROTTLE_MESSAGE : OTP_GENERIC_ERROR_MESSAGE, nextStatus.isThrottled ? 429 : 401);
    }

    const { data: roleValue, error: roleError } = await client.rpc("current_role");
    if (roleError) {
      await client.auth.signOut();
      return fail(OTP_GENERIC_ERROR_MESSAGE, 500);
    }
    if (typeof roleValue === "string" && roleValue !== "citizen") {
      await client.auth.signOut();
      const nextStatus = await safeRecordOtpFailure({
        request,
        email,
      });
      return fail(nextStatus.isThrottled ? OTP_THROTTLE_MESSAGE : OTP_GENERIC_ERROR_MESSAGE, nextStatus.isThrottled ? 429 : 403);
    }

    const profile = await getCitizenProfileByUserId(client, authData.user.id);
    if (profile && profile.role !== "citizen") {
      await client.auth.signOut();
      const nextStatus = await safeRecordOtpFailure({
        request,
        email,
      });
      return fail(nextStatus.isThrottled ? OTP_THROTTLE_MESSAGE : OTP_GENERIC_ERROR_MESSAGE, nextStatus.isThrottled ? 429 : 403);
    }
    await clearOtpVerifyEmailFailureState({ email }).catch(() => undefined);

    const settings = await getSecuritySettings();
    const response = ok({
      next: isCitizenProfileComplete(profile) ? "redirect" : "complete_profile",
    });
    applySessionPolicyCookies(response, settings);
    return response;
  } catch {
    return fail(OTP_GENERIC_ERROR_MESSAGE, 500);
  }
}
