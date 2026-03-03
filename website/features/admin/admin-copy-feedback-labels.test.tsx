import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CommentRateLimitsCard from "@/features/admin/usage-controls/components/CommentRateLimitsCard";
import PublicFeedbackTable from "@/features/admin/feedback-moderation/components/PublicFeedbackTable";
import type { FeedbackModerationRow } from "@/lib/mappers/feedback-moderation";

const row: FeedbackModerationRow = {
  id: "feedback-1",
  kind: "question",
  commentPreview: "How is this project funded?",
  commentBody: "How is this project funded?",
  submittedByName: "Citizen A",
  submittedByEmail: "citizen@example.com",
  lguName: "Sample LGU",
  projectName: "Health Project",
  violationCategory: null,
  hiddenReason: null,
  status: "Visible",
  submittedDate: "2026-03-01T00:00:00.000Z",
  submittedDateLabel: "2026-03-01",
};

describe("admin feedback copy labels", () => {
  it("uses feedback wording for rate limit controls", () => {
    render(
      <CommentRateLimitsCard
        settings={{
          maxComments: 5,
          timeWindow: "hour",
          updatedAt: "2026-03-01T00:00:00.000Z",
          updatedBy: "Admin",
        }}
        loading={false}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText("Feedback Submission Limits")).toBeInTheDocument();
    expect(screen.getByText("Max Feedback")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Feedback Rate Limits" })).toBeInTheDocument();
    expect(screen.queryByText("Comment Submission Limits")).not.toBeInTheDocument();
  });

  it("uses feedback wording in moderation table labels", () => {
    render(
      <PublicFeedbackTable
        rows={[row]}
        onViewDetails={vi.fn()}
        onHide={vi.fn()}
        onUnhide={vi.fn()}
      />
    );

    expect(screen.getByText("Feedback Preview")).toBeInTheDocument();
    expect(screen.queryByText("Comment Preview")).not.toBeInTheDocument();
  });
});
