import { supabaseServer } from "@/lib/supabase/server";
import { fail, normalizePassword, ok } from "@/lib/auth/citizen-auth-route";
import { validatePasswordWithPolicy } from "@/lib/security/password-policy";
import { applySessionPolicyCookies } from "@/lib/security/session-cookies.server";
import { getSecuritySettings } from "@/lib/security/security-settings.server";

type UpdatePasswordBody = {
  password?: unknown;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as UpdatePasswordBody | null;
    const password = normalizePassword(payload?.password);
    if (!password) {
      return fail("A valid password is required.", 400);
    }

    const client = await supabaseServer();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user?.id) {
      return fail("Authentication required.", 401);
    }

    const settings = await getSecuritySettings();
    const passwordErrors = validatePasswordWithPolicy(password, settings.passwordPolicy);
    if (passwordErrors.length > 0) {
      return fail(passwordErrors[0], 400);
    }

    const { error } = await client.auth.updateUser({ password });
    if (error) {
      return fail(error.message, 400);
    }

    const response = ok({ updated: true });
    applySessionPolicyCookies(response, settings);
    return response;
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Unable to update password.", 500);
  }
}

