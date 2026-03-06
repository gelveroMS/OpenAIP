import { describe, expect, it } from "vitest";
import { buildQueryPlan } from "@/lib/chat/query-plan-builder";

describe("query plan builder", () => {
  it("classifies totals ask as structured_only", () => {
    const plan = buildQueryPlan({
      text: "What is the total health budget for 2024?",
      intentClassification: null,
    });
    expect(plan.mode).toBe("structured_only");
    expect(plan.structuredTasks.length).toBeGreaterThan(0);
    expect(plan.semanticTasks).toHaveLength(0);
  });

  it("classifies doc ask as semantic_only", () => {
    const plan = buildQueryPlan({
      text: "What does the AIP say about flood control?",
      intentClassification: null,
    });
    expect(plan.mode).toBe("semantic_only");
    expect(plan.structuredTasks).toHaveLength(0);
    expect(plan.semanticTasks.length).toBeGreaterThan(0);
  });

  it("classifies compare plus explain as mixed", () => {
    const plan = buildQueryPlan({
      text: "Compare the total investment program in 2024 vs 2025, then explain what projects drove the change with citations.",
      intentClassification: null,
    });
    expect(plan.mode).toBe("mixed");
    expect(
      plan.structuredTasks.some(
        (task) => task.routeKind === "SQL_AGG" || task.routeKind === "SQL_TOTAL"
      )
    ).toBe(true);
    expect(plan.semanticTasks.length).toBeGreaterThan(0);
  });

  it("classifies this-year vs last-year compare plus explain as mixed", () => {
    const plan = buildQueryPlan({
      text: "Compare infrastructure spending this year and last year, then explain what projects drove the change with citations.",
      intentClassification: null,
    });

    expect(plan.mode).toBe("mixed");
    expect(plan.structuredTasks.some((task) => task.routeKind === "SQL_AGG")).toBe(true);
    expect(plan.semanticTasks.length).toBeGreaterThan(0);
    expect(plan.clarificationRequired).toBe(false);
  });

  it("classifies top plus summarize as mixed", () => {
    const plan = buildQueryPlan({
      text: "Show the top 5 projects in 2025 and summarize what the AIP says about each.",
      intentClassification: null,
    });
    expect(plan.mode).toBe("mixed");
    expect(plan.structuredTasks.some((task) => task.routeKind === "SQL_AGG")).toBe(true);
    expect(plan.semanticTasks.length).toBeGreaterThan(0);
  });

  it("does not over-decompose simple semantic asks", () => {
    const plan = buildQueryPlan({
      text: "Explain the drainage project with citations.",
      intentClassification: null,
    });
    expect(plan.mode).toBe("semantic_only");
    expect(plan.structuredTasks).toHaveLength(0);
    expect(plan.semanticTasks).toHaveLength(1);
  });

  it("recovers comparison frame from immediate recent domain context only", () => {
    const plan = buildQueryPlan({
      text: "What sectors increased and why?",
      intentClassification: null,
      recentDomainContext: {
        lastDomainUserQuery: "Compare sector totals in FY 2024 vs FY 2025.",
        lastDomainAssistantAnswer: "Compared sector totals for FY 2024 vs FY 2025.",
        source: "last_domain_turn",
      },
    });

    expect(plan.mode).toBe("mixed");
    expect(plan.clarificationRequired).toBe(false);
    expect(plan.diagnostics.some((entry) => entry.startsWith("comparison_frame_recovered:"))).toBe(
      true
    );
  });

  it("clarifies when comparison frame is missing and not recoverable", () => {
    const plan = buildQueryPlan({
      text: "What sectors increased and why?",
      intentClassification: null,
      recentDomainContext: {
        lastDomainUserQuery: null,
        lastDomainAssistantAnswer: null,
        source: "none",
      },
    });

    expect(plan.mode).toBe("mixed");
    expect(plan.clarificationRequired).toBe(true);
    expect(plan.structuredTasks[0]?.missingSlots).toContain("fiscal_year_pair");
  });

  it("marks unsupported projects-cut structured task and semantic dependency", () => {
    const plan = buildQueryPlan({
      text: "Which projects were cut, and what does the AIP say about them?",
      intentClassification: null,
      recentDomainContext: {
        lastDomainUserQuery: "Compare totals in FY 2024 vs FY 2025.",
        lastDomainAssistantAnswer: "Compared FY 2024 vs FY 2025.",
        source: "last_domain_turn",
      },
    });

    expect(plan.mode).toBe("mixed");
    expect(plan.structuredTasks[0]?.capabilityHint).toBe("delta_cut_unsupported");
    expect(plan.semanticTasks[0]?.dependsOnStructuredTaskIds?.length).toBeGreaterThan(0);
    expect(plan.semanticTasks[0]?.independentIfStructuredUnsupported).toBe(false);
  });

  it("keeps semantic independent when explicitly separate from unsupported structured ask", () => {
    const plan = buildQueryPlan({
      text: "Which projects were cut, and separately explain drainage policy with citations.",
      intentClassification: null,
      recentDomainContext: {
        lastDomainUserQuery: "Compare totals in FY 2024 vs FY 2025.",
        lastDomainAssistantAnswer: "Compared FY 2024 vs FY 2025.",
        source: "last_domain_turn",
      },
    });

    expect(plan.mode).toBe("mixed");
    expect(plan.structuredTasks[0]?.capabilityHint).toBe("delta_cut_unsupported");
    expect(plan.semanticTasks[0]?.dependsOnStructuredTaskIds).toEqual([]);
    expect(plan.semanticTasks[0]?.independentIfStructuredUnsupported).toBe(true);
  });
});
