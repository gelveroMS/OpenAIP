import type {
  ActivityLogRow,
  AipRow,
  ChatMessageRow,
  FeedbackRow,
  ProfileRow,
} from "@/lib/contracts/databasev2";
import type { AipStatus } from "@/lib/contracts/databasev2/enums";

export type ActivityLogRecord = ActivityLogRow;
export type AipRecord = AipRow;
export type FeedbackRecord = FeedbackRow;
export type ProfileRecord = ProfileRow;
export type ChatMessageRecord = ChatMessageRow;

export type CityRecord = {
  id: string;
  region_id: string;
  province_id: string | null;
  psgc_code: string;
  name: string;
  is_independent: boolean;
  is_active: boolean;
  created_at: string;
};

export type MunicipalityRecord = {
  id: string;
  province_id: string;
  psgc_code: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

export type BarangayRecord = {
  id: string;
  city_id: string | null;
  municipality_id: string | null;
  psgc_code: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

export type AdminDashboardFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  lguScope: "all" | "city" | "municipality" | "barangay";
  lguId: string | null;
  aipStatus: AipStatus | "all";
};

export type DashboardSummaryVM = {
  totalLgus: number;
  activeUsers: number;
  flaggedComments: number;
  reviewBacklog: number;
  deltaLabels: {
    totalLgus: string;
    activeUsers: string;
    flaggedComments: string;
    reviewBacklog: string;
  };
  elevatedFlags: {
    flaggedComments: boolean;
    reviewBacklog: boolean;
  };
};

export type AipStatusDistributionVM = {
  status: AipStatus;
  label: string;
  count: number;
  color: string;
};

export type ReviewBacklogVM = {
  awaitingCount: number;
  awaitingOldestDays: number;
  stuckCount: number;
  stuckOlderThanDays: number;
};

export type UsageMetricsVM = {
  errorRateTrend: { label: string; value: number }[];
  chatbotUsageTrend: { label: string; value: number }[];
  avgDailyRequests: number;
  totalRequests: number;
  errorRate: number;
  deltaLabels: {
    avgDailyRequests: string;
    totalRequests: string;
    errorRate: string;
  };
  periodDays: number;
};

export type RecentActivityItemVM = {
  id: string;
  title: string;
  tagLabel: string;
  tagTone: "info" | "warning" | "danger" | "success";
  reference: string;
  timestamp: string;
  performedBy: string;
  iconKey: "comment" | "lock" | "user" | "check" | "alert";
};

export type LguOptionVM = {
  id: string;
  label: string;
  scope: "city" | "municipality" | "barangay";
};

export type AdminDashboardDataset = {
  cities: CityRecord[];
  municipalities: MunicipalityRecord[];
  barangays: BarangayRecord[];
  profiles: ProfileRecord[];
  aips: AipRecord[];
  feedback: FeedbackRecord[];
  activity: ActivityLogRecord[];
  chatMessages: ChatMessageRecord[];
};

export type AdminDashboardRepo = {
  getSummary: (filters: AdminDashboardFilters) => Promise<DashboardSummaryVM>;
  getAipStatusDistribution: (
    filters: AdminDashboardFilters
  ) => Promise<AipStatusDistributionVM[]>;
  getReviewBacklog: (filters: AdminDashboardFilters) => Promise<ReviewBacklogVM>;
  getUsageMetrics: (filters: AdminDashboardFilters) => Promise<UsageMetricsVM>;
  getRecentActivity: (filters: AdminDashboardFilters) => Promise<RecentActivityItemVM[]>;
  listLguOptions: () => Promise<LguOptionVM[]>;
};

export type AdminDashboardSnapshot = {
  summary: DashboardSummaryVM;
  distribution: AipStatusDistributionVM[];
  reviewBacklog: ReviewBacklogVM;
  usageMetrics: UsageMetricsVM;
  recentActivity: RecentActivityItemVM[];
  lguOptions: LguOptionVM[];
};
