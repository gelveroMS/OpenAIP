import type { PasswordPolicyLike } from "@/lib/security/password-policy";

type PasswordPolicyApiResponse = {
  ok?: boolean;
  passwordPolicy?: PasswordPolicyLike;
  error?: { message?: string };
};

export async function fetchPasswordPolicy(): Promise<PasswordPolicyLike | null> {
  try {
    const response = await fetch("/auth/password-policy", {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as PasswordPolicyApiResponse | null;

    if (!response.ok || payload?.ok === false || !payload?.passwordPolicy) {
      return null;
    }
    return payload.passwordPolicy;
  } catch {
    return null;
  }
}
