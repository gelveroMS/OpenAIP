import { describe, expect, it } from "vitest";
import {
  detectCompoundAsk,
  planQuery,
  shouldClarifyBeforeExecution,
  splitIntoSubAsks,
} from "@/lib/chat/query-planner";
import type { RouteDecision } from "@/lib/chat/router-decision";

describe("query planner", () => {
  it("detects compound asks with conjunctions", () => {
    expect(
      detectCompoundAsk("What is the total budget for FY 2026 and list top 5 projects?")
    ).toBe(true);
  });

  it("splits compound asks and caps sub-asks", () => {
    const parts = splitIntoSubAsks(
      "What is the total budget for FY 2026 and list top 5 projects and show fund sources?",
      2
    );

    expect(parts).toHaveLength(2);
    expect(parts[0]?.text.length).toBeGreaterThan(0);
    expect(parts[1]?.text.length).toBeGreaterThan(0);
  });

  it("returns single plan for non-compound ask", () => {
    const plan = planQuery("What is the total investment program for FY 2026?");
    expect(plan.isCompound).toBe(false);
    expect(plan.subAsks).toHaveLength(1);
  });

  it("asks clarify when mixed route kinds are detected", () => {
    const decisions: RouteDecision[] = [
      {
        kind: "SQL_TOTAL",
        confidence: 0.95,
        reasons: ["detected_total"],
        slots: {
          fiscalYear: 2026,
          aggregationIntent: "none",
          metadataIntent: "none",
          lineItemFact: false,
          lineItemSpecific: false,
          hasDomainCues: true,
        },
        missingSlots: [],
        candidates: [],
      },
      {
        kind: "ROW_LOOKUP",
        confidence: 0.9,
        reasons: ["detected_row"],
        slots: {
          fiscalYear: 2026,
          aggregationIntent: "none",
          metadataIntent: "none",
          lineItemFact: true,
          lineItemSpecific: true,
          hasDomainCues: true,
        },
        missingSlots: [],
        candidates: [],
      },
    ];

    expect(shouldClarifyBeforeExecution(decisions)).toBe(true);
  });
});
