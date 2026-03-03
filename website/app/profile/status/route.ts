import { supabaseServer } from "@/lib/supabase/server";
import { fail, ok } from "@/lib/auth/citizen-auth-route";
import {
  getCitizenProfileByUserId,
  isCitizenProfileComplete,
} from "@/lib/auth/citizen-profile-completion";
import { getBlockedUsersSetting } from "@/lib/settings/app-settings";

function resolveActiveCitizenBlock(input: {
  blockedUntil?: string | null;
  reason?: string | null;
}) {
  const blockedUntil = typeof input.blockedUntil === "string" ? input.blockedUntil : null;
  if (!blockedUntil) {
    return { isBlocked: false as const, blockedUntil: null, blockedReason: null };
  }

  const blockedUntilMs = new Date(blockedUntil).getTime();
  if (!Number.isFinite(blockedUntilMs) || blockedUntilMs <= Date.now()) {
    return { isBlocked: false as const, blockedUntil: null, blockedReason: null };
  }

  const blockedReason =
    typeof input.reason === "string" && input.reason.trim().length > 0
      ? input.reason.trim()
      : "Policy violation";

  return {
    isBlocked: true as const,
    blockedUntil,
    blockedReason,
  };
}

export async function GET() {
  try {
    const client = await supabaseServer();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user?.id) {
      return fail("Authentication required.", 401);
    }

    const profile = await getCitizenProfileByUserId(client, authData.user.id);
    if (profile && profile.role !== "citizen") {
      return fail("This endpoint is only for citizen accounts.", 403);
    }
    const blockedUsers = await getBlockedUsersSetting();
    const blockState = resolveActiveCitizenBlock(blockedUsers[authData.user.id] ?? {});

    return ok({
      isComplete: isCitizenProfileComplete(profile),
      userId: authData.user.id,
      isBlocked: blockState.isBlocked,
      blockedUntil: blockState.blockedUntil,
      blockedReason: blockState.blockedReason,
    });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Unable to load profile status.",
      500
    );
  }
}
