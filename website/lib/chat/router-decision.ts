import { detectAggregationIntent } from "@/lib/chat/aggregation-intent";
import { detectIntent, extractFiscalYear } from "@/lib/chat/intent";
import {
  extractAipRefCode,
  isLineItemSpecificQuery,
  parseLineItemQuestion,
} from "@/lib/chat/line-item-routing";
import { detectMetadataIntent } from "@/lib/chat/metadata-intent";
import type { PipelineIntentClassification } from "@/lib/chat/types";

export type RouteKind =
  | "CONVERSATIONAL"
  | "SQL_TOTAL"
  | "SQL_AGG"
  | "ROW_LOOKUP"
  | "SQL_METADATA"
  | "PIPELINE_FALLBACK"
  | "CLARIFY";

export type RouteDecision = {
  kind: RouteKind;
  confidence: number;
  reasons: string[];
  slots: {
    fiscalYear: number | null;
    aggregationIntent: ReturnType<typeof detectAggregationIntent>["intent"];
    metadataIntent: ReturnType<typeof detectMetadataIntent>["intent"];
    lineItemFact: boolean;
    lineItemSpecific: boolean;
    hasDomainCues: boolean;
  };
  missingSlots: Array<"fiscal_year_pair" | "scope">;
  candidates: Array<{ kind: RouteKind; score: number; reason: string }>;
};

const CONVERSATIONAL_INTENTS = new Set([
  "GREETING",
  "THANKS",
  "COMPLAINT",
  "CLARIFY",
  "OUT_OF_SCOPE",
]);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function containsDomainCues(text: string): boolean {
  const normalized = text.toLowerCase();
  if (/\b20\d{2}\b/.test(normalized)) return true;

  const cues = [
    "aip",
    "budget",
    "investment",
    "total",
    "sum",
    "overall",
    "ref",
    "reference",
    "project",
    "program",
    "line item",
    "barangay",
    "city",
    "municipality",
    "fiscal",
    "year",
    "fy",
  ];
  return cues.some((cue) => normalized.includes(cue));
}

function isConversationalShortcut(
  classification: PipelineIntentClassification | null,
  text: string
): boolean {
  if (!classification) return false;
  if (!CONVERSATIONAL_INTENTS.has(classification.intent)) return false;
  return !containsDomainCues(text);
}

