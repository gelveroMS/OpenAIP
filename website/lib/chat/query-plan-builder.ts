import { detectAggregationIntent } from "@/lib/chat/aggregation-intent";
import { extractFiscalYear } from "@/lib/chat/intent";
import { decideRoute } from "@/lib/chat/router-decision";
import type { PipelineIntentClassification } from "@/lib/chat/types";
import type {
  QueryPlan,
  QueryPlanMissingSlot,
  QueryPlanRecentDomainContext,
  QueryPlanSemanticTask,
  QueryPlanStructuredTask,
  QueryPlanStructuredTaskKind,
} from "@/lib/chat/query-plan-types";

const COMPOUND_SPLIT_PATTERN = /\b(?:and then|then|and also|and|plus|, then)\b/i;
const PART_SPLIT_PATTERN = /\b(?:and then|then|and also|plus)\b/i;
const YEAR_PATTERN = /\b(20\d{2})\b/g;

const SEMANTIC_CUE_PATTERNS: RegExp[] = [
  /\bexplain\b/i,
  /\bsummarize\b/i,
  /\bsummary\b/i,
  /\bwhy\b/i,
  /\bdescribe\b/i,
  /\bwhat does the aip say\b/i,
  /\bcitations?\b/i,
  /\bcite\b/i,
];

const STRUCTURED_DELTA_CUT_PATTERN =
  /\b(which\s+projects?\s+were\s+cut|projects?\s+were\s+cut|dropped\s+projects?|projects?\s+cut)\b/i;
const STRUCTURED_DELTA_INCREASE_PATTERN =
  /\b(sectors?\s+increased|which\s+sectors?\s+increased|increased\s+sectors?)\b/i;
const COMPARISON_FRAME_CUE_PATTERN =
  /\b(compare|comparison|difference|changed?|increase[ds]?|decrease[ds]?|last year|vs|versus)\b/i;
const REFERENTIAL_SEMANTIC_PATTERN =
  /\b(it|them|those|that|these|the change|drove the change|about them)\b/i;

type BuildQueryPlanInput = {
  text: string;
  intentClassification: PipelineIntentClassification | null;
  recentDomainContext?: QueryPlanRecentDomainContext | null;
  rewriteContext?: {
    applied: boolean;
    originalQuery: string | null;
    reason?: string | null;
  } | null;
};

function maxStructuredTasks(): number {
  const raw = Number.parseInt(process.env.CHAT_MIXED_MAX_STRUCTURED_TASKS ?? "3", 10);
  if (!Number.isFinite(raw)) return 3;
  return Math.min(5, Math.max(1, raw));
}

function maxSemanticTasks(): number {
  const raw = Number.parseInt(process.env.CHAT_MIXED_MAX_SEMANTIC_TASKS ?? "2", 10);
  if (!Number.isFinite(raw)) return 2;
  return Math.min(3, Math.max(1, raw));
}

export function getMixedTaskCaps(): {
  mixed_max_structured_tasks: number;
  mixed_max_semantic_tasks: number;
} {
  return {
    mixed_max_structured_tasks: maxStructuredTasks(),
    mixed_max_semantic_tasks: maxSemanticTasks(),
  };
}

