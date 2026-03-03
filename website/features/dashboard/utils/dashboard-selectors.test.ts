import { describe, expect, it } from "vitest";
import type { DashboardFeedback } from "@/features/dashboard/types/dashboard-types";
import { selectFeedbackCategorySummary } from "./dashboard-selectors";

let feedbackId = 0;

function buildFeedback(
  overrides: Partial<DashboardFeedback> = {}
): DashboardFeedback {
  return {
    id: overrides.id ?? `feedback-${feedbackId += 1}`,
    targetType: overrides.targetType ?? "project",
    aipId: overrides.aipId ?? null,
    projectId: overrides.projectId ?? "project-1",
    parentFeedbackId: overrides.parentFeedbackId ?? null,
    kind: overrides.kind ?? "question",
    body: overrides.body ?? "Feedback body",
    createdAt: overrides.createdAt ?? "2026-03-03T00:00:00.000Z",
  };
}

describe("selectFeedbackCategorySummary", () => {
  it("counts only root citizen feedback kinds in the fixed display order", () => {
    const summary = selectFeedbackCategorySummary([
      buildFeedback({ id: "commend-1", kind: "commend" }),
      buildFeedback({ id: "commend-2", kind: "commend" }),
      buildFeedback({ id: "suggestion-1", kind: "suggestion" }),
      buildFeedback({ id: "concern-1", kind: "concern" }),
      buildFeedback({ id: "question-1", kind: "question" }),
      buildFeedback({ id: "question-2", kind: "question" }),
      buildFeedback({ id: "question-3", kind: "question" }),
      buildFeedback({
        id: "suggestion-reply",
        kind: "suggestion",
        parentFeedbackId: "question-1",
      }),
      buildFeedback({ id: "lgu-note", kind: "lgu_note" }),
    ]);

    expect(summary).toEqual([
      { key: "commend", label: "Commend", count: 2, percentage: 28.57 },
      { key: "suggestion", label: "Suggestion", count: 1, percentage: 14.29 },
      { key: "concern", label: "Concern", count: 1, percentage: 14.29 },
      { key: "question", label: "Question", count: 3, percentage: 42.86 },
    ]);
  });

  it("returns zeroed rows when there is no citizen feedback", () => {
    const summary = selectFeedbackCategorySummary([]);

    expect(summary).toEqual([
      { key: "commend", label: "Commend", count: 0, percentage: 0 },
      { key: "suggestion", label: "Suggestion", count: 0, percentage: 0 },
      { key: "concern", label: "Concern", count: 0, percentage: 0 },
      { key: "question", label: "Question", count: 0, percentage: 0 },
    ]);
  });
});
