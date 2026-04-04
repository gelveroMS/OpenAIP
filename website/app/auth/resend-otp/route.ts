import { supabaseServer } from "@/lib/supabase/server";
import {
  fail,
  normalizeEmail,
  ok,
  toSiteUrl,
} from "@/lib/auth/citizen-auth-route";
import {
  consumeOtpResendThrottle,
  monitorAuthProviderCallSuppressed,
} from "@/lib/security/login-attempts.server";

type ResendOtpRequestBody = {
  email?: unknown;
};

const OTP_THROTTLE_MESSAGE = "Too many attempts. Please wait and try again.";
const OTP_RESEND_FAILURE_MESSAGE = "Unable to process request right now. Please try again later.";

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as ResendOtpRequestBody | null;
    const email = normalizeEmail(payload?.email);

    if (!email) {
      return fail("A valid email is required.", 400);
    }
    const throttleStatus = await consumeOtpResendThrottle({
      request,
      email,
    }).catch(() => ({ isThrottled: false }));
    if (throttleStatus.isThrottled) {
      monitorAuthProviderCallSuppressed({
        flow: "otp_resend",
        request,
        email,
        reason: "throttled",
      });
      return fail(OTP_THROTTLE_MESSAGE, 429);
    }

    const client = await supabaseServer();
    const { error } = await client.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${toSiteUrl(request)}/confirm`,
      },
    });

    if (error) {
      monitorAuthProviderCallSuppressed({
        flow: "otp_resend",
        request,
        email,
        reason: "provider_error",
      });
      const normalizedError = error.message.toLowerCase();
      const isRateLimited =
        normalizedError.includes("rate limit") ||
        normalizedError.includes("too many requests") ||
        normalizedError.includes("request this after");
      return fail(isRateLimited ? OTP_THROTTLE_MESSAGE : OTP_RESEND_FAILURE_MESSAGE, isRateLimited ? 429 : 400);
    }

    return ok({
      message: "If your account is pending confirmation, a new verification code will be sent.",
    });
  } catch {
    return fail(OTP_RESEND_FAILURE_MESSAGE, 500);
  }
}
