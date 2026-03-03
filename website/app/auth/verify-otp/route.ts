import { supabaseServer } from "@/lib/supabase/server";
import {
  fail,
  mapSupabaseAuthErrorMessage,
  normalizeEmail,
  normalizeOtpToken,
  ok,
} from "@/lib/auth/citizen-auth-route";
import {
  getCitizenProfileByUserId,
  isCitizenProfileComplete,
} from "@/lib/auth/citizen-profile-completion";
import { applySessionPolicyCookies } from "@/lib/security/session-cookies.server";
import { getSecuritySettings } from "@/lib/security/security-settings.server";

type VerifyOtpRequestBody = {
  email?: unknown;
  token?: unknown;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as VerifyOtpRequestBody | null;
    const email = normalizeEmail(payload?.email);
    const token = normalizeOtpToken(payload?.token);

    if (!email || !token) {
      return fail("A valid email and 6-digit OTP code are required.", 400);
    }

    const client = await supabaseServer();
    const { error } = await client.auth.verifyOtp({
      email,
      token,
      type: "email",
    });

    if (error) {
      return fail(mapSupabaseAuthErrorMessage(error.message), 400);
    }

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user?.id) {
      return fail("Verification succeeded but session could not be established.", 401);
    }

    const { data: roleValue, error: roleError } = await client.rpc("current_role");
    if (roleError) {
      await client.auth.signOut();
      return fail(roleError.message, 500);
    }
    if (typeof roleValue === "string" && roleValue !== "citizen") {
      await client.auth.signOut();
      return fail("This verification flow is only for citizen accounts.", 403);
    }

    const profile = await getCitizenProfileByUserId(client, authData.user.id);
    if (profile && profile.role !== "citizen") {
      await client.auth.signOut();
      return fail("This verification flow is only for citizen accounts.", 403);
    }

    const settings = await getSecuritySettings();
    const response = ok({
      next: isCitizenProfileComplete(profile) ? "redirect" : "complete_profile",
    });
    applySessionPolicyCookies(response, settings);
    return response;
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Unable to verify OTP code.",
      500
    );
  }
}
