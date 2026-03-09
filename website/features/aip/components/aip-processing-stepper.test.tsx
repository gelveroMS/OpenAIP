import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AipProcessingStepper,
  type ProcessingStep,
} from "./aip-processing-stepper";

function getConnectorFillPercent(): number {
  const fill = screen.getByTestId("processing-stepper-connector-fill");
  return Number.parseFloat(fill.style.width.replace("%", ""));
}

function buildSteps(overrides?: Partial<Record<string, Partial<ProcessingStep>>>): ProcessingStep[] {
  const defaults: ProcessingStep[] = [
    { key: "extract", label: "Extraction", status: "upcoming", progressPct: 0 },
    { key: "validate", label: "Validation", status: "upcoming", progressPct: 0 },
    { key: "scale_amounts", label: "Scaling amounts", status: "upcoming", progressPct: 0 },
    { key: "summarize", label: "Summarization", status: "upcoming", progressPct: 0 },
    { key: "categorize", label: "Categorization", status: "upcoming", progressPct: 0 },
  ];

  return defaults.map((step) => ({
    ...step,
    ...(overrides?.[step.key] ?? {}),
  }));
}

describe("AipProcessingStepper", () => {
  it("renders centered rail/grid classes and badge states", () => {
    const steps = buildSteps({
      extract: { status: "completed", progressPct: 100 },
      validate: { status: "active", progressPct: 25 },
    });

    render(<AipProcessingStepper steps={steps} />);

    expect(screen.getByText("Extraction")).toBeInTheDocument();
    expect(screen.getByText("Validation")).toBeInTheDocument();
    expect(screen.getByText("Scaling amounts")).toBeInTheDocument();
    expect(screen.getByText("Summarization")).toBeInTheDocument();
    expect(screen.getByText("Categorization")).toBeInTheDocument();

    const wrapper = screen.getByTestId("processing-stepper");
    const rail = screen.getByTestId("processing-stepper-rail");
    const grid = screen.getByTestId("processing-stepper-grid");
    expect(wrapper.className).toContain("w-full");
    expect(wrapper.className).toContain("overflow-x-auto");
    expect(rail.style.minWidth).toBe("900px");
    expect(rail.style.maxWidth).toBe("1100px");
    expect(grid.style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
    expect(grid.className).toContain("items-start");

    const completedBadge = screen.getByTestId("processing-step-badge-extract");
    const activeBadge = screen.getByTestId("processing-step-badge-validate");
    const upcomingBadge = screen.getByTestId("processing-step-badge-scale_amounts");
    expect(completedBadge.className).toContain("bg-[#0E5D6F]");
    expect(activeBadge.className).toContain("bg-[#0E5D6F]");
    expect(upcomingBadge.className).toContain("border-slate-200");

    expect(within(completedBadge).queryByText("1")).not.toBeInTheDocument();
    expect(within(activeBadge).getByText("2")).toBeInTheDocument();
    expect(within(upcomingBadge).getByText("3")).toBeInTheDocument();

    for (const key of ["extract", "validate", "scale_amounts", "summarize", "categorize"]) {
      const step = screen.getByTestId(`processing-step-${key}`);
      const progress = screen.getByTestId(`processing-step-progress-${key}`);
      expect(step.className).toContain("items-center");
      expect(progress.className).toContain("w-[180px]");
    }
  });

  it("fills connector partially when first step is active", () => {
    const steps = buildSteps({
      extract: { status: "active", progressPct: 25 },
    });

    render(<AipProcessingStepper steps={steps} />);

    expect(getConnectorFillPercent()).toBeCloseTo(6.25, 2);
  });

  it("fills connector based on completed + active segment progress", () => {
    const steps = buildSteps({
      extract: { status: "completed", progressPct: 100 },
      validate: { status: "active", progressPct: 40 },
    });

    render(<AipProcessingStepper steps={steps} />);

    expect(getConnectorFillPercent()).toBeCloseTo(35.0, 2);
  });

  it("fills connector completely when the last step is active", () => {
    const steps = buildSteps({
      extract: { status: "completed", progressPct: 100 },
      validate: { status: "completed", progressPct: 100 },
      scale_amounts: { status: "completed", progressPct: 100 },
      summarize: { status: "completed", progressPct: 100 },
      categorize: { status: "active", progressPct: 10 },
    });

    render(<AipProcessingStepper steps={steps} />);

    expect(getConnectorFillPercent()).toBe(100);
  });

  it("hides percent text when progressPct is not provided", () => {
    const steps = [
      { key: "extract", label: "Extraction", status: "active" as const },
      { key: "validate", label: "Validation", status: "upcoming" as const },
      { key: "scale_amounts", label: "Scaling amounts", status: "upcoming" as const },
      { key: "summarize", label: "Summarization", status: "upcoming" as const },
      { key: "categorize", label: "Categorization", status: "upcoming" as const },
    ];

    render(<AipProcessingStepper steps={steps} />);

    expect(screen.queryByText(/^\d+%$/)).not.toBeInTheDocument();
  });
});
