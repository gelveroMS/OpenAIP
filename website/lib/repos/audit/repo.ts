import { NotImplementedError } from "@/lib/core/errors";
import { selectRepo } from "@/lib/repos/_shared/selector";
import { createMockAuditRepo } from "./repo.mock";

export type {
  ActivityLogAction,
  ActivityLogEntityType,
  ActivityLogRow,
  AuditListInput,
  AuditListResult,
  AuditRoleFilter,
  ActivityScopeSnapshot,
} from "./types";

import type { ActivityLogRow, AuditListInput, AuditListResult } from "./types";

// [DATAFLOW] Page/service depends on this interface; swap adapters without touching UI/pages.
// [DBV2] Backing table is `public.activity_log` (server-only writes; RLS restricts reads).
export interface AuditRepo {
  listMyActivity(actorId: string): Promise<ActivityLogRow[]>;
  listBarangayOfficialActivity(barangayId: string): Promise<ActivityLogRow[]>;
  listCityOfficialActivity(cityId: string): Promise<ActivityLogRow[]>;
  listAllActivity(): Promise<ActivityLogRow[]>;
  listActivityPage(input: AuditListInput): Promise<AuditListResult>;
}

export function getAuditRepo(): AuditRepo {
  return selectRepo({
    label: "AuditRepo",
    mock: () => createMockAuditRepo(),
    supabase: () => {
      throw new NotImplementedError(
        "AuditRepo is server-only outside mock mode. Import from `@/lib/repos/audit/repo.server`."
      );
    },
  });
}
