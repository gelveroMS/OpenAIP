import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AuditRepo } from "./repo";
import type {
  ActivityLogRow,
  ActivityScopeSnapshot,
  AuditListInput,
  AuditListResult,
  AuditRoleFilter,
} from "./types";

type ActivityLogSelectRow = {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  entity_table: string | null;
  entity_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
  barangay_id: string | null;
  metadata: unknown;
  created_at: string;
};

type ProfileSelectRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

const SELECT_COLUMNS = [
  "id",
  "actor_id",
  "actor_role",
  "action",
  "entity_table",
  "entity_id",
  "city_id",
  "municipality_id",
  "barangay_id",
  "metadata",
  "created_at",
].join(",");

type ActivityLogFilters = {
  actorId?: string;
  actorRole?: string;
  barangayId?: string;
  cityId?: string;
  role?: AuditRoleFilter;
  year?: "all" | number;
  event?: "all" | string;
  q?: string;
};

function toScope(row: ActivityLogSelectRow): ActivityScopeSnapshot {
  if (row.barangay_id) {
    return {
      scope_type: "barangay",
      barangay_id: row.barangay_id,
      city_id: null,
      municipality_id: null,
    };
  }

  if (row.city_id) {
    return {
      scope_type: "city",
      barangay_id: null,
      city_id: row.city_id,
      municipality_id: null,
    };
  }

  if (row.municipality_id) {
    return {
      scope_type: "municipality",
      barangay_id: null,
      city_id: null,
      municipality_id: row.municipality_id,
    };
  }

  return {
    scope_type: "none",
    barangay_id: null,
    city_id: null,
    municipality_id: null,
  };
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toMetadataObject(
  metadata: unknown
): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return { ...(metadata as Record<string, unknown>) };
}

function mapActivityRow(
  row: ActivityLogSelectRow,
  profileById: Map<string, ProfileSelectRow>
): ActivityLogRow {
  const metadata = toMetadataObject(row.metadata);
  const profile = row.actor_id ? profileById.get(row.actor_id) : undefined;
  const profileActorName =
    toNonEmptyString(profile?.full_name) ?? toNonEmptyString(profile?.email);
  const metadataActorName = toNonEmptyString(metadata.actor_name);
  const actorName = profileActorName ?? metadataActorName;
  if (actorName) {
    metadata.actor_name = actorName;
  }

  return {
    id: row.id,
    actorId: row.actor_id ?? EMPTY_UUID,
    action: row.action,
    entityType: row.entity_table ?? "activity_log",
    entityId: row.entity_id ?? row.id,
    scope: toScope(row),
    metadata:
      Object.keys(metadata).length > 0
        ? (metadata as ActivityLogRow["metadata"])
        : null,
    actorRole: (row.actor_role as ActivityLogRow["actorRole"]) ?? null,
    createdAt: row.created_at,
  };
}

function escapeIlikeTerm(input: string): string {
  return input.replace(/[%_]/g, "\\$&").replace(/,/g, " ").trim();
}

type FilterableQuery = {
  eq: (...args: unknown[]) => unknown;
  in: (...args: unknown[]) => unknown;
  gte: (...args: unknown[]) => unknown;
  lt: (...args: unknown[]) => unknown;
  or: (...args: unknown[]) => unknown;
};

