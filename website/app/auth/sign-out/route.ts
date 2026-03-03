import { supabaseServer } from "@/lib/supabase/server";
import { fail, ok } from "@/lib/auth/citizen-auth-route";
import { clearSessionPolicyCookies } from "@/lib/security/session-cookies.server";

export async function POST() {
  try {
    const client = await supabaseServer();
    const { error } = await client.auth.signOut();

    if (error) {
      return fail(error.message, 400);
    }

    const response = ok();
    clearSessionPolicyCookies(response);
    return response;
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Unable to sign out.", 500);
  }
}
