import {
  createFeedbackCategorySummary,
  isFeedbackCategorySummaryKey,
  type FeedbackCategorySummaryItem,
} from "@/lib/constants/feedback-category-summary";

export const FEEDBACK_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"] as const;

const CITIZEN_FEEDBACK_KIND_SET = new Set(["question", "suggestion", "concern", "commend"]);

export type LandingFeedbackMetricsRow = {
  id: string;
  target_type: "aip" | "project";
  aip_id: string | null;
  project_id: string | null;
  parent_feedback_id: string | null;
  kind: string;
  source: "human" | "ai";
  created_at: string;
};

export type FeedbackMetrics = {
  months: string[];
  series: Array<{ key: string; label: string; points: number[] }>;
  categorySummary: FeedbackCategorySummaryItem[];
  responseRate: number;
  avgResponseTimeDays: number;
};

export function buildFeedbackMetrics(input: {
  feedbackRows: LandingFeedbackMetricsRow[];
  selectedFiscalYear: number;
  previousFiscalYear: number;
  fiscalYearByAipId: Map<string, number>;
  aipIdByProjectId: Map<string, string>;
}): FeedbackMetrics {
  const currentSeries = [0, 0, 0, 0, 0, 0];
  const priorSeries = [0, 0, 0, 0, 0, 0];
  const lguReplyDateByParentId = new Map<string, Date>();
  const categoryCounts: Partial<Record<FeedbackCategorySummaryItem["key"], number>> = {};

  const fiscalYearByFeedbackId = new Map<string, number>();
  for (const row of input.feedbackRows) {
    let fiscalYear: number | null = null;
    if (row.target_type === "aip" && row.aip_id) {
      fiscalYear = input.fiscalYearByAipId.get(row.aip_id) ?? null;
    } else if (row.target_type === "project" && row.project_id) {
      const aipId = input.aipIdByProjectId.get(row.project_id) ?? null;
      if (aipId) {
        fiscalYear = input.fiscalYearByAipId.get(aipId) ?? null;
      }
    }

    if (typeof fiscalYear === "number") {
      fiscalYearByFeedbackId.set(row.id, fiscalYear);
    }

    if (row.parent_feedback_id && row.kind === "lgu_note" && fiscalYear !== null) {
      const replyDate = new Date(row.created_at);
      if (Number.isNaN(replyDate.getTime())) continue;
      const existing = lguReplyDateByParentId.get(row.parent_feedback_id);
      if (!existing || replyDate.getTime() < existing.getTime()) {
        lguReplyDateByParentId.set(row.parent_feedback_id, replyDate);
      }
    }
  }

  const currentRootCitizenRows: LandingFeedbackMetricsRow[] = [];

  for (const row of input.feedbackRows) {
    const fiscalYear = fiscalYearByFeedbackId.get(row.id);
    if (typeof fiscalYear !== "number") continue;

    const isCitizenKind = row.source === "human" && CITIZEN_FEEDBACK_KIND_SET.has(row.kind);
    if (!isCitizenKind) continue;

    if (row.parent_feedback_id !== null) continue;

    if (fiscalYear === input.selectedFiscalYear && isFeedbackCategorySummaryKey(row.kind)) {
      categoryCounts[row.kind] = (categoryCounts[row.kind] ?? 0) + 1;
    }

    const createdAt = new Date(row.created_at);
    if (Number.isNaN(createdAt.getTime())) continue;
    const monthIndex = createdAt.getUTCMonth();
    if (monthIndex < 0 || monthIndex >= FEEDBACK_MONTHS.length) continue;

    if (fiscalYear === input.selectedFiscalYear) {
      currentSeries[monthIndex] += 1;
      currentRootCitizenRows.push(row);
    } else if (fiscalYear === input.previousFiscalYear) {
      priorSeries[monthIndex] += 1;
    }
  }

  let respondedCount = 0;
  let totalResponseDays = 0;
  for (const root of currentRootCitizenRows) {
    const replyDate = lguReplyDateByParentId.get(root.id);
    if (!replyDate) continue;
    const rootDate = new Date(root.created_at);
    if (Number.isNaN(rootDate.getTime())) continue;
    const diffDays = Math.max(0, (replyDate.getTime() - rootDate.getTime()) / 86_400_000);
    respondedCount += 1;
    totalResponseDays += diffDays;
  }

  const responseRate =
    currentRootCitizenRows.length > 0
      ? Math.round((respondedCount / currentRootCitizenRows.length) * 100)
      : 0;
  const avgResponseTimeDays =
    respondedCount > 0 ? Number((totalResponseDays / respondedCount).toFixed(1)) : 0;

  return {
    months: [...FEEDBACK_MONTHS],
    series: [
      {
        key: String(input.previousFiscalYear),
        label: String(input.previousFiscalYear),
        points: priorSeries,
      },
      {
        key: String(input.selectedFiscalYear),
        label: String(input.selectedFiscalYear),
        points: currentSeries,
      },
    ],
    categorySummary: createFeedbackCategorySummary(categoryCounts),
    responseRate,
    avgResponseTimeDays,
  };
}
