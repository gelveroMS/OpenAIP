import type { AipStatus, ProjectCategory } from "@/lib/contracts/databasev2/enums";
import type { FeedbackCategorySummaryItem } from "@/lib/constants/feedback-category-summary";
import type {
  DashboardFeedback,
  DashboardProject,
} from "@/lib/repos/dashboard/repo";

export { CITIZEN_FEEDBACK_KINDS } from "@/lib/repos/dashboard/repo";

export type {
  DashboardScope,
  DashboardAip,
  DashboardProject,
  DashboardSector,
  DashboardRun,
  DashboardReview,
  DashboardFeedback,
  DashboardProjectUpdateLog,
  DashboardData,
} from "@/lib/repos/dashboard/repo";

export type DashboardQueryState = {
  q: string;
  tableQ: string;
  tableCategory: ProjectCategory | "all";
  tableSector: string | "all";
  kpiMode: "summary" | "operational";
};

export type DashboardViewModel = {
  projects: DashboardProject[];
  budgetBySector: Array<{ sectorCode: string; label: string; amount: number; percentage: number }>;
  totalBudget: number;
  missingTotalCount: number;
  topFundedFiltered: DashboardProject[];
  citizenFeedbackCount: number;
  awaitingReplyCount: number;
  feedbackCategorySummary: FeedbackCategorySummaryItem[];
  feedbackTargets: Array<{ label: string; value: number }>;
  statusDistribution: Array<{ status: AipStatus; count: number }>;
  pendingReviewAging: Array<{ bucket: string; count: number }>;
  oldestPendingDays: number | null;
  failedPipelineStages: number;
  newThisWeek: number;
  lguNotesPosted: number;
  flaggedProjects: number;
  workingOnItems: Array<{ id: string; label: string; href: string }>;
  recentCitizenFeedback: DashboardFeedback[];
};
