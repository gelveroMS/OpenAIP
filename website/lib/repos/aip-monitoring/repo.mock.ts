import type { AipMonitoringRepo } from "./repo";
import {
  AIP_MONITORING_ACTIVITY,
  AIP_MONITORING_AIPS,
  AIP_MONITORING_BUDGET_TOTAL_BY_AIP_ID,
  AIP_MONITORING_DETAILS,
  AIP_MONITORING_LGU_NAMES,
  AIP_MONITORING_REVIEWS,
  REVIEWER_DIRECTORY,
} from "@/mocks/fixtures/admin/aip-monitoring/aipMonitoring.mock";

export function createMockAipMonitoringRepo(): AipMonitoringRepo {
  return {
    async getSeedData() {
      return {
        aips: AIP_MONITORING_AIPS,
        reviews: AIP_MONITORING_REVIEWS,
        activity: AIP_MONITORING_ACTIVITY,
        details: AIP_MONITORING_DETAILS,
        budgetTotalByAipId: AIP_MONITORING_BUDGET_TOTAL_BY_AIP_ID,
        lguNameByAipId: AIP_MONITORING_LGU_NAMES,
        reviewerDirectory: REVIEWER_DIRECTORY,
      };
    },
  };
}
