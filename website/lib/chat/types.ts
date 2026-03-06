export type RetrievalScopeMode = "global" | "own_barangay" | "named_scopes";

export type RetrievalScopeTarget = {
  scope_type: "barangay" | "city" | "municipality";
  scope_id: string;
  scope_name: string;
};

export type RetrievalScopePayload = {
  mode: RetrievalScopeMode;
  targets: RetrievalScopeTarget[];
};

export type ScopeResolutionResult = {
  mode: RetrievalScopeMode | "ambiguous";
  requestedScopes: Array<{
    scopeType: "barangay" | "city" | "municipality";
    scopeName: string;
  }>;
  resolvedTargets: Array<{
    scopeType: "barangay" | "city" | "municipality";
    scopeId: string;
    scopeName: string;
  }>;
  unresolvedScopes: string[];
  ambiguousScopes: Array<{ scopeName: string; candidateCount: number }>;
};

export type PipelineChatCitation = {
  source_id: string;
  chunk_id?: string | null;
  aip_id?: string | null;
  fiscal_year?: number | null;
  scope_type?: "barangay" | "city" | "municipality" | "unknown" | "system";
  scope_id?: string | null;
  scope_name?: string | null;
  similarity?: number | null;
  snippet: string;
  insufficient?: boolean;
  metadata?: unknown | null;
};

export type PipelineIntentType =
  | "GREETING"
  | "THANKS"
  | "COMPLAINT"
  | "CLARIFY"
  | "TOTAL_AGGREGATION"
  | "CATEGORY_AGGREGATION"
  | "LINE_ITEM_LOOKUP"
  | "PROJECT_DETAIL"
  | "DOCUMENT_EXPLANATION"
  | "OUT_OF_SCOPE"
  | "SCOPE_NEEDS_CLARIFICATION"
  | "UNKNOWN";

export type PipelineIntentClassification = {
  intent: PipelineIntentType;
  confidence: number;
  top2_intent: PipelineIntentType | null;
  top2_confidence: number | null;
  margin: number;
  method: "rule" | "semantic" | "none";
};

export type PipelineChatAnswer = {
  answer: string;
  refused: boolean;
  citations: PipelineChatCitation[];
  retrieval_meta: {
    reason:
      | "ok"
      | "insufficient_evidence"
      | "partial_evidence"
      | "verifier_failed"
      | "ambiguous_scope"
      | "pipeline_error"
      | "validation_failed"
      | "unknown";
    top_k?: number;
    min_similarity?: number;
    context_count?: number;
    verifier_passed?: boolean;
    scope_mode?: string;
    scope_targets_count?: number;
    verifier_mode?: "structured" | "retrieval" | "mixed";
    verifier_policy_passed?: boolean;
    retrieved_count?: number;
    strong_count?: number;
    selected_count?: number;
    diversity_selection_enabled?: boolean;
  };
};
