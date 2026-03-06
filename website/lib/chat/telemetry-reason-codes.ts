import type { ChatCitation, ChatRetrievalMeta } from "@/lib/repos/chat/types";

export type RouteFamily =
  | "sql_totals"
  | "aggregate_sql"
  | "row_sql"
  | "metadata_sql"
  | "pipeline_fallback"
  | "mixed_plan"
  | "conversational"
  | "unknown";

export function mapRewriteReasonCode(reason: string | null | undefined): string | undefined {
  if (!reason) return undefined;
  if (reason === "safe_year_follow_up") return "followup_year";
  if (reason === "safe_compare_follow_up") return "followup_compare";
  if (reason === "safe_citation_follow_up") return "followup_citation";
  if (reason === "safe_scope_follow_up") return "followup_scope_shift";
  if (reason === "standalone") return "no_rewrite_standalone";
  if (reason === "not_follow_up" || reason === "no_anchor") return "no_rewrite_non_domain";
  return reason;
}

export function mapPlannerReasonCode(input: {
  queryPlanMode?: ChatRetrievalMeta["queryPlanMode"];
  queryPlanClarificationRequired?: boolean;
  queryPlanDiagnostics?: string[];
}): string | undefined {
  const diagnostics = input.queryPlanDiagnostics ?? [];
  if (input.queryPlanClarificationRequired) {
    if (diagnostics.some((entry) => entry.includes("fiscal_year_pair"))) {
      return "clarify_missing_period";
    }
    if (diagnostics.some((entry) => entry.includes("scope"))) {
      return "clarify_missing_scope";
    }
    if (diagnostics.some((entry) => entry.includes("delta_cut_unsupported") || entry.includes("delta_increase_unsupported"))) {
      return "clarify_unsupported_structured_capability";
    }
  }

  if (input.queryPlanMode === "mixed") return "mixed_structured_and_semantic";
  if (input.queryPlanMode === "structured_only" || input.queryPlanMode === "semantic_only") {
    return "single_route_sufficient";
  }
  return undefined;
}

export function mapResponseModeReasonCode(meta: ChatRetrievalMeta): string {
  if (meta.status === "clarification") return "clarification_required";
  if (meta.status === "refusal" || meta.refused) return "refusal_returned";
  if (meta.mixedResponseMode === "partial" || meta.reason === "partial_evidence") {
    return "partial_answer";
  }
  return "full_answer";
}

export function mapVerifierReasonCode(meta: ChatRetrievalMeta): string | undefined {
  const mode = meta.verifierMode;
  const passed = meta.verifierPolicyPassed;
  if (mode === "structured") {
    return passed ? "structured_match" : "structured_mismatch";
  }
  if (mode === "retrieval") {
    return passed ? "narrative_grounded" : "narrative_ungrounded";
  }
  if (mode === "mixed") {
    return passed ? "mixed_pass" : "mixed_fail";
  }
  return undefined;
}

function citationMetadata(citation: ChatCitation): Record<string, unknown> {
  return citation.metadata && typeof citation.metadata === "object"
    ? (citation.metadata as Record<string, unknown>)
    : {};
}

function hasMetadataMarker(citations: ChatCitation[]): boolean {
  return citations.some((citation) => {
    if (citation.scopeName === "Structured SQL metadata route") return true;
    const metadata = citationMetadata(citation);
    return typeof metadata.metadata_intent === "string";
  });
}

function hasAggregationMarker(citations: ChatCitation[]): boolean {
  return citations.some((citation) => {
    const metadata = citationMetadata(citation);
    return typeof metadata.aggregate_type === "string";
  });
}

function hasTotalsMarker(citations: ChatCitation[]): boolean {
  return citations.some((citation) => {
    const metadata = citationMetadata(citation);
    if (metadata.type === "aip_total") return true;
    return (
      metadata.aggregation_source === "aip_totals_total_investment_program" &&
      typeof metadata.aggregate_type !== "string"
    );
  });
}

function hasRowMarker(citations: ChatCitation[]): boolean {
  return citations.some((citation) => {
    const metadata = citationMetadata(citation);
    return metadata.type === "aip_line_item" || typeof metadata.line_item_id === "string";
  });
}

export function inferRouteFamily(meta: ChatRetrievalMeta, citations: ChatCitation[]): RouteFamily {
  if (meta.queryPlanMode === "mixed") return "mixed_plan";
  if (meta.reason === "conversational_shortcut") return "conversational";
  if (meta.verifierMode === "retrieval") return "pipeline_fallback";

  if (
    meta.denseCandidateCount !== undefined ||
    meta.keywordCandidateCount !== undefined ||
    meta.fusedCandidateCount !== undefined ||
    meta.evidenceGateDecision !== undefined ||
    meta.selectiveMultiQueryTriggered !== undefined
  ) {
    return "pipeline_fallback";
  }

  if (hasMetadataMarker(citations)) return "metadata_sql";
  if (hasAggregationMarker(citations)) return "aggregate_sql";
  if (hasTotalsMarker(citations)) return "sql_totals";
  if (hasRowMarker(citations)) return "row_sql";

  return "unknown";
}

export function inferSemanticRetrievalAttempted(meta: ChatRetrievalMeta, citations: ChatCitation[]): boolean {
  if (meta.routeFamily === "pipeline_fallback") return true;
  if (meta.queryPlanMode === "mixed" && meta.mixedNarrativeIncluded) return true;

  if (
    meta.denseCandidateCount !== undefined ||
    meta.keywordCandidateCount !== undefined ||
    meta.fusedCandidateCount !== undefined ||
    meta.evidenceGateDecision !== undefined ||
    meta.selectiveMultiQueryTriggered !== undefined
  ) {
    return true;
  }

  return citations.some((citation) => citation.scopeType !== "system");
}
