import "server-only";

import type { User } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import type {
  AccountListInput,
  AccountListResult,
  AccountRecord,
  AccountRole,
  AccountScopeType,
  AccountStatus,
  AccountsRepo,
  CreateOfficialAccountInput,
  LguOption,
  LguScopeType,
  OfficialRole,
  UpdateAccountInput,
} from "./repo";

type IdNameRow = {
  id: string;
  name: string;
  is_active: boolean;
};

type ProfileRow = {
  id: string;
  role: AccountRole;
  full_name: string | null;
  email: string | null;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  barangay: IdNameRow | null;
  city: IdNameRow | null;
  municipality: IdNameRow | null;
};

type AuthUserSnapshot = {
  id: string;
  email: string | null;
  invitedAt: string | null;
  emailConfirmedAt: string | null;
  lastLoginAt: string | null;
  bannedUntil: string | null;
};

type ProfileDeleteBlocker = {
  blocker: string;
  row_count: number | string | null;
};

const PROFILE_DELETE_BLOCKER_LABELS: Record<string, string> = {
  uploaded_files: "uploaded files",
  aip_reviews: "AIP reviews",
  project_updates: "project updates",
};

const PROFILE_SELECT = `
  id,
  role,
  full_name,
  email,
  barangay_id,
  city_id,
  municipality_id,
  is_active,
  created_at,
  updated_at,
  barangay:barangays!profiles_barangay_id_fkey(id,name,is_active),
  city:cities!profiles_city_id_fkey(id,name,is_active),
  municipality:municipalities!profiles_municipality_id_fkey(id,name,is_active)
`;

function normalizeListInput(input: AccountListInput): Required<AccountListInput> {
  return {
    tab: input.tab,
    query: input.query ?? "",
    role: input.role ?? "all",
    status: input.status ?? "all",
    lguKey: input.lguKey ?? "all",
    page: Math.max(1, input.page ?? 1),
    pageSize: Math.min(100, Math.max(5, input.pageSize ?? 10)),
  };
}

function roleOptionsForTab(tab: AccountListInput["tab"]): AccountRole[] {
  if (tab === "citizens") return ["citizen"];
  return ["admin", "barangay_official", "city_official", "municipal_official"];
}

function scopeTypeForRole(role: AccountRole): AccountScopeType {
  if (role === "admin") return "none";
  if (role === "city_official") return "city";
  if (role === "municipal_official") return "municipality";
  return "barangay";
}

function assertRoleScope(role: AccountRole, scopeType: AccountScopeType, scopeId: string | null) {
  const expected = scopeTypeForRole(role);
  if (expected === "none") {
    if (scopeType !== "none" || scopeId !== null) {
      throw new Error("Admin accounts must not be assigned to an LGU.");
    }
    return;
  }

  if (scopeType !== expected || !scopeId) {
    if (role === "city_official") {
      throw new Error("City officials must be assigned to a city.");
    }
    if (role === "municipal_official") {
      throw new Error("Municipal officials must be assigned to a municipality.");
    }
    throw new Error(
      role === "citizen"
        ? "Citizens must be assigned to a barangay."
        : "Barangay officials must be assigned to a barangay."
    );
  }
}

function parseLguKey(lguKey: string): { scopeType: LguScopeType; id: string } | null {
  const [scopeTypeRaw, ...rest] = lguKey.split(":");
  const id = rest.join(":");
  if (!id) return null;
  if (
    scopeTypeRaw !== "barangay" &&
    scopeTypeRaw !== "city" &&
    scopeTypeRaw !== "municipality"
  ) {
    return null;
  }
  return { scopeType: scopeTypeRaw, id };
}

function deriveScopeFromRow(row: ProfileRow): {
  scopeType: AccountScopeType;
  scopeId: string | null;
  label: string;
} {
  if (row.role === "admin") {
    return {
      scopeType: "none",
      scopeId: null,
      label: "System-wide",
    };
  }

  if (row.city_id) {
    return {
      scopeType: "city",
      scopeId: row.city_id,
      label: `City: ${row.city?.name ?? row.city_id}`,
    };
  }

  if (row.municipality_id) {
    return {
      scopeType: "municipality",
      scopeId: row.municipality_id,
      label: `Municipality: ${row.municipality?.name ?? row.municipality_id}`,
    };
  }

  return {
    scopeType: "barangay",
    scopeId: row.barangay_id,
    label: `Barangay: ${row.barangay?.name ?? row.barangay_id ?? "Unassigned"}`,
  };
}

