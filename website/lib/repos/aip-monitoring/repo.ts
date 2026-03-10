import { selectRepo } from "@/lib/repos/_shared/selector";
import { createMockAipMonitoringRepo } from "./repo.mock";
import { createSupabaseAipMonitoringRepo } from "./repo.supabase";
import type { AipMonitoringDetail } from "@/mocks/fixtures/admin/aip-monitoring/aipMonitoring.mock";
import type { AipRow, AipReviewRow, ActivityLogRow } from "@/lib/contracts/databasev2";

export type AipMonitoringSeedData = {
  aips: AipRow[];
  reviews: AipReviewRow[];
  activity: ActivityLogRow[];
  details: Record<string, AipMonitoringDetail>;
  budgetTotalByAipId: Record<string, number>;
  lguNameByAipId: Record<string, string>;
  reviewerDirectory: Record<string, { name: string }>;
};

export interface AipMonitoringRepo {
  getSeedData(): Promise<AipMonitoringSeedData>;
}

export function getAipMonitoringRepo(): AipMonitoringRepo {
  return selectRepo({
    label: "AipMonitoringRepo",
    mock: () => createMockAipMonitoringRepo(),
    supabase: () => createSupabaseAipMonitoringRepo(),
  });
}
