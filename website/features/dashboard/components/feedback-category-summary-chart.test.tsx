import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeedbackCategorySummaryChart } from "@/components/chart";

describe("FeedbackCategorySummaryChart", () => {
  it("renders zero and full-width edge cases", () => {
    const { container } = render(
      <FeedbackCategorySummaryChart
        items={[
          { key: "commend", label: "Commend", count: 0, percentage: 0 },
          { key: "suggestion", label: "Suggestion", count: 0, percentage: 0 },
          { key: "concern", label: "Concern", count: 0, percentage: 0 },
          { key: "question", label: "Question", count: 9, percentage: 100 },
        ]}
        footerLabel="2026 Data"
      />
    );

    expect(screen.getByText("Feedback Category Summary")).toBeInTheDocument();
    expect(screen.getByText("Commend")).toBeInTheDocument();
    expect(screen.getByText("Suggestion")).toBeInTheDocument();
    expect(screen.getByText("Concern")).toBeInTheDocument();
    expect(screen.getByText("Question")).toBeInTheDocument();
    expect(screen.getAllByText("0.00")).toHaveLength(3);
    expect(screen.getByText("100.00")).toBeInTheDocument();
    expect(screen.getByText("2026 Data")).toBeInTheDocument();
    expect(container.querySelector('[style*="width: 100%"]')).not.toBeNull();
  });

  it("renders in dark tone without losing content", () => {
    render(
      <FeedbackCategorySummaryChart
        items={[
          { key: "commend", label: "Commend", count: 2, percentage: 25 },
          { key: "suggestion", label: "Suggestion", count: 2, percentage: 25 },
          { key: "concern", label: "Concern", count: 2, percentage: 25 },
          { key: "question", label: "Question", count: 2, percentage: 25 },
        ]}
        tone="dark"
      />
    );

    expect(screen.getByText("Feedback Category Summary")).toBeInTheDocument();
    expect(screen.getAllByText("25.00")).toHaveLength(4);
  });
});
