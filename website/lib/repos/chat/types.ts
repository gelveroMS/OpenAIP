import type { ChatMessageRole } from "@/lib/contracts/databasev2";
import type { PipelineIntentClassification } from "@/lib/chat/types";

export type { ChatMessageRole };

export type ChatCitationScopeType =
  | "barangay"
  | "city"
  | "municipality"
  | "unknown"
  | "system";

export type ChatResponseStatus = "answer" | "clarification" | "refusal";

export type RefusalReason =
  | "retrieval_failure"
  | "document_limitation"
  | "ambiguous_scope"
  | "missing_required_parameter"
  | "unsupported_request";

export type ChatClarificationOption = {
  optionIndex: number;
  lineItemId: string;
  title: string;
  refCode: string | null;
  fiscalYear: number | null;
  barangayName: string | null;
  total: string | null;
};

export type ChatCityFallbackClarificationOption = {
  optionIndex: number;
  action: "use_barangays_in_city" | "cancel";
  label: string;
};

export type ChatClarificationPayload =
  | {
      id: string;
      kind: "line_item_disambiguation";
      prompt: string;
      options: ChatClarificationOption[];
    }
  | {
      id: string;
      kind: "city_aip_missing_fallback";
      prompt: string;
      options: ChatCityFallbackClarificationOption[];
    };

export type AggregationIntentType =
  | "top_projects"
  | "totals_by_sector"
  | "totals_by_fund_source"
  | "compare_years";

export type AggregationLogIntentType =
  | "aggregate_top_projects"
  | "aggregate_totals_by_sector"
  | "aggregate_totals_by_fund_source"
  | "aggregate_compare_years";

export type ChatClarificationContextLineItem = {
  factFields: string[];
  scopeReason: string;
  barangayName: string | null;
};

export type ChatClarificationContextCityFallback = {
  cityId: string;
  cityName: string;
  fiscalYearParsed: number | null;
  // Backward compatibility for older persisted clarification payloads.
  fiscalYear?: number | null;
  originalIntent:
    | "total_investment_program"
    | AggregationLogIntentType
    | AggregationIntentType;
  limit?: number | null;
  yearA?: number | null;
  yearB?: number | null;
  listOnly?: boolean;
};

export type ChatCitation = {
  sourceId: string;
  chunkId?: string | null;
  aipId?: string | null;
  fiscalYear?: number | null;
  scopeType?: ChatCitationScopeType;
  scopeId?: string | null;
  scopeName?: string | null;
  similarity?: number | null;
  distance?: number | null;
  matchScore?: number | null;
  snippet: string;
  insufficient?: boolean;
  metadata?: unknown | null;
};

export type ChatScopeResolutionMode =
  | "global"
  | "own_barangay"
  | "named_scopes"
  | "ambiguous"
  | "unresolved";

export type ChatScopeResolution = {
  mode: ChatScopeResolutionMode;
  requestedScopes: Array<{
    scopeType: "barangay" | "city" | "municipality";
    scopeName: string;
  }>;
  resolvedTargets: Array<{
    scopeType: "barangay" | "city" | "municipality";
    scopeId: string;
    scopeName: string;
  }>;
  unresolvedScopes?: string[];
  ambiguousScopes?: Array<{ scopeName: string; candidateCount: number }>;
};

export type ChatRetrievalMeta = {
  refused: boolean;
  reason:
    | "ok"
    | "insufficient_evidence"
    | "partial_evidence"
    | "clarification_needed"
    | "verifier_failed"
    | "ambiguous_scope"
    | "pipeline_error"
    | "validation_failed"
    | "conversational_shortcut"
    | "unknown";
  topK?: number;
  minSimilarity?: number;
  contextCount?: number;
  verifierPassed?: boolean;
  scopeResolution?: ChatScopeResolution;
  latencyMs?: number;
  status?: ChatResponseStatus;
  refusalReason?: RefusalReason;
  refusalDetail?: string;
  suggestions?: string[];
  kind?: "clarification" | "clarification_resolved";
  clarification?: ChatClarificationPayload & {
    context?: ChatClarificationContextLineItem | ChatClarificationContextCityFallback;
  };
  clarificationResolution?: {
    clarificationId: string;
    selectedLineItemId: string;
  };
  scopeReason?: string;
  fallbackContext?: {
    mode: "barangays_in_city";
    cityId: string;
    cityName: string;
    barangayIdsCount: number;
    coverageBarangays: string[];
    aggregationSource: string;
  };
  intentClassification?: PipelineIntentClassification;
  verifierMode?: "structured" | "retrieval" | "mixed";
  verifierPolicyPassed?: boolean;
  denseCandidateCount?: number;
  keywordCandidateCount?: number;
  fusedCandidateCount?: number;
  denseFinalCount?: number;
  keywordFinalCount?: number;
  denseContributedToFinal?: boolean;
  keywordContributedToFinal?: boolean;
  evidenceGateDecision?: "allow" | "clarify" | "refuse";
  evidenceGateReason?: string;
  evidenceGateReasonCode?: string;
  generationSkippedByGate?: boolean;
  queryRewriteApplied?: boolean;
  queryRewriteReason?: string;
  queryPlanMode?: "structured_only" | "semantic_only" | "mixed";
  queryPlanStructuredTaskCount?: number;
  queryPlanSemanticTaskCount?: number;
  queryPlanClarificationRequired?: boolean;
  queryPlanDiagnostics?: string[];
  semanticConditioningApplied?: boolean;
  semanticConditioningHintCount?: number;
  mixedResponseMode?: "full" | "partial" | "clarify" | "refuse";
  mixedNarrativeIncluded?: boolean;
  selectiveMultiQueryTriggered?: boolean;
  selectiveMultiQueryVariantCount?: number;
  multiQueryReasonCode?: string;
  activeRagFlags?: Record<string, boolean>;
  ragCalibration?: Record<string, number | boolean>;
  routeFamily?:
    | "sql_totals"
    | "aggregate_sql"
    | "row_sql"
    | "metadata_sql"
    | "pipeline_fallback"
    | "mixed_plan"
    | "conversational"
    | "unknown";
  rewriteReasonCode?: string;
  plannerReasonCode?: string;
  responseModeReasonCode?: string;
  verifierPolicyReasonCode?: string;
  responseModeSource?: "pipeline_generated" | "pipeline_partial" | "pipeline_refusal" | "website_repeat_cache";
  semanticStabilityKey?: string;
  responseStabilizedFromCache?: boolean;
  semanticRepeatCacheHit?: boolean;
  borderlineDetected?: boolean;
  borderlineReasonCode?: string;
  clarificationEmitted?: boolean;
  refusalEmitted?: boolean;
  activeChatFlags?: Record<string, boolean>;
  chatStrategyCalibration?: {
    rewrite_max_user_turns: number;
    rewrite_max_assistant_turns: number;
    mixed_max_structured_tasks: number;
    mixed_max_semantic_tasks: number;
  };
  stageLatencyMs?: Record<string, number>;
  semanticRetrievalAttempted?: boolean;
};

export const ChatRepoErrors = {
  FORBIDDEN: "FORBIDDEN",
  INVALID_ROLE: "INVALID_ROLE",
  NOT_FOUND: "NOT_FOUND",
  INVALID_CONTENT: "INVALID_CONTENT",
} as const;

export type ChatSession = {
  id: string;
  userId: string;
  title?: string | null;
  context: unknown;
  lastMessageAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
  citations?: ChatCitation[] | null;
  retrievalMeta?: ChatRetrievalMeta | null;
};

