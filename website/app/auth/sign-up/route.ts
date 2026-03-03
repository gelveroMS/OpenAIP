import { supabaseServer } from "@/lib/supabase/server";
import {
  fail,
  mapSupabaseAuthErrorMessage,
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
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${toSiteUrl(request)}/confirm`,
      },
    });

    if (error) {
      return fail(mapSupabaseAuthErrorMessage(error.message), 400);
    }

    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return fail("Account already exists. Please sign in instead.", 409);
    }

    return ok({
      next: "verify_otp",
      message: "OTP sent to your email.",
    });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Unable to start sign-up.",
      500
    );
  }
}
