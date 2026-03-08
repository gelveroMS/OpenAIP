import type { RouteKind } from "@/lib/chat/router-decision";

export type QueryPlanMode = "structured_only" | "semantic_only" | "mixed";

export type QueryPlanStructuredTaskKind =
  | "totals"
  | "aggregation"
  | "line_item"
  | "metadata";

export type QueryPlanSemanticTaskKind = "narrative";

export type QueryPlanResponseMode = "full" | "partial" | "clarify" | "refuse";

export type QueryPlanMissingSlot = "scope" | "fiscal_year_pair";

export type QueryPlanStructuredTask = {
  id: string;
  kind: QueryPlanStructuredTaskKind;
  routeKind: Extract<RouteKind, "SQL_TOTAL" | "SQL_AGG" | "ROW_LOOKUP" | "SQL_METADATA">;
  subquery: string;
  fiscalYear: number | null;
  missingSlots: QueryPlanMissingSlot[];
  capabilityHint?: "standard" | "delta_cut_unsupported" | "delta_increase_unsupported";
};

export type QueryPlanSemanticTask = {
  id: string;
  kind: QueryPlanSemanticTaskKind;
  subquery: string;
  requiresCitations: boolean;
  dependsOnStructuredTaskIds?: string[];
  independentIfStructuredUnsupported?: boolean;
};

export type QueryPlanRecentDomainContext = {
  lastDomainUserQuery: string | null;
  lastDomainAssistantAnswer: string | null;
  source: "last_domain_turn" | "rewrite_context" | "none";
};

export type QueryPlan = {
  mode: QueryPlanMode;
  effectiveQuery: string;
  structuredTasks: QueryPlanStructuredTask[];
  semanticTasks: QueryPlanSemanticTask[];
  clarificationRequired: boolean;
  clarificationPrompt: string | null;
  diagnostics: string[];
};

export type StructuredTaskExecutionResult = {
  taskId: string;
  kind: QueryPlanStructuredTaskKind;
  status: "ok" | "empty" | "clarify" | "unsupported" | "error";
  summary: string;
  citations: Array<{
    sourceId: string;
    snippet: string;
    metadata?: unknown;
  }>;
  structuredSnapshot: unknown;
  renderedStructuredSnapshot?: unknown;
  conditioningHints: string[];
  clarificationPrompt?: string;
};

export type SemanticTaskExecutionResult = {
  taskId: string;
  status: "ok" | "partial" | "clarify" | "refuse" | "error";
  answer: string;
  citations: Array<{
    sourceId: string;
    snippet: string;
    metadata?: unknown;
  }>;
  retrievalMeta?: {
    reason?: string;
    multiQueryTriggered?: boolean;
    multiQueryVariantCount?: number;
  };
  conditionedQuery?: string;
};
