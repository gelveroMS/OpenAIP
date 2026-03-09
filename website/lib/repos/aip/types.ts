import type {
  AipStatus,
  FeedbackKind,
  FeedbackSource,
  RoleType,
} from "@/lib/contracts/databasev2";

export type { AipStatus } from "@/lib/contracts/databasev2";

export type LguScope = "barangay" | "city";

export type AipRevisionFeedbackMessage = {
  id: string;
  body: string;
  createdAt: string;
  authorName?: string | null;
  authorRole: "reviewer" | "barangay_official";
};

export type AipRevisionFeedbackCycle = {
  cycleId: string;
  reviewerRemark: AipRevisionFeedbackMessage;
  replies: AipRevisionFeedbackMessage[];
};

export type AipProcessingStage =
  | "extract"
  | "validate"
  | "scale_amounts"
  | "summarize"
  | "categorize"
  | "embed";

export type AipProcessingStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export type AipHeader = {
  id: string; // aipId
  scope: LguScope;
  barangayName?: string;

  title: string;
  description: string;
  year: number;
  budget: number;

  uploadedAt: string;
  publishedAt?: string;

  status: AipStatus;

  fileName: string;
  pdfUrl: string;
  tablePreviewUrl?: string;

  summaryText?: string;
  detailedBullets?: string[];

  sectors: string[];

  uploader: {
    name: string;
    role: string;
    uploadDate: string;
    budgetAllocated: number;
  };
  workflowPermissions?: {
    canManageBarangayWorkflow: boolean;
    lockReason?: string;
  };

  feedback?: string;
  publishedBy?: {
    reviewerId: string;
    reviewerName: string | null;
    createdAt: string;
  };
  revisionReply?: {
    body: string;
    createdAt: string;
    authorName?: string | null;
  };
  revisionFeedbackCycles?: AipRevisionFeedbackCycle[];
  processing?: {
    state: "processing" | "finalizing";
    overallProgressPct: number;
    message?: string | null;
    runId?: string;
    stage?: AipProcessingStage | null;
    status?: AipProcessingStatus | null;
  };
  embedding?: {
    runId: string;
    status: "queued" | "running" | "succeeded" | "failed";
    overallProgressPct?: number | null;
    progressMessage?: string | null;
    errorMessage?: string | null;
    updatedAt?: string | null;
  };
};

export type Sector =
  | "General Sector"
  | "Social Sector"
  | "Economic Sector"
  | "Other Services"
  | "Unknown";

export type ReviewStatus = "ai_flagged" | "reviewed" | "unreviewed";
// Back-compat type alias (some feature barrels re-export this name).
export type reviewStatus = ReviewStatus;
export type ProjectCategory = "health" | "infrastructure" | "other";
export type ProjectKind = ProjectCategory;

export type AipProjectEditableFields = {
  // Maps to public.projects.aip_ref_code
  aipRefCode: string;
  // Maps to public.projects.program_project_description
  programProjectDescription: string;
  // Maps to public.projects.implementing_agency
  implementingAgency: string | null;
  // Maps to public.projects.start_date
  startDate: string | null;
  // Maps to public.projects.completion_date
  completionDate: string | null;
  // Maps to public.projects.expected_output
  expectedOutput: string | null;
  // Maps to public.projects.source_of_funds
  sourceOfFunds: string | null;
  // Maps to public.projects.personal_services
  personalServices: number | null;
  // Maps to public.projects.maintenance_and_other_operating_expenses
  maintenanceAndOtherOperatingExpenses: number | null;
  // Maps to public.projects.financial_expenses
  financialExpenses: number | null;
  // Maps to public.projects.capital_outlay
  capitalOutlay: number | null;
  // Maps to public.projects.total
  total: number | null;
  // Maps to public.projects.climate_change_adaptation
  climateChangeAdaptation: string | null;
  // Maps to public.projects.climate_change_mitigation
  climateChangeMitigation: string | null;
  // Maps to public.projects.cc_topology_code
  ccTopologyCode: string | null;
  // Maps to public.projects.prm_ncr_lgu_rm_objective_results_indicator
  prmNcrLguRmObjectiveResultsIndicator: string | null;
  // Maps to public.projects.category
  category: ProjectCategory;
  // Maps to public.projects.errors
  errors: string[] | null;
};

/**
 * One row inside the AIP extracted table.
 * Connects to a project via projectRefCode.
 */
export type AipProjectRow = AipProjectEditableFields & {
  id: string; // row id
  aipId: string; // fk -> AipHeader.id

  // Compatibility aliases consumed by existing AIP/project UI.
  projectRefCode: string; // alias of aipRefCode
  kind: ProjectKind; // alias of category
  sector: Sector;
  amount: number; // alias of total
  reviewStatus: ReviewStatus;

  aipDescription: string; // alias of programProjectDescription

  aiIssues?: string[]; // alias of errors
  officialComment?: string;
};

export type AipProjectEditPatch = Partial<AipProjectEditableFields>;

export type AipProjectFeedbackMessage = {
  id: string;
  parentFeedbackId: string | null;
  kind: FeedbackKind;
  source: FeedbackSource;
  body: string;
  authorId: string | null;
  authorName: string | null;
  authorRole?: RoleType | null;
  createdAt: string;
  updatedAt: string;
};

export type AipProjectFeedbackThread = {
  root: AipProjectFeedbackMessage;
  replies: AipProjectFeedbackMessage[];
};

export type AipProjectReviewDetail = {
  project: AipProjectRow;
  feedbackThreads: AipProjectFeedbackThread[];
};

export type AipListItem = AipHeader;
export type AipDetail = AipHeader;

export type ListVisibleAipsInput = {
  visibility?: "public" | "my";
  scope?: LguScope;
};

export type SubmitReviewInput = {
  projectId: string;
  aipId: string;
  reason: string;
  changes?: AipProjectEditPatch;
  resolution?: "disputed" | "confirmed" | "comment_only";
};

export type CreateMockAipRepoOptions = {
  defaultScope?: LguScope;
};
