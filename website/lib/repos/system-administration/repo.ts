import { selectRepo } from "@/lib/repos/_shared/selector";
import { createMockSystemAdministrationRepo } from "./repo.mock";
import { createSupabaseSystemAdministrationRepo } from "./repo.supabase";

export type {
  SystemAdministrationRepo,
  SecuritySettings,
  SystemBannerDraft,
  SystemBannerPublished,
  SystemAdministrationAuditLog,
} from "./types";

import type { SystemAdministrationRepo } from "./types";

export function getSystemAdministrationRepo(): SystemAdministrationRepo {
  return selectRepo({
    label: "SystemAdministrationRepo",
    mock: () => createMockSystemAdministrationRepo(),
    supabase: () => createSupabaseSystemAdministrationRepo(),
  });
}

