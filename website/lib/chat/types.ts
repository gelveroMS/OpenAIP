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

export type RetrievalModePayload = "qa" | "overview";

export type RetrievalFiltersPayload = {
  fiscal_year?: number;
  scope_type?: "barangay" | "city" | "municipality";
  scope_name?: string;
  document_type?: string;
  publication_status?: string;
  office_name?: string;
  theme_tags?: string[];
  sector_tags?: string[];
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
  chunk_type?: string | null;
  document_type?: string | null;
  aip_id?: string | null;
  project_ref_code?: string | null;
  source_page?: number | null;
  fiscal_year?: number | null;
  scope_type?: "barangay" | "city" | "municipality" | "unknown" | "system";
  scope_id?: string | null;
  scope_name?: string | null;
  similarity?: number | null;
  snippet: string;
  insufficient?: boolean;
  metadata?: unknown | null;
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
      | "ambiguous_scope"
      | "pipeline_error"
      | "validation_failed"
      | "conversational_shortcut"
      | "unknown";
    intent?: string;
    classifier_confidence?: number;
    classifier_method?: "rule" | "llm" | "error";
    needs_retrieval?: boolean;
    entities?: Record<string, unknown>;
    route_hint?: string | null;
    status?: "answer" | "clarification" | "refusal";
    refusal_reason?: "unsupported_request" | string;
    route_family?:
      | "sql_totals"
      | "aggregate_sql"
      | "row_sql"
      | "metadata_sql"
      | "pipeline_fallback"
      | "mixed_plan"
      | "conversational"
      | "unknown";
    top_k?: number;
    min_similarity?: number;
    context_count?: number;
    scope_mode?: string;
    scope_targets_count?: number;
    retrieval_mode?: "qa" | "overview";
    applied_retrieval_filters?: Record<string, unknown>;
    retrieved_count?: number;
    strong_count?: number;
    selected_count?: number;
    diversity_selection_enabled?: boolean;
    dense_candidate_count?: number;
    keyword_candidate_count?: number;
    fused_candidate_count?: number;
    dense_final_count?: number;
    keyword_final_count?: number;
    dense_contributed_to_final?: boolean;
    keyword_contributed_to_final?: boolean;
    evidence_gate_decision?: "allow" | "clarify" | "refuse";
    evidence_gate_reason?: string;
    generation_skipped_by_gate?: boolean;
    multi_query_triggered?: boolean;
    multi_query_variant_count?: number;
    multi_query_reason?: string;
    evidence_gate_reason_code?: string;
    multi_query_reason_code?: string;
    active_rag_flags?: Record<string, boolean>;
    rag_calibration?: Record<string, number | boolean>;
    stage_latency_ms?: Record<string, number>;
    response_mode_source?: string;
  };
};
