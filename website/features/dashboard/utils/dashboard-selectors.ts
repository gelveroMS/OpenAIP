import type {
  AipStatus,
  PipelineStage,
  PipelineStatus,
  ProjectCategory,
} from "@/lib/contracts/databasev2/enums";
import {
  createFeedbackCategorySummary,
  isFeedbackCategorySummaryKey,
  type FeedbackCategorySummaryKey,
} from "@/lib/constants/feedback-category-summary";
import type {
  DashboardAip,
  DashboardData,
  DashboardFeedback,
  DashboardProject,
  DashboardRun,
  DashboardScope,
  DashboardSector,
  DashboardViewModel,
} from "@/features/dashboard/types/dashboard-types";
import { CITIZEN_FEEDBACK_KINDS } from "@/features/dashboard/types/dashboard-types";

const CITIZEN_KIND_SET = new Set<string>(CITIZEN_FEEDBACK_KINDS);

export function selectBudgetBySector(
  projects: DashboardProject[],
  sectors: DashboardSector[],
  displayTotalBudget?: number | null
): Array<{ sectorCode: string; label: string; amount: number; percentage: number }> {
  const totals = new Map<string, number>([
    ["general", 0],
    ["social", 0],
    ["economic", 0],
    ["other", 0],
  ]);
  const labelByCode = new Map(sectors.map((sector) => [sector.code, sector.label.toLowerCase()]));

  for (const project of projects) {
    const sectorLabel = labelByCode.get(project.sectorCode) ?? "";
    const key = sectorLabel.includes("general")
      ? "general"
      : sectorLabel.includes("social")
        ? "social"
        : sectorLabel.includes("economic")
          ? "economic"
          : "other";
    const amount = typeof project.total === "number" ? project.total : 0;
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }

  const grandTotal = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
  const denominator =
    typeof displayTotalBudget === "number" &&
    Number.isFinite(displayTotalBudget)
      ? displayTotalBudget
      : grandTotal;
  const bucketLabels = new Map<string, string>([
    ["general", "General"],
    ["social", "Social"],
    ["economic", "Economic"],
    ["other", "Other"],
  ]);
  const bucketOrder = new Map<string, number>([
    ["general", 0],
    ["social", 1],
    ["economic", 2],
    ["other", 3],
  ]);

  return Array.from(totals.entries())
    .map(([sectorCode, amount]) => ({
      sectorCode,
      label: bucketLabels.get(sectorCode) ?? sectorCode,
      amount,
      percentage: denominator > 0 ? (amount / denominator) * 100 : 0,
    }))
    .sort((left, right) => (bucketOrder.get(left.sectorCode) ?? 99) - (bucketOrder.get(right.sectorCode) ?? 99));
}

export function selectTopFunded(projects: DashboardProject[], limit = 10): DashboardProject[] {
  return [...projects]
    .sort((left, right) => {
      const leftAmount = left.total ?? Number.NEGATIVE_INFINITY;
      const rightAmount = right.total ?? Number.NEGATIVE_INFINITY;
      return rightAmount - leftAmount;
    })
    .slice(0, limit);
}

export function selectFeedbackCategorySummary(feedback: DashboardFeedback[]) {
  const counts: Partial<Record<FeedbackCategorySummaryKey, number>> = {};

  for (const item of feedback) {
    if (!CITIZEN_KIND_SET.has(item.kind)) continue;
    if (item.parentFeedbackId) continue;
    if (!isFeedbackCategorySummaryKey(item.kind)) continue;

    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  }

  return createFeedbackCategorySummary(counts);
}

function selectProjectsMissingTotal(projects: DashboardProject[]): number {
  return projects.filter((project) => project.total === null).length;
}

function selectProjectTotalBudget(projects: DashboardProject[]): number {
  return projects.reduce((sum, project) => sum + (project.total ?? 0), 0);
}

function selectAwaitingReplyCount(feedback: DashboardFeedback[]): number {
  const lguReplyParentIds = new Set(
    feedback
      .filter((item) => item.kind === "lgu_note" && item.parentFeedbackId)
      .map((item) => item.parentFeedbackId as string)
  );

  return feedback.filter((item) => {
    if (!CITIZEN_KIND_SET.has(item.kind)) return false;
    if (item.parentFeedbackId) return false;
    return !lguReplyParentIds.has(item.id);
  }).length;
}

