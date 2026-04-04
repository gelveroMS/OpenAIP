import { supabaseServer } from "@/lib/supabase/server";
import { fail, normalizeEmail, ok, toSiteUrl } from "@/lib/auth/citizen-auth-route";
import {
  consumeForgotPasswordThrottle,
  monitorAuthProviderCallSuppressed,
} from "@/lib/security/login-attempts.server";

type ForgotPasswordRequestBody = {
  email?: unknown;
  role?: unknown;
};

const FORGOT_PASSWORD_SUCCESS_MESSAGE =
  "If an account exists for that email, password reset instructions will be sent.";

function normalizeRole(value: unknown): "citizen" | "admin" | "city" | "barangay" | "municipality" | null {
  if (value === undefined || value === null || value === "") {
    return "citizen";
  }
  if (
    value === "citizen" ||
    value === "admin" ||
    value === "city" ||
    value === "barangay" ||
    value === "municipality"
  ) {
    return value;
  }
  return null;
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as ForgotPasswordRequestBody | null;
  const email = normalizeEmail(payload?.email);
  const role = normalizeRole(payload?.role);

  if (!email || !role) {
    return fail("A valid email is required.", 400);
  }

  const rolePrefix = role === "citizen" ? "" : `/${role}`;
  const redirectTo = `${toSiteUrl(request)}${rolePrefix}/update-password`;

  try {
    const throttleStatus = await consumeForgotPasswordThrottle({
      request,
      email,
    }).catch(() => ({ isThrottled: false }));

    if (throttleStatus.isThrottled) {
      monitorAuthProviderCallSuppressed({
        flow: "forgot_password",
        request,
        email,
        reason: "throttled",
      });
      return ok({
        message: FORGOT_PASSWORD_SUCCESS_MESSAGE,
      });
    }

    const client = await supabaseServer();
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      monitorAuthProviderCallSuppressed({
        flow: "forgot_password",
        request,
        email,
        reason: "provider_error",
      });
    }

    return ok({
      message: FORGOT_PASSWORD_SUCCESS_MESSAGE,
    });
  } catch {
    monitorAuthProviderCallSuppressed({
      flow: "forgot_password",
      request,
      email,
      reason: "provider_error",
    });
    return ok({
      message: FORGOT_PASSWORD_SUCCESS_MESSAGE,
    });
  }
}