function normalizePart(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function containsSemanticCue(value: string): boolean {
  return SEMANTIC_CUE_PATTERNS.some((pattern) => pattern.test(value));
}

function hasCompoundShape(value: string): boolean {
  if ((value.match(/\?/g) ?? []).length >= 2) return true;
  return COMPOUND_SPLIT_PATTERN.test(value);
}

function splitSubqueries(text: string, maxParts = 3): string[] {
  const normalized = normalizePart(text);
  if (!normalized) return [];

  const questionParts = normalized
    .split("?")
    .map((part) => normalizePart(part))
    .filter(Boolean);
  const baseParts = questionParts.length > 1 ? questionParts : [normalized];

  const exploded: string[] = [];
  for (const basePart of baseParts) {
    const pieces = basePart
      .split(PART_SPLIT_PATTERN)
      .map((piece) => normalizePart(piece))
      .filter(Boolean);
    if (pieces.length <= 1) {
      exploded.push(basePart);
      continue;
    }
    exploded.push(...pieces);
  }

  const deduped = exploded.filter((part, index, all) => all.indexOf(part) === index);
  return deduped.slice(0, Math.max(1, maxParts));
}

function extractDistinctYears(message: string): number[] {
  const years: number[] = [];
  let match: RegExpExecArray | null = YEAR_PATTERN.exec(message);
  while (match) {
    const parsed = Number.parseInt(match[1] ?? "", 10);
    if (Number.isInteger(parsed) && !years.includes(parsed)) {
      years.push(parsed);
    }
    match = YEAR_PATTERN.exec(message);
  }
  YEAR_PATTERN.lastIndex = 0;
  return years;
}

function requiresComparisonFrame(value: string): boolean {
  return COMPARISON_FRAME_CUE_PATTERN.test(value);
}

function hasUnsupportedCutDeltaCue(value: string): boolean {
  return STRUCTURED_DELTA_CUT_PATTERN.test(value);
}

function hasUnsupportedIncreaseDeltaCue(value: string): boolean {
  return STRUCTURED_DELTA_INCREASE_PATTERN.test(value);
}

function recoverYearPair(input: {
  part: string;
  recentDomainContext?: QueryPlanRecentDomainContext | null;
  rewriteContext?: BuildQueryPlanInput["rewriteContext"];
}): { yearA: number; yearB: number; source: QueryPlanRecentDomainContext["source"] } | null {
  const partYears = extractDistinctYears(input.part);
  if (partYears.length >= 2) {
    return {
      yearA: partYears[0]!,
      yearB: partYears[1]!,
      source: "none",
    };
  }
  if (partYears.length === 1 && /\blast year\b/i.test(input.part)) {
    return {
      yearA: partYears[0]!,
      yearB: partYears[0]! - 1,
      source: "none",
    };
  }
  if (/\bthis year\b/i.test(input.part) && /\blast year\b/i.test(input.part)) {
    const currentYear = new Date().getUTCFullYear();
    return {
      yearA: currentYear,
      yearB: currentYear - 1,
      source: "none",
    };
  }

  const rewriteSource = input.rewriteContext?.applied ? input.rewriteContext.originalQuery : null;
  const rewriteYears = rewriteSource ? extractDistinctYears(rewriteSource) : [];
  if (rewriteYears.length >= 2) {
    return {
      yearA: rewriteYears[0]!,
      yearB: rewriteYears[1]!,
      source: "rewrite_context",
    };
  }

  const lastUserQuery = input.recentDomainContext?.lastDomainUserQuery ?? null;
  const recentYears = lastUserQuery ? extractDistinctYears(lastUserQuery) : [];
  if (recentYears.length >= 2) {
    return {
      yearA: recentYears[0]!,
      yearB: recentYears[1]!,
      source: "last_domain_turn",
    };
  }
  if (partYears.length === 1 && /\blast year\b/i.test(input.part) && recentYears.length >= 1) {
    return {
      yearA: partYears[0]!,
      yearB: partYears[0]! - 1,
      source: "last_domain_turn",
    };
  }

  return null;
}

function mapRouteKindToStructuredTaskKind(routeKind: QueryPlanStructuredTask["routeKind"]): QueryPlanStructuredTaskKind {
  if (routeKind === "SQL_TOTAL") return "totals";
  if (routeKind === "SQL_AGG") return "aggregation";
  if (routeKind === "ROW_LOOKUP") return "line_item";
  return "metadata";
}

function toMissingSlots(routeMissing: string[]): QueryPlanMissingSlot[] {
  const slots: QueryPlanMissingSlot[] = [];
  if (routeMissing.includes("fiscal_year_pair")) {
    slots.push("fiscal_year_pair");
  }
  if (routeMissing.includes("scope")) {
    slots.push("scope");
  }
  return slots;
}

function buildClarificationPrompt(missingSlots: QueryPlanMissingSlot[]): string {
  if (missingSlots.includes("fiscal_year_pair")) {
    return "Please specify two fiscal years to compare (for example: FY 2025 vs FY 2026).";
  }
  return "Please clarify the request (scope and year) before I run a mixed answer.";
}

function buildSemanticTask(input: {
  id: string;
  subquery: string;
  structuredTaskIds: string[];
}): QueryPlanSemanticTask {
  const dependent = REFERENTIAL_SEMANTIC_PATTERN.test(input.subquery);
  return {
    id: input.id,
    kind: "narrative",
    subquery: input.subquery,
    requiresCitations: true,
    dependsOnStructuredTaskIds: dependent ? input.structuredTaskIds : [],
    independentIfStructuredUnsupported: !dependent,
  };
}

export function buildQueryPlan(input: BuildQueryPlanInput): QueryPlan {
  const effectiveQuery = normalizePart(input.text);
  if (!effectiveQuery) {
    return {
      mode: "semantic_only",
      effectiveQuery,
      structuredTasks: [],
      semanticTasks: [],
      clarificationRequired: false,
      clarificationPrompt: null,
      diagnostics: ["empty_query"],
    };
  }

  const candidateParts = hasCompoundShape(effectiveQuery)
    ? splitSubqueries(effectiveQuery, Math.max(maxStructuredTasks(), maxSemanticTasks(), 3))
    : [effectiveQuery];

  const diagnostics: string[] = [];
  const structuredTasks: QueryPlanStructuredTask[] = [];
  const semanticPartQueue: string[] = [];

  for (const part of candidateParts) {
    const decision = decideRoute({
      text: part,
      intentClassification: input.intentClassification,
    });

    const isStructuredRoute =
      decision.kind === "SQL_TOTAL" ||
      decision.kind === "SQL_AGG" ||
      decision.kind === "ROW_LOOKUP" ||
      decision.kind === "SQL_METADATA";

    if (isStructuredRoute && structuredTasks.length < maxStructuredTasks()) {
      structuredTasks.push({
        id: `structured_${structuredTasks.length + 1}`,
        kind: mapRouteKindToStructuredTaskKind(decision.kind),
        routeKind: decision.kind,
        subquery: part,
        fiscalYear: extractFiscalYear(part),
        missingSlots: toMissingSlots(decision.missingSlots),
        capabilityHint: "standard",
      });
      diagnostics.push(`structured:${decision.kind}`);
    } else if (
      (hasUnsupportedCutDeltaCue(part) || hasUnsupportedIncreaseDeltaCue(part)) &&
      structuredTasks.length < maxStructuredTasks()
    ) {
      const pair = recoverYearPair({
        part,
        recentDomainContext: input.recentDomainContext,
        rewriteContext: input.rewriteContext,
      });
      const missingSlots: QueryPlanMissingSlot[] = [];
      if (requiresComparisonFrame(part) && !pair) {
        missingSlots.push("fiscal_year_pair");
      }

      const capabilityHint = hasUnsupportedCutDeltaCue(part)
        ? "delta_cut_unsupported"
        : "delta_increase_unsupported";
      const normalizedPart = pair
        ? `${part.replace(/\?+$/, "")} (comparison frame: FY ${pair.yearA} vs FY ${pair.yearB})`
        : part;

      structuredTasks.push({
        id: `structured_${structuredTasks.length + 1}`,
        kind: "aggregation",
        routeKind: "SQL_AGG",
        subquery: normalizedPart,
        fiscalYear: extractFiscalYear(part),
        missingSlots,
        capabilityHint,
      });
      diagnostics.push(`structured:synthetic:${capabilityHint}`);
      if (pair && pair.source !== "none") {
        diagnostics.push(`comparison_frame_recovered:${pair.source}`);
      }
    }

    if (containsSemanticCue(part)) {
      semanticPartQueue.push(part);
      diagnostics.push("semantic:cue");
    }
  }

  if (
    structuredTasks.length > 0 &&
    semanticPartQueue.length === 0 &&
    containsSemanticCue(effectiveQuery)
  ) {
    semanticPartQueue.push(effectiveQuery);
    diagnostics.push("semantic:query_level_cue");
  }

  const semanticTasks: QueryPlanSemanticTask[] = semanticPartQueue
    .slice(0, maxSemanticTasks())
    .map((part, index) =>
      buildSemanticTask({
        id: `semantic_${index + 1}`,
        subquery: part,
        structuredTaskIds: structuredTasks.map((task) => task.id),
      })
    );

  const clarificationMissingSlots = Array.from(
    new Set(
      structuredTasks
        .flatMap((task) => task.missingSlots)
        .filter((slot): slot is QueryPlanMissingSlot => slot === "fiscal_year_pair" || slot === "scope")
    )
  );

  const clarificationRequired = clarificationMissingSlots.length > 0;
  const clarificationPrompt = clarificationRequired
    ? buildClarificationPrompt(clarificationMissingSlots)
    : null;

  const mode: QueryPlan["mode"] =
    structuredTasks.length > 0 && semanticTasks.length > 0
      ? "mixed"
      : structuredTasks.length > 0
        ? "structured_only"
        : "semantic_only";

  if (mode === "structured_only" && detectAggregationIntent(effectiveQuery).intent === "none") {
    diagnostics.push("structured_only_single_route");
  }

  if (mode === "semantic_only") {
    diagnostics.push("semantic_only_single_route");
  }

  return {
    mode,
    effectiveQuery,
    structuredTasks,
    semanticTasks,
    clarificationRequired,
    clarificationPrompt,
    diagnostics,
  };
}
