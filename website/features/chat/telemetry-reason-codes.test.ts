import { describe, expect, it } from "vitest";
import {
  inferRouteFamily,
  inferSemanticRetrievalAttempted,
  mapPlannerReasonCode,
  mapResponseModeReasonCode,
  mapRewriteReasonCode,
  mapVerifierReasonCode,
} from "@/lib/chat/telemetry-reason-codes";
import type { ChatCitation, ChatRetrievalMeta } from "@/lib/repos/chat/types";

function baseMeta(overrides: Partial<ChatRetrievalMeta> = {}): ChatRetrievalMeta {
  return {
    refused: false,
    reason: "ok",
    status: "answer",
    verifierMode: "structured",
    verifierPolicyPassed: true,
    ...overrides,
  };
}

function citation(metadata: Record<string, unknown>, scopeName?: string): ChatCitation {
  return {
    sourceId: "S1",
    snippet: "snippet",
    scopeType: "system",
    scopeName,
    metadata,
  };
}

describe("telemetry reason codes", () => {
  it("maps rewrite reasons", () => {
    expect(mapRewriteReasonCode("safe_year_follow_up")).toBe("followup_year");
    expect(mapRewriteReasonCode("standalone")).toBe("no_rewrite_standalone");
    expect(mapRewriteReasonCode("not_follow_up")).toBe("no_rewrite_non_domain");
  });

  it("maps planner and response reason codes", () => {
    expect(
      mapPlannerReasonCode({
        queryPlanMode: "mixed",
        queryPlanClarificationRequired: false,
        queryPlanDiagnostics: [],
      })
    ).toBe("mixed_structured_and_semantic");

    expect(
      mapResponseModeReasonCode(baseMeta({ reason: "partial_evidence", mixedResponseMode: "partial" }))
    ).toBe("partial_answer");
  });

  it("maps verifier reason code from mode + pass status", () => {
    expect(mapVerifierReasonCode(baseMeta())).toBe("structured_match");
    expect(
      mapVerifierReasonCode(baseMeta({ verifierMode: "retrieval", verifierPolicyPassed: false }))
    ).toBe("narrative_ungrounded");
  });

  it("infers route family markers from citations and retrieval telemetry", () => {
    expect(
      inferRouteFamily(baseMeta(), [citation({ metadata_intent: "sector_list" }, "Structured SQL metadata route")])
    ).toBe("metadata_sql");

    expect(inferRouteFamily(baseMeta(), [citation({ aggregate_type: "top_projects" })])).toBe(
      "aggregate_sql"
    );

    expect(
      inferRouteFamily(baseMeta(), [citation({ type: "aip_total" })])
    ).toBe("sql_totals");

    expect(
      inferRouteFamily(baseMeta(), [citation({ type: "aip_line_item", line_item_id: "l1" })])
    ).toBe("row_sql");

    expect(
      inferRouteFamily(baseMeta({ denseCandidateCount: 12, evidenceGateDecision: "allow" }), [])
    ).toBe("pipeline_fallback");

    expect(
      inferRouteFamily(baseMeta({ verifierMode: "retrieval" }), [])
    ).toBe("pipeline_fallback");

    expect(inferRouteFamily(baseMeta(), [])).toBe("unknown");
  });

  it("marks semantic retrieval attempted when retrieval signals are present", () => {
    expect(
      inferSemanticRetrievalAttempted(baseMeta({ routeFamily: "pipeline_fallback" }), [])
    ).toBe(true);

    expect(
      inferSemanticRetrievalAttempted(baseMeta({ queryPlanMode: "mixed", mixedNarrativeIncluded: true }), [])
    ).toBe(true);

    expect(
      inferSemanticRetrievalAttempted(baseMeta({ denseCandidateCount: 2 }), [])
    ).toBe(true);

    expect(inferSemanticRetrievalAttempted(baseMeta(), [])).toBe(false);
  });
});