export function decideRoute(input: {
  text: string;
  intentClassification: PipelineIntentClassification | null;
  allowSemanticTieBreaker?: boolean;
}): RouteDecision {
  const text = input.text.trim();
  const fiscalYear = extractFiscalYear(text);
  const totalsIntent = detectIntent(text).intent;
  const aggregationIntent = detectAggregationIntent(text);
  const metadataIntent = detectMetadataIntent(text);
  const parsedLineItem = parseLineItemQuestion(text);
  const strictRefCode = extractAipRefCode(text);
  const lineItemSpecific = isLineItemSpecificQuery(text);
  const hasDomainCues = containsDomainCues(text);
  const reasons: string[] = [];
  const missingSlots: RouteDecision["missingSlots"] = [];
  const candidates: RouteDecision["candidates"] = [];

  if (isConversationalShortcut(input.intentClassification, text)) {
    reasons.push("pipeline_conversational_intent_without_domain_cues");
    return {
      kind: "CONVERSATIONAL",
      confidence: 0.99,
      reasons,
      slots: {
        fiscalYear,
        aggregationIntent: aggregationIntent.intent,
        metadataIntent: metadataIntent.intent,
        lineItemFact: parsedLineItem.isFactQuestion,
        lineItemSpecific,
        hasDomainCues,
      },
      missingSlots,
      candidates: [{ kind: "CONVERSATIONAL", score: 0.99, reason: reasons[0] }],
    };
  }

  if (aggregationIntent.intent === "compare_years") {
    if (aggregationIntent.yearA == null || aggregationIntent.yearB == null) {
      reasons.push("compare_years_missing_required_year_pair");
      missingSlots.push("fiscal_year_pair");
      return {
        kind: "CLARIFY",
        confidence: 0.9,
        reasons,
        slots: {
          fiscalYear,
          aggregationIntent: aggregationIntent.intent,
          metadataIntent: metadataIntent.intent,
          lineItemFact: parsedLineItem.isFactQuestion,
          lineItemSpecific,
          hasDomainCues,
        },
        missingSlots,
        candidates: [{ kind: "CLARIFY", score: 0.9, reason: reasons[0] }],
      };
    }
  }

  if (totalsIntent === "total_investment_program") {
    candidates.push({
      kind: "SQL_TOTAL",
      score: 0.96,
      reason: "detected_total_investment_program_intent",
    });
  }

  if (aggregationIntent.intent !== "none" && !(aggregationIntent.intent === "totals_by_fund_source" && lineItemSpecific)) {
    candidates.push({
      kind: "SQL_AGG",
      score: aggregationIntent.intent === "compare_years" ? 0.95 : 0.93,
      reason: `detected_aggregation_intent_${aggregationIntent.intent}`,
    });
  }

  const shouldUseRowLookup =
    Boolean(strictRefCode) ||
    lineItemSpecific ||
    (parsedLineItem.isFactQuestion &&
      (Boolean(strictRefCode) || lineItemSpecific) &&
      totalsIntent !== "total_investment_program" &&
      aggregationIntent.intent === "none");

  if (shouldUseRowLookup) {
    candidates.push({
      kind: "ROW_LOOKUP",
      score: strictRefCode ? 0.97 : lineItemSpecific ? 0.9 : 0.75,
      reason: strictRefCode ? "detected_ref_code_lookup" : "detected_line_item_fact_query",
    });
  }

  if (metadataIntent.intent !== "none") {
    candidates.push({
      kind: "SQL_METADATA",
      score: 0.72,
      reason: `detected_metadata_intent_${metadataIntent.intent}`,
    });
  }

  if (candidates.length === 0) {
    candidates.push({
      kind: "PIPELINE_FALLBACK",
      score: hasDomainCues ? 0.7 : 0.6,
      reason: hasDomainCues ? "domain_query_without_structured_match" : "general_fallback",
    });
  }

  const allowSemanticTieBreaker = input.allowSemanticTieBreaker ?? true;
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  let winner = sorted[0];

  if (
    allowSemanticTieBreaker &&
    input.intentClassification &&
    input.intentClassification.method !== "none" &&
    sorted.length > 1 &&
    winner.score < 0.95
  ) {
    const semanticBoostKind =
      input.intentClassification.intent === "TOTAL_AGGREGATION"
        ? "SQL_TOTAL"
        : input.intentClassification.intent === "CATEGORY_AGGREGATION"
          ? "SQL_AGG"
          : input.intentClassification.intent === "LINE_ITEM_LOOKUP"
            ? "ROW_LOOKUP"
            : null;

    if (semanticBoostKind) {
      const boosted = sorted.find((candidate) => candidate.kind === semanticBoostKind);
      if (boosted) {
        const boostedScore = clamp01(
          boosted.score +
            Math.min(0.12, Math.max(0, input.intentClassification.confidence) * 0.12)
        );
        if (boostedScore > winner.score) {
          winner = {
            ...boosted,
            score: boostedScore,
            reason: `${boosted.reason}+semantic_tie_breaker`,
          };
        }
      }
    }
  }

  reasons.push(winner.reason);

  return {
    kind: winner.kind,
    confidence: winner.score,
    reasons,
      slots: {
        fiscalYear,
        aggregationIntent: aggregationIntent.intent,
        metadataIntent: metadataIntent.intent,
        lineItemFact: parsedLineItem.isFactQuestion,
        lineItemSpecific,
        hasDomainCues,
    },
    missingSlots,
    candidates: sorted,
  };
}
