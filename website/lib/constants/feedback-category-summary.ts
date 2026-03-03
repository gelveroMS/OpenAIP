import type { FeedbackKind } from "@/lib/contracts/databasev2";

export const FEEDBACK_CATEGORY_SUMMARY_ORDER = [
  "commend",
  "suggestion",
  "concern",
  "question",
] as const satisfies readonly FeedbackKind[];

export type FeedbackCategorySummaryKey = (typeof FEEDBACK_CATEGORY_SUMMARY_ORDER)[number];

export type FeedbackCategorySummaryItem = {
  key: FeedbackCategorySummaryKey;
  label: string;
  count: number;
  percentage: number;
};

export const FEEDBACK_CATEGORY_SUMMARY_META: Record<
  FeedbackCategorySummaryKey,
  { label: string; color: string }
> = {
  commend: {
    label: "Commend",
    color: "#00BC7D",
  },
  suggestion: {
    label: "Suggestion",
    color: "#2B7FFF",
  },
  concern: {
    label: "Concern",
    color: "#FB2C36",
  },
  question: {
    label: "Question",
    color: "#AD46FF",
  },
};

export function isFeedbackCategorySummaryKey(value: string): value is FeedbackCategorySummaryKey {
  return (FEEDBACK_CATEGORY_SUMMARY_ORDER as readonly string[]).includes(value);
}

export function createFeedbackCategorySummary(
  counts: Partial<Record<FeedbackCategorySummaryKey, number>>
): FeedbackCategorySummaryItem[] {
  const total = FEEDBACK_CATEGORY_SUMMARY_ORDER.reduce((sum, key) => {
    const value = counts[key];
    return sum + (typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0);
  }, 0);

  return FEEDBACK_CATEGORY_SUMMARY_ORDER.map((key) => {
    const rawCount = counts[key];
    const count =
      typeof rawCount === "number" && Number.isFinite(rawCount) ? Math.max(0, rawCount) : 0;

    return {
      key,
      label: FEEDBACK_CATEGORY_SUMMARY_META[key].label,
      count,
      percentage: total > 0 ? Number(((count / total) * 100).toFixed(2)) : 0,
    };
  });
}
