import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeedbackCard } from "./feedback-card";
import type { ProjectFeedbackItem } from "./feedback.types";

function buildItem(overrides?: Partial<ProjectFeedbackItem>): ProjectFeedbackItem {
  return {
    id: "fb-1",
    projectId: "project-1",
    parentFeedbackId: null,
    kind: "lgu_note",
    body: "This comment has been hidden due to policy violation.",
    createdAt: "2026-03-01T00:00:00.000Z",
    author: {
      id: "user-1",
      fullName: "Official User",
      role: "barangay_official",
      roleLabel: "Barangay Official",
      lguLabel: "Brgy. Sample",
    },
    ...overrides,
  };
}

describe("FeedbackCard", () => {
  it("does not render LGU Note badge", () => {
    render(
      <FeedbackCard
        item={buildItem({ isHidden: false })}
        onReply={vi.fn()}
      />
    );

    expect(screen.queryByText("LGU Note")).not.toBeInTheDocument();
  });

  it("renders subtle hidden styling markers for hidden comments", () => {
    render(
      <FeedbackCard
        item={buildItem({ isHidden: true })}
        onReply={vi.fn()}
      />
    );

    expect(screen.getByText("Hidden comment")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Reply to feedback from Official User/i })
    ).not.toBeInTheDocument();
    const card = screen
      .getByText("This comment has been hidden due to policy violation.")
      .closest("article");
    expect(card).toHaveAttribute("data-hidden-comment", "true");
  });

  it("hides reply button for nested feedback items", () => {
    render(
      <FeedbackCard
        item={buildItem({
          kind: "question",
          isHidden: false,
          parentFeedbackId: "root-1",
          body: "Nested feedback",
          author: {
            id: "user-2",
            fullName: "Nested User",
            role: "citizen",
            roleLabel: "Citizen",
            lguLabel: "Brgy. Nested",
          },
        })}
        onReply={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /Reply to feedback from Nested User/i })).not.toBeInTheDocument();
  });
});
