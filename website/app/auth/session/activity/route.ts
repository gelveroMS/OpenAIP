import { supabaseServer } from "@/lib/supabase/server";
import { fail, ok } from "@/lib/auth/citizen-auth-route";
import { applySessionPolicyCookies } from "@/lib/security/session-cookies.server";
import { getSecuritySettings } from "@/lib/security/security-settings.server";
import { toTimeoutMs, toWarningMs } from "@/lib/security/session-timeout";

export async function POST() {
  try {
    const client = await supabaseServer();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user?.id) {
      return fail("Authentication required.", 401);
    }

    const settings = await getSecuritySettings();
    const lastActivityAtMs = Date.now();

    const response = ok({
      timeoutMs: toTimeoutMs(settings.sessionTimeout),
      warningMs: toWarningMs(settings.sessionTimeout),
      lastActivityAtMs,
    });
    applySessionPolicyCookies(response, settings, lastActivityAtMs);
    return response;
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Unable to refresh session.", 500);
  }
}