function applyActivityLogFilters(
  query: FilterableQuery,
  filters: ActivityLogFilters
): FilterableQuery {
  let next = query;

  if (filters.actorId) {
    next = next.eq("actor_id", filters.actorId) as FilterableQuery;
  }

  if (filters.actorRole) {
    next = next.eq("actor_role", filters.actorRole) as FilterableQuery;
  }

  if (filters.barangayId) {
    next = next.eq("barangay_id", filters.barangayId) as FilterableQuery;
  }
  if (filters.cityId) {
    next = next.eq("city_id", filters.cityId) as FilterableQuery;
  }

  if (filters.role && filters.role !== "all") {
    if (filters.role === "admin") {
      next = next.eq("actor_role", "admin") as FilterableQuery;
    } else if (filters.role === "citizen") {
      next = next.eq("actor_role", "citizen") as FilterableQuery;
    } else if (filters.role === "lgu_officials") {
      next = next.in("actor_role", [
        "barangay_official",
        "city_official",
        "municipal_official",
      ]) as FilterableQuery;
    }
  }

  if (typeof filters.year === "number") {
    const yearStart = new Date(Date.UTC(filters.year, 0, 1)).toISOString();
    const yearEnd = new Date(Date.UTC(filters.year + 1, 0, 1)).toISOString();
    next = next.gte("created_at", yearStart) as FilterableQuery;
    next = next.lt("created_at", yearEnd) as FilterableQuery;
  }

  if (filters.event && filters.event !== "all") {
    next = next.eq("action", filters.event) as FilterableQuery;
  }

  const q = typeof filters.q === "string" ? escapeIlikeTerm(filters.q) : "";
  if (q.length > 0) {
    next = next.or(
      [
        `action.ilike.%${q}%`,
        `actor_role.ilike.%${q}%`,
        `metadata->>actor_name.ilike.%${q}%`,
        `metadata->>actor_position.ilike.%${q}%`,
        `metadata->>details.ilike.%${q}%`,
      ].join(",")
    ) as FilterableQuery;
  }

  return next;
}

async function buildProfileMap(
  rows: ActivityLogSelectRow[]
): Promise<Map<string, ProfileSelectRow>> {
  const actorIds = Array.from(
    new Set(
      rows
        .map((row) => row.actor_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );

  const profileById = new Map<string, ProfileSelectRow>();
  if (actorIds.length === 0) {
    return profileById;
  }

  const { data: profiles, error: profilesError } = await supabaseAdmin()
    .from("profiles")
    .select("id,full_name,email")
    .in("id", actorIds);

  if (profilesError) {
    throw new Error(profilesError.message);
  }

  ((profiles ?? []) as unknown[]).forEach((row) => {
    const profile = row as ProfileSelectRow;
    profileById.set(profile.id, profile);
  });

  return profileById;
}

async function listActivityRows(
  filters: ActivityLogFilters = {}
): Promise<ActivityLogRow[]> {
  const admin = supabaseAdmin();
  let query: any = admin
    .from("activity_log")
    .select(SELECT_COLUMNS)
    .order("created_at", { ascending: false });

  query = applyActivityLogFilters(query as FilterableQuery, filters);

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const rows = ((data ?? []) as unknown[]).map(
    (row) => row as ActivityLogSelectRow
  );
  const profileById = await buildProfileMap(rows);

  return rows.map((row) => mapActivityRow(row, profileById));
}

async function listActivityPage(input: AuditListInput): Promise<AuditListResult> {
  const admin = supabaseAdmin();
  const start = (input.page - 1) * input.pageSize;
  const end = start + input.pageSize - 1;

  let query: any = admin
    .from("activity_log")
    .select(SELECT_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false });

  query = applyActivityLogFilters(query as FilterableQuery, {
    role: input.role,
    year: input.year,
    event: input.event,
    q: input.q,
  });

  const { data, error, count } = await query.range(start, end);
  if (error) {
    throw new Error(error.message);
  }

  const rows = ((data ?? []) as unknown[]).map(
    (row) => row as ActivityLogSelectRow
  );
  const profileById = await buildProfileMap(rows);

  return {
    rows: rows.map((row) => mapActivityRow(row, profileById)),
    total: count ?? 0,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export function createSupabaseAuditRepo(): AuditRepo {
  return {
    async listMyActivity(actorId: string): Promise<ActivityLogRow[]> {
      return listActivityRows({ actorId });
    },
    async listBarangayOfficialActivity(
      barangayId: string
    ): Promise<ActivityLogRow[]> {
      return listActivityRows({
        actorRole: "barangay_official",
        barangayId,
      });
    },
    async listCityOfficialActivity(cityId: string): Promise<ActivityLogRow[]> {
      return listActivityRows({
        actorRole: "city_official",
        cityId,
      });
    },
    async listAllActivity(): Promise<ActivityLogRow[]> {
      return listActivityRows();
    },
    async listActivityPage(input: AuditListInput): Promise<AuditListResult> {
      return listActivityPage(input);
    },
  };
}