function toAccountStatus(isActive: boolean): AccountStatus {
  return isActive ? "active" : "deactivated";
}

function mapProfileToRecord(
  row: ProfileRow,
  authSnapshot: AuthUserSnapshot | undefined
): AccountRecord {
  const scope = deriveScopeFromRow(row);
  const email = row.email ?? authSnapshot?.email ?? "";
  const invitationPending =
    !!authSnapshot?.invitedAt && !authSnapshot.emailConfirmedAt;

  return {
    id: row.id,
    tab: row.role === "citizen" ? "citizens" : "officials",
    fullName: row.full_name?.trim() || email || "(No name)",
    email,
    role: row.role,
    status: toAccountStatus(row.is_active),
    isActive: row.is_active,
    lguScopeType: scope.scopeType,
    lguScopeId: scope.scopeId,
    lguAssignment: scope.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: authSnapshot?.lastLoginAt ?? null,
    invitedAt: authSnapshot?.invitedAt ?? null,
    emailConfirmedAt: authSnapshot?.emailConfirmedAt ?? null,
    invitationPending,
    canResendInvite: row.is_active && invitationPending,
  };
}

function buildScopeColumns(scopeType: AccountScopeType, scopeId: string | null) {
  return {
    barangay_id: scopeType === "barangay" ? scopeId : null,
    city_id: scopeType === "city" ? scopeId : null,
    municipality_id: scopeType === "municipality" ? scopeId : null,
  };
}