function selectCitizenFeedbackCount(feedback: DashboardFeedback[]): number {
  return feedback.filter((item) => CITIZEN_KIND_SET.has(item.kind)).length;
}

function selectNewFeedbackThisWeek(feedback: DashboardFeedback[]): number {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - 6);

  return feedback.filter((item) => {
    if (!CITIZEN_KIND_SET.has(item.kind)) return false;
    return new Date(item.createdAt) >= since;
  }).length;
}

function selectLguNoteCount(feedback: DashboardFeedback[]): number {
  return feedback.filter((item) => item.kind === "lgu_note").length;
}

function selectFeedbackTargets(feedback: DashboardFeedback[]): Array<{ label: string; value: number }> {
  let aipCount = 0;
  let projectCount = 0;
  for (const item of feedback) {
    if (!CITIZEN_KIND_SET.has(item.kind)) continue;
    if (item.targetType === "aip") aipCount += 1;
    if (item.targetType === "project") projectCount += 1;
  }

  return [
    { label: "AIP", value: aipCount },
    { label: "Projects", value: projectCount },
  ];
}

function selectStatusDistribution(aips: DashboardAip[]): Array<{ status: AipStatus; count: number }> {
  const statuses: AipStatus[] = ["draft", "pending_review", "under_review", "for_revision", "published"];
  const counts = new Map<AipStatus, number>(statuses.map((status) => [status, 0]));

  for (const aip of aips) {
    counts.set(aip.status, (counts.get(aip.status) ?? 0) + 1);
  }

  return statuses.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

function selectPendingReviewAging(aips: DashboardAip[]): Array<{ bucket: string; count: number }> {
  const buckets = [
    { key: "0-3", min: 0, max: 3 },
    { key: "4-7", min: 4, max: 7 },
    { key: "8-14", min: 8, max: 14 },
    { key: "15+", min: 15, max: Number.POSITIVE_INFINITY },
  ];

  const counts = new Map<string, number>(buckets.map((bucket) => [bucket.key, 0]));
  const now = Date.now();

  for (const aip of aips) {
    if (aip.status !== "pending_review") continue;
    const updatedAt = new Date(aip.statusUpdatedAt).getTime();
    if (!Number.isFinite(updatedAt)) continue;
    const days = Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24));
    const targetBucket =
      buckets.find((bucket) => days >= bucket.min && days <= bucket.max) ?? buckets[buckets.length - 1];
    counts.set(targetBucket.key, (counts.get(targetBucket.key) ?? 0) + 1);
  }

  return buckets.map((bucket) => ({ bucket: bucket.key, count: counts.get(bucket.key) ?? 0 }));
}

function selectOldestPendingDays(aips: DashboardAip[]): number | null {
  const pending = aips
    .filter((aip) => aip.status === "pending_review")
    .map((aip) => new Date(aip.statusUpdatedAt).getTime())
    .filter((value) => Number.isFinite(value));
  if (!pending.length) return null;
  const oldest = Math.min(...pending);
  return Math.floor((Date.now() - oldest) / (1000 * 60 * 60 * 24));
}

function selectFailedPipelineStages(runs: DashboardRun[]): number {
  return runs.filter((run) => run.status === "failed").length;
}

function selectLatestFailedRun(runs: DashboardRun[]): DashboardRun | null {
  const failed = runs.filter((run) => run.status === "failed");
  if (!failed.length) return null;
  return [...failed].sort((left, right) => {
    const leftTime = new Date(left.startedAt ?? left.createdAt).getTime();
    const rightTime = new Date(right.startedAt ?? right.createdAt).getTime();
    return rightTime - leftTime;
  })[0] ?? null;
}

export function hasProjectErrors(errors: unknown): boolean {
  if (!errors) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === "object") return Object.keys(errors as Record<string, unknown>).length > 0;
  return false;
}

export function formatStageLabel(stage: PipelineStage): string {
  if (stage === "extract") return "Extract";
  if (stage === "validate") return "Validate";
  if (stage === "scale_amounts") return "Validate";
  if (stage === "summarize") return "Summarize";
  if (stage === "categorize") return "Categorize";
  return "Embed";
}

export function formatPipelineStatus(status: PipelineStatus): string {
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "succeeded") return "Succeeded";
  return "Failed";
}

function filterProjectsByGlobalSearch(projects: DashboardProject[], query: string): DashboardProject[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return projects;
  return projects.filter((project) => {
    const searchable = [project.programProjectDescription, project.aipRefCode, project.healthProgramName ?? ""]
      .join(" ")
      .toLowerCase();
    return searchable.includes(normalized);
  });
}

