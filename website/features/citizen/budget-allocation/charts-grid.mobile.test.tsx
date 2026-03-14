import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ChartsGrid from "./components/charts-grid";

describe("ChartsGrid mobile layout", () => {
  it("keeps compact mobile chart spacing and donut chart height classes", () => {
    const { container } = render(
      <ChartsGrid
        fiscalYear={2026}
        totalBudget={5_509_600_000}
        sectors={[
          { key: "general", label: "General Services", amount: 2_500_000_000, color: "#3B82F6" },
          { key: "social", label: "Social Services", amount: 1_800_000_000, color: "#14B8A6" },
          { key: "economic", label: "Economic Services", amount: 900_000_000, color: "#22C55E" },
          { key: "other", label: "Other Services", amount: 309_600_000, color: "#F59E0B" },
        ]}
        trendSubtitle="Shows budget trends from 2020-2026"
        trendData={[
          { year: 2025, general: 1, social: 2, economic: 3, other: 4 },
          { year: 2026, general: 2, social: 3, economic: 4, other: 5 },
        ]}
      />
    );

    const wrapper = container.querySelector("section");
    expect(wrapper?.className).toContain("px-3");
    expect(wrapper?.className).toContain("md:px-6");

    expect(screen.getByText("Annual Budget Allocation Overview")).toBeInTheDocument();
    const chartBoxes = Array.from(container.querySelectorAll("div"));
    const chartBox = chartBoxes.find(
      (node) =>
        node.className.includes("h-48") &&
        node.className.includes("sm:h-56") &&
        node.className.includes("md:h-60")
    );
    expect(chartBox).toBeDefined();
  });
});
