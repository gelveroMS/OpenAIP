import { detectAggregationIntent } from "@/lib/chat/aggregation-intent";
import { isLineItemSpecificQuery } from "@/lib/chat/line-item-routing";

export type ChatIntent = "total_investment_program" | "normal";

const TOTAL_KEYWORDS = ["total investment program", "total investment", "grand total"] as const;
const YEAR_PATTERN = /\b(20\d{2})\b/;
const STRICT_LINE_ITEM_REF_PATTERN = /\b\d{4}-\d{3}-\d{3}-\d{3}\b/i;
const HYBRID_LINE_ITEM_REF_PATTERN = /\b\d{4}-[a-z0-9]+(?:-[a-z0-9]+)+\b/i;
const QUOTED_TITLE_PATTERN = /"[^"]{3,}"|'[^']{3,}'/;

function normalizeIntentText(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractFiscalYear(message: string): number | null {
  const match = message.match(YEAR_PATTERN);
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

function looksLikeScopeBudgetQuery(message: string, normalized: string): boolean {
  if (!normalized.includes("budget")) {
    return false;
  }

  const hasDomainSpecificBudgetCue =
    /\b(health|education|infrastructure|agriculture|environment|social services|economic services|general services|sector|fund source|funding source|category)\b/.test(
      normalized
    ) ||
    /\bbudget\s+for\b/.test(normalized);
  if (hasDomainSpecificBudgetCue) {
    return false;
  }

  if (
    STRICT_LINE_ITEM_REF_PATTERN.test(message) ||
    HYBRID_LINE_ITEM_REF_PATTERN.test(message) ||
    QUOTED_TITLE_PATTERN.test(message)
  ) {
    return false;
  }

  if (isLineItemSpecificQuery(message)) {
    return false;
  }

  if (detectAggregationIntent(message).intent !== "none") {
    return false;
  }

  const hasScopeOrTotalBudgetCue =
    /\bbudget\s+of\b/.test(normalized) ||
    /\boverall\s+budget\b/.test(normalized) ||
    /\btotal\s+budget\b/.test(normalized) ||
    /\baip\s+budget\b/.test(normalized) ||
    /\bacross\s+all\s+barangays\b/.test(normalized) ||
    /\bfor\s+(barangay|city|municipality)\b/.test(normalized);

  return hasScopeOrTotalBudgetCue;
}

export function detectIntent(message: string): { intent: ChatIntent } {
  const normalized = normalizeIntentText(message);
  const hasTotalsKeyword = TOTAL_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const hasBudgetTotalsCue = looksLikeScopeBudgetQuery(message, normalized);
  const hasTotalBudgetPhrase = /\b(total|overall|aip)\s+[a-z0-9\s]{0,60}\bbudget\b/.test(normalized);
  const hasYearToken = extractFiscalYear(message) !== null;

  // Phase 1 default: missing FY can still route to SQL-first using latest published AIP in scope.
  const hasImpliedFiscalYearSelection = true;
  if (
    (hasTotalsKeyword || hasBudgetTotalsCue || hasTotalBudgetPhrase) &&
    (hasYearToken || hasImpliedFiscalYearSelection)
  ) {
    return { intent: "total_investment_program" };
  }

  return { intent: "normal" };
}
