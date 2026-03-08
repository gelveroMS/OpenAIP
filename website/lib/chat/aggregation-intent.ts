export type AggregationIntentResult = {
  intent: "top_projects" | "totals_by_sector" | "totals_by_fund_source" | "compare_years" | "none";
  limit?: number;
  yearA?: number;
  yearB?: number;
};

const YEAR_PATTERN = /\b(20\d{2})\b/g;
const THIS_YEAR_PATTERN = /\bthis\s+year\b/i;
const LAST_YEAR_PATTERN = /\blast\s+year\b/i;

function normalizeAggregationText(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function parseTopLimit(normalized: string): number {
  const match = normalized.match(/\btop\s+(\d{1,2})\b/i);
  if (!match) return 10;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isInteger(parsed)) return 10;
  return Math.max(1, Math.min(parsed, 50));
}

function hasEnumerationCue(normalized: string): boolean {
  return (
    normalized.includes("list") ||
    normalized.includes("show") ||
    normalized.includes("available") ||
    normalized.includes("exist") ||
    normalized.includes("exists") ||
    normalized.includes("what are") ||
    normalized.includes("which are")
  );
}

export function detectAggregationIntent(message: string): AggregationIntentResult {
  const normalized = normalizeAggregationText(message);
  if (!normalized) return { intent: "none" };

  const hasAggregationCue =
    normalized.includes("totals") ||
    normalized.includes("total by") ||
    normalized.includes("breakdown") ||
    normalized.includes("distribution") ||
    normalized.includes("compare") ||
    normalized.includes("comparison") ||
    normalized.includes("difference") ||
    normalized.includes("vs") ||
    normalized.includes("versus");

  const asksSectorEnumeration =
    (normalized.includes("sector") || normalized.includes("sectors")) &&
    hasEnumerationCue(normalized) &&
    !hasAggregationCue;
  if (asksSectorEnumeration) {
    return { intent: "none" };
  }

  const asksFundSourceEnumeration =
    (normalized.includes("fund source") ||
      normalized.includes("fund sources") ||
      normalized.includes("funding source") ||
      normalized.includes("funding sources") ||
      normalized.includes("source of funds") ||
      normalized.includes("sources of funds")) &&
    hasEnumerationCue(normalized) &&
    !hasAggregationCue;
  if (asksFundSourceEnumeration) {
    return { intent: "none" };
  }

  const years = extractDistinctYears(normalized);
  const hasCompareCue = /\b(compare|difference|vs|versus)\b/.test(normalized);
  if (hasCompareCue) {
    if (years.length >= 2) {
      return {
        intent: "compare_years",
        yearA: years[0],
        yearB: years[1],
      };
    }

    if (years.length === 1 && LAST_YEAR_PATTERN.test(normalized)) {
      return {
        intent: "compare_years",
        yearA: years[0],
        yearB: years[0]! - 1,
      };
    }

    if (THIS_YEAR_PATTERN.test(normalized) && LAST_YEAR_PATTERN.test(normalized)) {
      const currentYear = new Date().getUTCFullYear();
      return {
        intent: "compare_years",
        yearA: currentYear,
        yearB: currentYear - 1,
      };
    }
  }

  const hasTopCue = /\b(top|largest|highest|most funded)\b/.test(normalized);
  const hasProjectsCue = /\b(projects?|programs?)\b/.test(normalized);
  if (hasTopCue && hasProjectsCue) {
    return {
      intent: "top_projects",
      limit: parseTopLimit(normalized),
    };
  }

  const hasSectorCue =
    normalized.includes("by sector") ||
    normalized.includes("per sector") ||
    normalized.includes("sector totals") ||
    normalized.includes("total by sector") ||
    normalized.includes("sector breakdown") ||
    normalized.includes("breakdown by sector") ||
    normalized.includes("sector distribution");
  const hasSectorRankingCue =
    (normalized.includes("sector") || normalized.includes("sectors")) &&
    /\b(lowest|least|min(?:imum)?|highest|most|max(?:imum)?|rank|ranking)\b/.test(normalized) &&
    /\b(allocated|allocation|budget|spending|total|totals)\b/.test(normalized);
  if (hasSectorCue || hasSectorRankingCue) {
    return { intent: "totals_by_sector" };
  }

  const hasFundTopic =
    normalized.includes("fund source") ||
    normalized.includes("fund sources") ||
    normalized.includes("funding source") ||
    normalized.includes("source of funds") ||
    normalized.includes("sources of funds") ||
    normalized.includes("funded by") ||
    normalized.includes("by fund") ||
    normalized.includes("loan") ||
    normalized.includes("loans") ||
    normalized.includes("general fund") ||
    normalized.includes("external source");
  const hasFundAggregationCue =
    normalized.includes("totals") ||
    normalized.includes("total") ||
    normalized.includes("breakdown") ||
    normalized.includes("distribution") ||
    normalized.includes("summary") ||
    normalized.includes("by fund source") ||
    normalized.includes("fund source totals") ||
    normalized.includes("fund source breakdown") ||
    normalized.includes("breakdown by fund") ||
    normalized.includes("distribution by fund") ||
    normalized.includes("loan vs") ||
    normalized.includes("loans vs") ||
    normalized.includes("vs") ||
    normalized.includes("versus") ||
    normalized.includes("compare") ||
    normalized.includes("comparison") ||
    normalized.includes("difference") ||
    normalized.includes("fund source breakdown") ||
    normalized.includes("fund source distribution") ||
    /how much is funded by .* (vs|versus) .*/.test(normalized) ||
    /(loan|loans)\s+(vs|versus)\s+general fund/.test(normalized) ||
    /general fund\s+(vs|versus)\s+(loan|loans|external source)/.test(normalized);
  if (hasFundTopic && hasFundAggregationCue) {
    return { intent: "totals_by_fund_source" };
  }

  return { intent: "none" };
}
