import type { AuditRepo, ActivityLogRow } from "./repo";
import type { AuditListInput, AuditListResult } from "./types";
import { ACTIVITY_LOG_FIXTURE } from "@/mocks/fixtures/audit/activity-log.fixture";

function sortNewestFirst(rows: ActivityLogRow[]): ActivityLogRow[] {
  return [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function getMetadataString(
  metadata: ActivityLogRow["metadata"],
  key: string
): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function filterRows(rows: ActivityLogRow[], input: AuditListInput): ActivityLogRow[] {
  const q = input.q.trim().toLowerCase();
  const filtered = rows
    .filter((row) => {
      if (input.role === "all") return true;
      if (input.role === "admin") return row.actorRole === "admin";
      if (input.role === "citizen") return row.actorRole === "citizen";
      return (
        row.actorRole === "barangay_official" ||
        row.actorRole === "city_official" ||
        row.actorRole === "municipal_official"
      );
    })
    .filter((row) => (input.event === "all" ? true : row.action === input.event))
    .filter((row) => {
      if (input.year === "all") return true;
      const year = new Date(row.createdAt).getUTCFullYear();
      return year === input.year;
    })
    .filter((row) => {
      if (!q) return true;
      const haystack = [
        row.action,
        row.actorRole ?? "",
        getMetadataString(row.metadata, "actor_name"),
        getMetadataString(row.metadata, "actor_position"),
        getMetadataString(row.metadata, "details"),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });

  return sortNewestFirst(filtered);
}

function pageRows(rows: ActivityLogRow[], input: AuditListInput): AuditListResult {
  const start = (input.page - 1) * input.pageSize;
  const paged = rows.slice(start, start + input.pageSize);
  return {
    rows: paged,
    total: rows.length,
    page: input.page,
    pageSize: input.pageSize,
  };
}

// [DATAFLOW] Mock `AuditRepo` adapter backed by `ACTIVITY_LOG_FIXTURE`.
export function createMockAuditRepo(): AuditRepo {
  return {
    async listMyActivity(actorId: string) {
      return sortNewestFirst(
        ACTIVITY_LOG_FIXTURE.filter((row) => row.actorId === actorId)
      );
    },
    async listBarangayOfficialActivity(barangayId: string) {
      return sortNewestFirst(
        ACTIVITY_LOG_FIXTURE.filter(
          (row) =>
            row.actorRole === "barangay_official" &&
            row.scope?.scope_type === "barangay" &&
            row.scope.barangay_id === barangayId
        )
      );
    },
    async listCityOfficialActivity(cityId: string) {
      return sortNewestFirst(
        ACTIVITY_LOG_FIXTURE.filter(
          (row) =>
            row.actorRole === "city_official" &&
            row.scope?.scope_type === "city" &&
            row.scope.city_id === cityId
        )
      );
    },
    async listAllActivity() {
      return sortNewestFirst(ACTIVITY_LOG_FIXTURE);
    },
    async listActivityPage(input: AuditListInput): Promise<AuditListResult> {
      const filtered = filterRows(ACTIVITY_LOG_FIXTURE, input);
      return pageRows(filtered, input);
    },
  };
}
