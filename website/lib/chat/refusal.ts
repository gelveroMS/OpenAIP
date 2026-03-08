import type { RefusalReason } from "@/lib/repos/chat/types";

export type RefusalContext = {
  intent: "totals" | "line_item_fact" | "aggregation" | "unanswerable_field" | "pipeline_fallback";
  field?: string | null;
  fiscalYear?: number | null;
  scopeLabel?: string | null;
  queryText: string;
  hadVectorSearch?: boolean;
  matchCount?: number | null;
  foundCandidates?: number | null;
  explicitScopeRequested?: boolean;
  scopeResolved?: boolean;
  missingParam?: "fiscal_year" | "barangay" | "city" | null;
  docLimitField?:
    | "contractor"
    | "procurement_mode"
    | "exact_address"
    | "beneficiary_count"
    | "supplier"
    | null;
};

type RefusalBuildResult = {
  status: "refusal" | "clarification";
  reason: RefusalReason;
  message: string;
  suggestions: string[];
};

function toSuggestionList(suggestions: string[]): string[] {
  const unique = suggestions
    .map((entry) => entry.trim())
    .filter((entry, index, all) => entry.length > 0 && all.indexOf(entry) === index);
  return unique.slice(0, 3);
}

function getDocumentFieldLabel(field: RefusalContext["docLimitField"]): string {
  if (field === "contractor") return "contractors, suppliers, or winning bidders";
  if (field === "procurement_mode") return "procurement mode";
  if (field === "exact_address") return "the exact site address";
  if (field === "beneficiary_count") return "beneficiary counts";
  if (field === "supplier") return "contractors, suppliers, or winning bidders";
  return "that field";
}

function hasUnsupportedCue(queryText: string): boolean {
  const normalized = queryText.toLowerCase();
  return (
    (/\bdo you think\b/.test(normalized) &&
      /\b(inflated|overpriced|overprice|suspicious|anomal(y|ies)|too high)\b/.test(normalized) &&
      /\bbudget(s)?\b/.test(normalized)) ||
    /\bwho stole\b/.test(normalized) ||
    /\bembezzl/.test(normalized) ||
    /\bcorrupt(ion)?\b/.test(normalized) ||
    /\bpredict\b/.test(normalized) ||
    /\bforecast\b/.test(normalized) ||
    /\bnext year\b.*\bbudget\b/.test(normalized)
  );
}

export function buildRefusalMessage(ctx: RefusalContext): RefusalBuildResult {
  if (ctx.docLimitField) {
    return {
      status: "refusal",
      reason: "document_limitation",
      message:
        `The published AIP does not list ${getDocumentFieldLabel(ctx.docLimitField)}. ` +
        "I can answer amounts, fund sources, and schedules when they are present.",
      suggestions: toSuggestionList([
        "Ask for the project's amount, fund source, or schedule.",
        "Provide a Ref code if available.",
        "Ask for top projects or totals by sector/fund source.",
      ]),
    };
  }

  if (
    ctx.missingParam === "fiscal_year" &&
    (ctx.intent === "totals" || ctx.intent === "aggregation")
  ) {
    return {
      status: "clarification",
      reason: "missing_required_parameter",
      message: "Which fiscal year should I use (e.g., FY 2025 or FY 2026)?",
      suggestions: toSuggestionList(["Reply with a fiscal year, such as FY 2026."]),
    };
  }

  if (ctx.explicitScopeRequested === true && ctx.scopeResolved === false) {
    return {
      status: "clarification",
      reason: "ambiguous_scope",
      message:
        "I couldn't match the requested barangay/city name. Please specify the exact name (e.g., 'Barangay Pulo') or choose 'across all barangays'.",
      suggestions: toSuggestionList([
        "Use the exact scope name, such as Barangay Pulo.",
        "Say 'across all barangays' to use global scope.",
      ]),
    };
  }

  if (hasUnsupportedCue(ctx.queryText)) {
    return {
      status: "refusal",
      reason: "unsupported_request",
      message:
        "I can only answer based on published AIP data. Please ask about totals, line-item amounts, fund sources, or schedules.",
      suggestions: toSuggestionList([
        "Ask for a project amount, fund source, or schedule.",
        "Ask for totals by sector, fund source, or top projects.",
      ]),
    };
  }

  const scopeText = ctx.scopeLabel ? ` for ${ctx.scopeLabel}` : "";
  const yearText = typeof ctx.fiscalYear === "number" ? ` for FY ${ctx.fiscalYear}` : "";

  if (
    ctx.intent === "line_item_fact" ||
    ctx.intent === "totals" ||
    ctx.intent === "aggregation" ||
    ctx.intent === "pipeline_fallback"
  ) {
    return {
      status: "refusal",
      reason: "retrieval_failure",
      message:
        `I couldn't find a matching published AIP entry${scopeText}${yearText}. ` +
        "Try using the exact project title or a Ref code.",
      suggestions: toSuggestionList([
        "Try the exact project title as written in the AIP.",
        "Provide the Ref code (e.g., 8000-003-002-006).",
        "Remove extra filters (scope/year) to broaden search.",
      ]),
    };
  }

  return {
    status: "refusal",
    reason: "retrieval_failure",
    message:
      "I couldn't find a matching published AIP entry. Try using the exact project title or a Ref code.",
    suggestions: toSuggestionList([
      "Try the exact project title as written in the AIP.",
      "Provide the Ref code (e.g., 8000-003-002-006).",
      "Remove extra filters (scope/year) to broaden search.",
    ]),
  };
}