function sanitizeSearchTerm(query: string) {
  return query.replace(/[%*,'()]/g, " ").trim();
}

function requireBaseUrl() {
  const baseUrl = process.env.BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("Missing BASE_URL environment variable.");
  }
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function invitePathForRole(role: AccountRole) {
  // Invited users must first verify OTP on /confirm to establish a session.
  if (role === "city_official") {
    return `/city/confirm?next=${encodeURIComponent("/city/update-password")}`;
  }
  if (role === "barangay_official") {
    return `/barangay/confirm?next=${encodeURIComponent("/barangay/update-password")}`;
  }
  if (role === "admin") {
    return `/admin/confirm?next=${encodeURIComponent("/admin/update-password")}`;
  }
  // Municipality route is not yet implemented; admin confirm/update-password is a safe fallback.
  return `/admin/confirm?next=${encodeURIComponent("/admin/update-password")}`;
}

function resetPathForRole(role: AccountRole) {
  if (role === "city_official") return "/city/update-password";
  if (role === "barangay_official") return "/barangay/update-password";
  if (role === "citizen") return "/update-password";
  // Municipality route is not yet implemented; admin update-password is a safe fallback.
  return "/admin/update-password";
}

function supabaseRecoverySender() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  // Use an explicit non-SSR client for admin-initiated recovery emails.
  // SSR clients enforce PKCE and bind the verifier to the caller's cookies,
  // which breaks when the recipient opens the email in a different browser/device.
  return createClient(url, publishableKey, {
    auth: {
      flowType: "implicit",
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function assertScopeExists(scopeType: LguScopeType, scopeId: string) {
  const client = await supabaseServer();
  const table =
    scopeType === "city"
      ? "cities"
      : scopeType === "municipality"
        ? "municipalities"
        : "barangays";
  const { data, error } = await client
    .from(table)
    .select("id,is_active")
    .eq("id", scopeId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Selected LGU does not exist.");
  if (!data.is_active) throw new Error("Selected LGU is deactivated.");
}

async function getCurrentActorId() {
  const client = await supabaseServer();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.id) return null;
  return data.user.id;
}

function toNonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toPositiveCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function formatDeleteBlockersMessage(rows: ProfileDeleteBlocker[]): string {
  const formatted = rows.map((row) => {
    const label =
      PROFILE_DELETE_BLOCKER_LABELS[row.blocker] ??
      row.blocker.replace(/_/g, " ");
    const count = toPositiveCount(row.row_count);
    return count ? `${label} (${count})` : label;
  });
  return `Cannot delete account because dependent records exist: ${formatted.join(", ")}. Reassign or remove these records first.`;
}

async function getAuthUsersByIds(ids: string[]): Promise<Map<string, AuthUserSnapshot>> {
  const map = new Map<string, AuthUserSnapshot>();
  if (ids.length === 0) return map;

  const targetIds = new Set(ids);
  let admin: ReturnType<typeof supabaseAdmin>;
  try {
    admin = supabaseAdmin();
  } catch {
    return map;
  }
  let page = 1;
  const perPage = 200;

  while (targetIds.size > 0) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);

    const users = data.users ?? [];
    users.forEach((user: User) => {
      if (!targetIds.has(user.id)) return;
      map.set(user.id, {
        id: user.id,
        email: user.email ?? null,
        invitedAt: user.invited_at ?? null,
        emailConfirmedAt: user.email_confirmed_at ?? null,
        lastLoginAt: user.last_sign_in_at ?? null,
        bannedUntil: user.banned_until ?? null,
      });
      targetIds.delete(user.id);
    });

    if (users.length < perPage) break;
    page += 1;
  }

  return map;
}

async function listLguOptions(): Promise<LguOption[]> {
  const client = await supabaseServer();
  const [barangaysResult, citiesResult, municipalitiesResult] = await Promise.all([
    client.from("barangays").select("id,name,is_active").order("name", { ascending: true }),
    client.from("cities").select("id,name,is_active").order("name", { ascending: true }),
    client
      .from("municipalities")
      .select("id,name,is_active")
      .order("name", { ascending: true }),
  ]);

  if (barangaysResult.error) throw new Error(barangaysResult.error.message);
  if (citiesResult.error) throw new Error(citiesResult.error.message);
  if (municipalitiesResult.error) throw new Error(municipalitiesResult.error.message);

  const options: LguOption[] = [];
  (barangaysResult.data ?? []).forEach((row) => {
    options.push({
      key: `barangay:${row.id}`,
      scopeType: "barangay",
      id: row.id,
      label: `Barangay: ${row.name}`,
      isActive: row.is_active,
    });
  });
  (citiesResult.data ?? []).forEach((row) => {
    options.push({
      key: `city:${row.id}`,
      scopeType: "city",
      id: row.id,
      label: `City: ${row.name}`,
      isActive: row.is_active,
    });
  });
  (municipalitiesResult.data ?? []).forEach((row) => {
    options.push({
      key: `municipality:${row.id}`,
      scopeType: "municipality",
      id: row.id,
      label: `Municipality: ${row.name}`,
      isActive: row.is_active,
    });
  });
  return options;
}

async function fetchProfileById(id: string): Promise<ProfileRow> {
  const client = await supabaseServer();
  const { data, error } = await client
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as ProfileRow;
}

async function fetchRecordById(id: string): Promise<AccountRecord> {
  const profile = await fetchProfileById(id);
  const authMap = await getAuthUsersByIds([id]);
  return mapProfileToRecord(profile, authMap.get(id));
}

async function logAccountActivity(
  action: string,
  row: {
    id: string;
    city_id: string | null;
    municipality_id: string | null;
    barangay_id: string | null;
  },
  metadata: Record<string, unknown>
) {
  try {
    const client = await supabaseServer();
    const actorId = await getCurrentActorId();
    let actorName: string | null = null;

    if (actorId) {
      const { data: actorProfile, error: actorProfileError } = await client
        .from("profiles")
        .select("full_name,email")
        .eq("id", actorId)
        .maybeSingle();

      if (!actorProfileError) {
        actorName =
          toNonEmptyString(actorProfile?.full_name ?? null) ??
          toNonEmptyString(actorProfile?.email ?? null);
      }
    }

    await client.rpc("log_activity", {
      p_action: action,
      p_entity_table: "profiles",
      p_entity_id: row.id,
      p_city_id: row.city_id,
      p_municipality_id: row.municipality_id,
      p_barangay_id: row.barangay_id,
      p_metadata: actorName ? { ...metadata, actor_name: actorName } : metadata,
    });
  } catch {
    // Best-effort audit logging. Do not block account actions when RPC is unavailable.
  }
}

async function assertCanMutateAdminAccount(
  targetRole: AccountRole,
  targetIsActive: boolean
) {
  if (targetRole !== "admin" || !targetIsActive) return;

  const client = await supabaseServer();
  const { count, error } = await client
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("is_active", true);

  if (error) throw new Error(error.message);
  if ((count ?? 0) <= 1) {
    throw new Error("Cannot modify the last active admin account.");
  }
}

async function inviteUser(email: string, role: AccountRole) {
  const admin = supabaseAdmin();
  const redirectTo = `${requireBaseUrl()}${invitePathForRole(role)}`;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      intended_role: role,
    },
  });
  if (error) throw new Error(error.message);
  if (!data.user?.id) {
    throw new Error("Invite was sent but user ID was not returned by Supabase.");
  }
  return data.user.id;
}

