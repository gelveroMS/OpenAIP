import { describe, expect, it } from "vitest";
import { createFeedbackCategorySummary } from "@/lib/constants/feedback-category-summary";
import {
  buildFeedbackMetrics,
  type LandingFeedbackMetricsRow,
} from "@/lib/repos/landing-content/feedback-metrics";

let feedbackCounter = 0;

function buildFeedbackRow(
  overrides: Partial<LandingFeedbackMetricsRow> = {}
): LandingFeedbackMetricsRow {
  return {
    id: overrides.id ?? `feedback-${(feedbackCounter += 1)}`,
    target_type: overrides.target_type ?? "aip",
    aip_id: overrides.aip_id ?? "aip-2026",
    project_id: overrides.project_id ?? null,
    parent_feedback_id: overrides.parent_feedback_id ?? null,
    kind: overrides.kind ?? "question",
    source: overrides.source ?? "human",
    created_at: overrides.created_at ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("buildFeedbackMetrics", () => {
  it("includes Jul-Dec feedback in selected FY category summary while keeping Jan-Jun series window", () => {
    const metrics = buildFeedbackMetrics({
      feedbackRows: [
        buildFeedbackRow({
          id: "fy26-jan-suggestion",
          kind: "suggestion",
          created_at: "2026-01-10T08:00:00.000Z",
        }),
        buildFeedbackRow({
          id: "fy26-jul-question",
          kind: "question",
          created_at: "2026-07-12T08:00:00.000Z",
        }),
        buildFeedbackRow({
          id: "fy26-dec-commend",
          kind: "commend",
          target_type: "project",
          aip_id: null,
          project_id: "project-2026",
          created_at: "2026-12-03T08:00:00.000Z",
        }),
        buildFeedbackRow({
          id: "fy25-feb-concern",
          kind: "concern",
          aip_id: "aip-2025",
          created_at: "2025-02-15T08:00:00.000Z",
        }),
      ],
      selectedFiscalYear: 2026,
      previousFiscalYear: 2025,
      fiscalYearByAipId: new Map([
        ["aip-2026", 2026],
        ["aip-2025", 2025],
      ]),
      aipIdByProjectId: new Map([["project-2026", "aip-2026"]]),
    });

    expect(metrics.categorySummary).toEqual(
      createFeedbackCategorySummary({
        commend: 1,
        suggestion: 1,
        concern: 0,
        question: 1,
      })
    );
    expect(metrics.series[0]).toEqual({
      key: "2025",
      label: "2025",
      points: [0, 1, 0, 0, 0, 0],
    });
    expect(metrics.series[1]).toEqual({
      key: "2026",
      label: "2026",
      points: [1, 0, 0, 0, 0, 0],
    });
  });

  it("excludes replies, lgu_note, and non-human rows and preserves fixed order with zero-filled categories", () => {
    const metrics = buildFeedbackMetrics({
      feedbackRows: [
        buildFeedbackRow({
          id: "root-concern",
          kind: "concern",
          created_at: "2026-03-03T08:00:00.000Z",
        }),
        buildFeedbackRow({
          id: "reply-citizen-kind",
          kind: "suggestion",
          parent_feedback_id: "root-concern",
          created_at: "2026-03-04T08:00:00.000Z",
        }),
        buildFeedbackRow({
          id: "root-lgu-note",
          kind: "lgu_note",
          created_at: "2026-03-04T08:00:00.000Z",
        }),
        buildFeedbackRow({
          id: "root-ai-question",
          kind: "question",
          source: "ai",
          created_at: "2026-03-05T08:00:00.000Z",
        }),
      ],
      selectedFiscalYear: 2026,
      previousFiscalYear: 2025,
      fiscalYearByAipId: new Map([["aip-2026", 2026]]),
      aipIdByProjectId: new Map(),
    });

    expect(metrics.categorySummary).toEqual(
      createFeedbackCategorySummary({
        concern: 1,
      })
    );
    expect(metrics.categorySummary.map((item) => item.key)).toEqual([
      "commend",
      "suggestion",
      "concern",
      "question",
    ]);
  });
});
