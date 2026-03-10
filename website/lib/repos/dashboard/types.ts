import type {
  AipStatus,
  FeedbackKind,
  FeedbackTargetType,
  PipelineStage,
  PipelineStatus,
  ProjectCategory,
} from "@/lib/contracts/databasev2/enums";
import type { FeedbackCategorySummaryItem } from "@/lib/constants/feedback-category-summary";

export type DashboardScope = "barangay" | "city";

export const CITIZEN_FEEDBACK_KINDS = [
  "question",
  "suggestion",
  "concern",
  "commend",
] as const satisfies readonly FeedbackKind[];

export const DASHBOARD_REPLY_MAX_LENGTH = 4000;

export type DashboardAip = {
  id: string;
  fiscalYear: number;
  totalInvestmentProgram?: number | null;
  status: AipStatus;
  statusUpdatedAt: string;
  submittedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  uploadedBy?: string | null;
  uploadedDate?: string | null;
};

export type DashboardProject = {
  id: string;
  aipId: string;
  aipRefCode: string;
  programProjectDescription: string;
  category: ProjectCategory;
  sectorCode: string;
  total: number | null;
  personalServices: number | null;
  maintenanceAndOtherOperatingExpenses: number | null;
  capitalOutlay: number | null;
  errors: unknown;
  isHumanEdited: boolean;
  editedAt: string | null;
  healthProgramName: string | null;
};

export type DashboardSector = {
  code: string;
  label: string;
};

export type DashboardRun = {
  id: string;
  aipId: string;
  stage: PipelineStage;
  status: PipelineStatus;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type DashboardReview = {
  id: string;
  aipId: string;
  action: "approve" | "request_revision" | "claim_review";
  note: string | null;
  reviewerId: string;
  createdAt: string;
};

export type DashboardFeedback = {
  id: string;
  targetType: FeedbackTargetType;
  aipId: string | null;
  projectId: string | null;
  parentFeedbackId: string | null;
  kind: FeedbackKind;
  body: string;
  createdAt: string;
};

export type DashboardProjectUpdateLog = {
  id: string;
  action: "project_info_updated" | "project_updated";
  entityId: string;
  projectRefCode: string;
  title: string;
  body: string;
  actorName: string;
  createdAt: string;
};

export type DashboardData = {
  scope: DashboardScope;
  scopeId: string;
  selectedFiscalYear: number;
  selectedAip: DashboardAip | null;
  availableFiscalYears: number[];
  allAips: DashboardAip[];
  projects: DashboardProject[];
  sectors: DashboardSector[];
  latestRuns: DashboardRun[];
  reviews: DashboardReview[];
  feedback: DashboardFeedback[];
  projectUpdateLogs: DashboardProjectUpdateLog[];
};

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

export type DashboardDataByScopeInput = {
  scope: DashboardScope;
  scopeId: string;
  requestedFiscalYear?: number | null;
};

export type CreateDashboardDraftInput = {
  scope: DashboardScope;
  scopeId: string;
  fiscalYear: number;
  createdBy: string;
};

export type CreateDashboardDraftResult = {
  created: boolean;
  aipId: string | null;
};

export type ReplyDashboardFeedbackInput = {
  scope: DashboardScope;
  scopeId: string;
  parentFeedbackId: string;
  body: string;
  authorId: string;
};

export type ReplyDashboardFeedbackResult = {
  replyId: string;
};