function filterTopFundedRows(
  rows: DashboardProject[],
  filters: { tableQuery: string; category: ProjectCategory | "all"; sectorCode: string | "all" }
): DashboardProject[] {
  const normalizedQuery = filters.tableQuery.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.category !== "all" && row.category !== filters.category) return false;
    if (filters.sectorCode !== "all" && row.sectorCode !== filters.sectorCode) return false;
    if (!normalizedQuery) return true;
    const haystack = [row.programProjectDescription, row.aipRefCode, row.healthProgramName ?? ""].join(" ").toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function selectWorkingOnItems(input: {
  scope: DashboardScope;
  selectedAip: DashboardAip | null;
  latestRuns: DashboardRun[];
  awaitingReplyCount: number;
}): Array<{ id: string; label: string; href: string }> {
  const base = input.scope === "city" ? "/city" : "/barangay";
  const items: Array<{ id: string; label: string; href: string }> = [];

  if (input.selectedAip?.status === "for_revision") {
    items.push({
      id: "for_revision",
      label: "Fix validation issues",
      href: input.selectedAip ? `${base}/aips/${input.selectedAip.id}` : `${base}/aips`,
    });
  }

  const failedRun = selectLatestFailedRun(input.latestRuns);
  if (failedRun) {
    items.push({
      id: "pipeline_failed",
      label: `Pipeline failed: ${formatStageLabel(failedRun.stage)}`,
      href: input.selectedAip ? `${base}/aips/${input.selectedAip.id}` : `${base}/aips`,
    });
  }

  if (input.awaitingReplyCount > 0) {
    items.push({
      id: "awaiting_reply",
      label: "Reply to citizen feedback",
      href: `${base}/feedback`,
    });
  }

  return items.slice(0, 3);
}

export function buildDashboardVm(input: {
  data: DashboardData;
  query: string;
  tableQuery: string;
  tableCategory: ProjectCategory | "all";
  tableSector: string | "all";
}): DashboardViewModel {
  const projects = filterProjectsByGlobalSearch(input.data.projects, input.query);
  const topFunded = selectTopFunded(projects, 10);
  const topFundedFiltered = filterTopFundedRows(topFunded, {
    tableQuery: input.tableQuery,
    category: input.tableCategory,
    sectorCode: input.tableSector,
  });

  const projectTotalBudget = selectProjectTotalBudget(projects);
  const selectedDisplayTotal = input.data.selectedAip?.totalInvestmentProgram;
  const totalBudget =
    typeof selectedDisplayTotal === "number" &&
    Number.isFinite(selectedDisplayTotal)
      ? selectedDisplayTotal <= 0
        ? selectedDisplayTotal
        : Math.max(selectedDisplayTotal, projectTotalBudget)
      : projectTotalBudget;
  const budgetBySector = selectBudgetBySector(projects, input.data.sectors, totalBudget);
  const missingTotalCount = selectProjectsMissingTotal(projects);

  const citizenFeedbackCount = selectCitizenFeedbackCount(input.data.feedback);
  const awaitingReplyCount = selectAwaitingReplyCount(input.data.feedback);

  return {
    projects,
    budgetBySector,
    totalBudget,
    missingTotalCount,
    topFundedFiltered,
    citizenFeedbackCount,
    awaitingReplyCount,
    feedbackCategorySummary: selectFeedbackCategorySummary(input.data.feedback),
    feedbackTargets: selectFeedbackTargets(input.data.feedback),
    statusDistribution: selectStatusDistribution(input.data.allAips),
    pendingReviewAging: selectPendingReviewAging(input.data.allAips),
    oldestPendingDays: selectOldestPendingDays(input.data.allAips),
    failedPipelineStages: selectFailedPipelineStages(input.data.latestRuns),
    newThisWeek: selectNewFeedbackThisWeek(input.data.feedback),
    lguNotesPosted: selectLguNoteCount(input.data.feedback),
    flaggedProjects: projects.filter((project) => hasProjectErrors(project.errors)).length,
    workingOnItems: selectWorkingOnItems({
      scope: input.data.scope,
      selectedAip: input.data.selectedAip,
      latestRuns: input.data.latestRuns,
      awaitingReplyCount,
    }),
    recentCitizenFeedback: input.data.feedback
      .filter((item) => CITIZEN_KIND_SET.has(item.kind))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 5),
  };
}