async function resolveRowById(id: string) {
  const client = await supabaseServer();
  const { data, error } = await client
    .from("profiles")
    .select("id,role,is_active,email,city_id,municipality_id,barangay_id")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Account not found.");
  return data;
}

async function getProfileDeleteBlockers(profileId: string): Promise<ProfileDeleteBlocker[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.rpc("get_profile_delete_blockers", {
    p_profile_id: profileId,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data as ProfileDeleteBlocker[];
}

export function createSupabaseAccountsRepo(): AccountsRepo {
  return {
    async list(input: AccountListInput): Promise<AccountListResult> {
      const normalized = normalizeListInput(input);
      const client = await supabaseServer();

      let query = client
        .from("profiles")
        .select(PROFILE_SELECT, { count: "exact" })
        .order("created_at", { ascending: false });

      if (normalized.tab === "officials") {
        query = query.neq("role", "citizen");
      } else {
        query = query.eq("role", "citizen");
      }

      if (normalized.role !== "all") {
        query = query.eq("role", normalized.role);
      }

      if (normalized.status !== "all") {
        query = query.eq("is_active", normalized.status === "active");
      }

      if (normalized.lguKey !== "all") {
        const parsed = parseLguKey(normalized.lguKey);
        if (!parsed) throw new Error("Invalid LGU filter.");
        if (parsed.scopeType === "city") query = query.eq("city_id", parsed.id);
        if (parsed.scopeType === "municipality") {
          query = query.eq("municipality_id", parsed.id);
        }
        if (parsed.scopeType === "barangay") query = query.eq("barangay_id", parsed.id);
      }

      const searchTerm = sanitizeSearchTerm(normalized.query);
      if (searchTerm) {
        query = query.or(`full_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
      }

      const start = (normalized.page - 1) * normalized.pageSize;
      const end = start + normalized.pageSize - 1;
      query = query.range(start, end);

      const { data, error, count } = await query;
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as unknown as ProfileRow[];
      const authSnapshots = await getAuthUsersByIds(rows.map((row) => row.id));

      const lguOptions = await listLguOptions();

      return {
        rows: rows.map((row) => mapProfileToRecord(row, authSnapshots.get(row.id))),
        total: count ?? 0,
        page: normalized.page,
        pageSize: normalized.pageSize,
        roleOptions: roleOptionsForTab(normalized.tab),
        lguOptions,
      };
    },

    async createOfficial(input: CreateOfficialAccountInput): Promise<AccountRecord> {
      const fullName = input.fullName.trim();
      const email = input.email.trim().toLowerCase();
      const role: OfficialRole = input.role;
      const scopeType: LguScopeType = input.scopeType;
      const scopeId = input.scopeId;

      if (!fullName) throw new Error("Full name is required.");
      if (!email) throw new Error("Email is required.");

      assertRoleScope(role, scopeType, scopeId);
      await assertScopeExists(scopeType, scopeId);

      const client = await supabaseServer();
      const { data: existingProfile, error: lookupError } = await client
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .maybeSingle();
      if (lookupError) throw new Error(lookupError.message);
      if (existingProfile) throw new Error("An account with this email already exists.");

      const userId = await inviteUser(email, role);

      const payload = {
        id: userId,
        role,
        full_name: fullName,
        email,
        is_active: true,
        ...buildScopeColumns(scopeType, scopeId),
      };

      const { error: insertError } = await client.from("profiles").insert(payload);
      if (insertError) {
        const admin = supabaseAdmin();
        await admin.auth.admin.deleteUser(userId);
        throw new Error(insertError.message);
      }

      const inserted = await resolveRowById(userId);
      await logAccountActivity("account_created", inserted, {
        role,
        invite: true,
      });
      return fetchRecordById(userId);
    },

    async updateAccount(id: string, patch: UpdateAccountInput): Promise<AccountRecord> {
      const fullName = patch.fullName.trim();
      if (!fullName) throw new Error("Full name is required.");

      assertRoleScope(patch.role, patch.scopeType, patch.scopeId);
      if (patch.scopeType !== "none" && patch.scopeId) {
        await assertScopeExists(patch.scopeType, patch.scopeId);
      }

      const before = await resolveRowById(id);

      const client = await supabaseServer();
      const { error } = await client
        .from("profiles")
        .update({
          full_name: fullName,
          role: patch.role,
          ...buildScopeColumns(patch.scopeType, patch.scopeId),
        })
        .eq("id", id);

      if (error) throw new Error(error.message);

      const after = await resolveRowById(id);
      await logAccountActivity("account_updated", after, {
        before_role: before.role,
        after_role: after.role,
      });
      return fetchRecordById(id);
    },

    async setStatus(id: string, status: AccountStatus): Promise<AccountRecord> {
      const actorId = await getCurrentActorId();
      if (!actorId) throw new Error("Unauthorized.");
      if (actorId === id && status === "deactivated") {
        throw new Error("You cannot deactivate your own account.");
      }

      const target = await resolveRowById(id);
      if (status === "deactivated") {
        await assertCanMutateAdminAccount(target.role, target.is_active);
      }

      const nextActive = status === "active";
      const client = await supabaseServer();
      const { error: profileError } = await client
        .from("profiles")
        .update({ is_active: nextActive })
        .eq("id", id);
      if (profileError) throw new Error(profileError.message);

      const admin = supabaseAdmin();
      const { error: authError } = await admin.auth.admin.updateUserById(id, {
        ban_duration: nextActive ? "none" : "876000h",
      });
      if (authError) {
        await client.from("profiles").update({ is_active: target.is_active }).eq("id", id);
        throw new Error(authError.message);
      }

      const after = await resolveRowById(id);
      await logAccountActivity("account_status_changed", after, {
        status,
      });
      return fetchRecordById(id);
    },

    async deleteAccount(id: string): Promise<void> {
      const actorId = await getCurrentActorId();
      if (!actorId) throw new Error("Unauthorized.");
      if (actorId === id) throw new Error("You cannot delete your own account.");

      const target = await resolveRowById(id);
      await assertCanMutateAdminAccount(target.role, target.is_active);

      const blockers = await getProfileDeleteBlockers(id);
      if (blockers.length > 0) {
        throw new Error(formatDeleteBlockersMessage(blockers));
      }

      const admin = supabaseAdmin();
      const { error: authDeleteError } = await admin.auth.admin.deleteUser(id);
      if (authDeleteError) throw new Error(authDeleteError.message);

      const client = await supabaseServer();
      const { error: profileDeleteError } = await client.from("profiles").delete().eq("id", id);
      if (profileDeleteError) throw new Error(profileDeleteError.message);

      await logAccountActivity("account_deleted", target, {
        deleted_user_id: id,
      });
    },

    async resetPassword(id: string): Promise<void> {
      const row = await resolveRowById(id);
      if (!row.email) {
        throw new Error("Cannot send password reset because account email is missing.");
      }

      const client = supabaseRecoverySender();
      const { error } = await client.auth.resetPasswordForEmail(row.email, {
        redirectTo: `${requireBaseUrl()}${resetPathForRole(row.role)}`,
      });
      if (error) throw new Error(error.message);

      await logAccountActivity("account_password_reset_email_sent", row, {
        email: row.email,
      });
    },

    async resendInvite(id: string): Promise<void> {
      const row = await resolveRowById(id);
      if (!row.is_active) {
        throw new Error("Cannot resend invite to a deactivated account.");
      }
      if (!row.email) {
        throw new Error("Cannot resend invite because account email is missing.");
      }

      const authMap = await getAuthUsersByIds([id]);
      const authUser = authMap.get(id);
      if (authUser?.emailConfirmedAt) {
        throw new Error("This account has already accepted the invite.");
      }

      await inviteUser(row.email, row.role);
      await logAccountActivity("account_invite_resent", row, {
        email: row.email,
      });
    },
  };
}
