import { supabaseServer } from "@/lib/supabase/server";
import {
  fail,
  normalizeEmail,
  normalizePassword,
  ok,
  toSiteUrl,
} from "@/lib/auth/citizen-auth-route";
import { validatePasswordWithPolicy } from "@/lib/security/password-policy";
import { getSecuritySettings } from "@/lib/security/security-settings.server";

type SignUpRequestBody = {
  email?: unknown;
  password?: unknown;
};

const GENERIC_SIGN_UP_MESSAGE = "If the request can be processed, check your email for the next step.";

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as SignUpRequestBody | null;
    const email = normalizeEmail(payload?.email);
    const password = normalizePassword(payload?.password);

    if (!email || !password) {
      return fail("A valid email and password are required.", 400);
    }

    const settings = await getSecuritySettings();
    const passwordErrors = validatePasswordWithPolicy(password, settings.passwordPolicy);
    if (passwordErrors.length > 0) {
      return fail(passwordErrors[0], 400);
    }

    const client = await supabaseServer();
    await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${toSiteUrl(request)}/confirm`,
      },
    });

    return ok({
      next: "verify_otp",
      message: GENERIC_SIGN_UP_MESSAGE,
    });
  } catch {
    return fail("Unable to start sign-up.", 500);
  }
}
