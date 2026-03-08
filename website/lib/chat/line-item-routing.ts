const TOKEN_SPLIT_PATTERN = /[^a-z0-9]+/g;
const REF_CODE_PATTERN = /\b\d{4}[a-z0-9-]*\b/i;

const STRICT_LINE_ITEM_REF_PATTERN = /\b\d{4}-\d{3}-\d{3}-\d{3}\b/i;
const HYBRID_LINE_ITEM_REF_PATTERN = /\b\d{4}-[a-z0-9]+(?:-[a-z0-9]+)+\b/i;
const QUOTED_TITLE_PATTERN = /"[^"]{3,}"|'[^']{3,}'/;
const FOR_SEGMENT_PATTERN = /\bfor\s+([a-z0-9][a-z0-9\s-]{1,140})/g;
const FOR_SEGMENT_STOP_PATTERN =
  /\b(?:in|at|on|fy|fiscal|year|barangay|city|municipality|across|all|within|during|with|from)\b/i;
const ITEM_SPECIFIC_CUE_PATTERNS: RegExp[] = [
  /\bhow much\s+for\b/i,
  /\bamount\s+for\b/i,
  /\bwhat is allocated for\b/i,
  /\bhow much is allocated for\b/i,
  /\bschedule for\b/i,
  /\bfund source for\b/i,
  /\bwhat is the fund source for\b/i,
  /\bimplementation schedule for\b/i,
];

export function extractAipRefCode(message: string): string | null {
  const strictMatch = message.match(STRICT_LINE_ITEM_REF_PATTERN);
  if (strictMatch?.[0]) {
    return strictMatch[0].toUpperCase();
  }

  const hybridMatch = message.match(HYBRID_LINE_ITEM_REF_PATTERN);
  if (hybridMatch?.[0]) {
    return hybridMatch[0].toUpperCase();
  }

  return null;
}

const GLOBAL_SCOPE_PATTERNS: RegExp[] = [
  /\ball\s+barangays\b/i,
  /\bacross\s+all\s+barangays\b/i,
  /\ball\s+published\s+aips\b/i,
  /\bcity\s*[-\s]?wide\b/i,
];

const NOISE_TERMS = new Set([
  "what",
  "which",
  "where",
  "when",
  "how",
  "much",
  "allocated",
  "allocation",
  "for",
  "the",
  "and",
  "from",
  "in",
  "on",
  "of",
  "to",
  "is",
  "are",
  "fy",
  "year",
  "fiscal",
  "program",
  "project",
  "total",
  "schedule",
  "fund",
  "source",
  "agency",
  "implementing",
  "output",
  "barangay",
  "all",
  "published",
  "aips",
  "only",
]);

export type LineItemFactField =
  | "amount"
  | "schedule"
  | "fund_source"
  | "implementing_agency"
  | "expected_output";

export type LineItemScopeReason =
  | "explicit_barangay"
  | "explicit_our_barangay"
  | "default_user_barangay"
  | "global"
  | "unknown";

export type ParsedLineItemQuestion = {
  normalizedQuestion: string;
  factFields: LineItemFactField[];
  isFactQuestion: boolean;
  isUnanswerableFieldQuestion: boolean;
  hasGlobalScopeCue: boolean;
  mentionedRefCode: string | null;
  keyTokens: string[];
  titlePhrase: string | null;
};

export type LineItemMatchCandidate = {
  line_item_id: string;
  aip_id: string;
  fiscal_year: number | null;
  barangay_id: string | null;
  aip_ref_code: string | null;
  program_project_title: string;
  page_no: number | null;
  row_no: number | null;
  table_no: number | null;
  distance: number | null;
  score: number | null;
};

export type RankedLineItemCandidate = LineItemMatchCandidate & {
  rerank_score: number;
  token_overlap: number;
  ref_code_match: boolean;
  year_match: boolean;
  title_phrase_match: boolean;
};

export type LineItemRowRecord = {
  id: string;
  aip_id: string;
  fiscal_year: number;
  barangay_id: string | null;
  aip_ref_code: string | null;
  program_project_title: string;
  implementing_agency: string | null;
  start_date: string | null;
  end_date: string | null;
  fund_source: string | null;
  ps: number | null;
  mooe: number | null;
  co: number | null;
  fe: number | null;
  total: number | null;
  expected_output: string | null;
  page_no: number | null;
  row_no: number | null;
  table_no: number | null;
};

export type ScopeResolutionLite = {
  mode: "global" | "own_barangay" | "named_scopes" | "ambiguous" | "unresolved";
  resolvedTargets: Array<{
    scopeType: "barangay" | "city" | "municipality";
    scopeId: string;
    scopeName: string;
  }>;
};

export type LineItemScopeDecision = {
  scopeReason: LineItemScopeReason;
  barangayIdUsed: string | null;
  explicitScopeDetected: boolean;
};

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeSpecificQueryText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRefCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const normalized = input.toLowerCase().replace(/[^a-z0-9-]/g, "").trim();
  return normalized || null;
}

function normalizeTitle(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeBarangayName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return /^barangay\s+/i.test(trimmed) ? trimmed : `Barangay ${trimmed}`;
}

function collectKeyTokens(normalizedQuestion: string): string[] {
  const tokens = normalizedQuestion
    .split(TOKEN_SPLIT_PATTERN)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !NOISE_TERMS.has(token) && !/^20\d{2}$/.test(token));

  const unique: string[] = [];
  for (const token of tokens) {
    if (!unique.includes(token)) unique.push(token);
  }
  return unique;
}

function hasTwoOrMoreNamedTokensAfterFor(normalizedQuestion: string): boolean {
  let match: RegExpExecArray | null = FOR_SEGMENT_PATTERN.exec(normalizedQuestion);
  while (match) {
    const rawSegment = (match[1] ?? "").trim();
    if (rawSegment) {
      const constrainedSegment = rawSegment.split(FOR_SEGMENT_STOP_PATTERN)[0]?.trim() ?? "";
      const titleTokens = constrainedSegment
        .split(TOKEN_SPLIT_PATTERN)
        .map((token) => token.trim())
        .filter(
          (token) =>
            token.length >= 2 && !NOISE_TERMS.has(token) && !/^20\d{2}$/.test(token)
        );
      if (titleTokens.length >= 2) {
        FOR_SEGMENT_PATTERN.lastIndex = 0;
        return true;
      }
    }
    match = FOR_SEGMENT_PATTERN.exec(normalizedQuestion);
  }

  FOR_SEGMENT_PATTERN.lastIndex = 0;
  return false;
}

export function isLineItemSpecificQuery(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;

  if (STRICT_LINE_ITEM_REF_PATTERN.test(trimmed) || HYBRID_LINE_ITEM_REF_PATTERN.test(trimmed)) {
    return true;
  }

  if (QUOTED_TITLE_PATTERN.test(trimmed)) {
    return true;
  }

  const normalized = normalizeSpecificQueryText(trimmed);
  if (!normalized) return false;

  const hasItemCue = ITEM_SPECIFIC_CUE_PATTERNS.some((pattern) => pattern.test(normalized));
  if (!hasItemCue) return false;

  return hasTwoOrMoreNamedTokensAfterFor(normalized);
}

function detectFactFields(normalizedQuestion: string): LineItemFactField[] {
  const fields: LineItemFactField[] = [];

  const hasAmountCue =
    normalizedQuestion.includes("how much") ||
    normalizedQuestion.includes("amount") ||
    normalizedQuestion.includes("allocated") ||
    normalizedQuestion.includes("allocation") ||
    normalizedQuestion.includes("budget") ||
    normalizedQuestion.includes("cost");
  if (hasAmountCue) fields.push("amount");

  const hasScheduleCue =
    normalizedQuestion.includes("schedule") ||
    normalizedQuestion.includes("timeline") ||
    normalizedQuestion.includes("start") ||
    normalizedQuestion.includes("end date") ||
    normalizedQuestion.includes("target completion") ||
    normalizedQuestion.includes("when");
  if (hasScheduleCue) fields.push("schedule");

  const hasFundCue =
    normalizedQuestion.includes("fund source") ||
    normalizedQuestion.includes("funding source") ||
    normalizedQuestion.includes("source of funds") ||
    normalizedQuestion.includes("funded by");
  if (hasFundCue) fields.push("fund_source");

  const hasImplementingCue =
    normalizedQuestion.includes("implementing agency") ||
    normalizedQuestion.includes("implementing office") ||
    normalizedQuestion.includes("implemented by") ||
    normalizedQuestion.includes("who will implement");
  if (hasImplementingCue) fields.push("implementing_agency");

  const hasOutputCue =
    normalizedQuestion.includes("expected output") ||
    normalizedQuestion.includes("target output") ||
    normalizedQuestion.includes("deliverable") ||
    normalizedQuestion.includes("output");
  if (hasOutputCue) fields.push("expected_output");

  return fields;
}

function isUnanswerableFieldQuestion(normalizedQuestion: string): boolean {
  return (
    normalizedQuestion.includes("contractor") ||
    normalizedQuestion.includes("supplier") ||
    normalizedQuestion.includes("winning bidder") ||
    normalizedQuestion.includes("awarded to") ||
    normalizedQuestion.includes("contractor name") ||
    normalizedQuestion.includes("supplier name") ||
    normalizedQuestion.includes("procurement mode") ||
    normalizedQuestion.includes("procurement") ||
    normalizedQuestion.includes("site address") ||
    normalizedQuestion.includes("exact address") ||
    normalizedQuestion.includes("beneficiary count") ||
    normalizedQuestion.includes("beneficiaries")
  );
}

function hasGlobalScopeCue(message: string): boolean {
  return GLOBAL_SCOPE_PATTERNS.some((pattern) => pattern.test(message));
}

function detectTitlePhrase(keyTokens: string[]): string | null {
  if (keyTokens.length < 2) return null;
  const phrase = keyTokens.join(" ").trim();
  return phrase.length >= 6 ? phrase : null;
}

function deriveScore(candidate: LineItemMatchCandidate): number {
  if (typeof candidate.score === "number" && Number.isFinite(candidate.score)) {
    return candidate.score;
  }
  if (typeof candidate.distance === "number" && Number.isFinite(candidate.distance)) {
    return 1 / (1 + candidate.distance);
  }
  return 0;
}

export function parseLineItemQuestion(message: string): ParsedLineItemQuestion {
  const normalizedQuestion = normalizeText(message);
  const factFields = detectFactFields(normalizedQuestion);
  const keyTokens = collectKeyTokens(normalizedQuestion);
  const refMatch = normalizedQuestion.match(REF_CODE_PATTERN);

  return {
    normalizedQuestion,
    factFields,
    isFactQuestion: factFields.length > 0,
    isUnanswerableFieldQuestion: isUnanswerableFieldQuestion(normalizedQuestion),
    hasGlobalScopeCue: hasGlobalScopeCue(message),
    mentionedRefCode: refMatch ? refMatch[0].toUpperCase() : null,
    keyTokens,
    titlePhrase: detectTitlePhrase(keyTokens),
  };
}

export function toPgVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export function resolveLineItemScopeDecision(input: {
  question: ParsedLineItemQuestion;
  scopeResolution: ScopeResolutionLite;
  userBarangayId: string | null;
}): LineItemScopeDecision {
  if (input.question.hasGlobalScopeCue) {
    return {
      scopeReason: "global",
      barangayIdUsed: null,
      explicitScopeDetected: false,
    };
  }

  if (input.scopeResolution.mode === "own_barangay" && input.userBarangayId) {
    return {
      scopeReason: "explicit_our_barangay",
      barangayIdUsed: input.userBarangayId,
      explicitScopeDetected: true,
    };
  }

  if (input.scopeResolution.mode === "named_scopes") {
    const target =
      input.scopeResolution.resolvedTargets.length === 1
        ? input.scopeResolution.resolvedTargets[0]
        : null;
    if (target?.scopeType === "barangay") {
      return {
        scopeReason: "explicit_barangay",
        barangayIdUsed: target.scopeId,
        explicitScopeDetected: true,
      };
    }

    return {
      scopeReason: "global",
      barangayIdUsed: null,
      explicitScopeDetected: false,
    };
  }

  if (input.userBarangayId) {
    return {
      scopeReason: "default_user_barangay",
      barangayIdUsed: input.userBarangayId,
      explicitScopeDetected: false,
    };
  }

  return {
    scopeReason: "unknown",
    barangayIdUsed: null,
    explicitScopeDetected: false,
  };
}

export function rerankLineItemCandidates(input: {
  question: ParsedLineItemQuestion;
  candidates: LineItemMatchCandidate[];
  requestedFiscalYear: number | null;
}): RankedLineItemCandidate[] {
  const normalizedRef = normalizeRefCode(input.question.mentionedRefCode);

  const ranked = input.candidates.map((candidate) => {
    const title = normalizeTitle(candidate.program_project_title || "");
    const tokenOverlap = input.question.keyTokens.filter((token) => title.includes(token)).length;
    const refCodeMatch =
      normalizedRef !== null && normalizeRefCode(candidate.aip_ref_code) !== null
        ? normalizeRefCode(candidate.aip_ref_code) === normalizedRef
        : false;
    const yearMatch =
      input.requestedFiscalYear !== null && typeof candidate.fiscal_year === "number"
        ? candidate.fiscal_year === input.requestedFiscalYear
        : false;

    const titlePhraseMatch = input.question.titlePhrase ? title.includes(input.question.titlePhrase) : false;

    let rerankScore = deriveScore(candidate);
    rerankScore += Math.min(0.12, tokenOverlap * 0.02);
    if (refCodeMatch) rerankScore += 0.25;
    if (yearMatch) rerankScore += 0.05;

    return {
      ...candidate,
      rerank_score: rerankScore,
      token_overlap: tokenOverlap,
      ref_code_match: refCodeMatch,
      year_match: yearMatch,
      title_phrase_match: titlePhraseMatch,
    };
  });

  ranked.sort((a, b) => {
    if (b.rerank_score !== a.rerank_score) return b.rerank_score - a.rerank_score;
    const aDistance = typeof a.distance === "number" ? a.distance : Number.POSITIVE_INFINITY;
    const bDistance = typeof b.distance === "number" ? b.distance : Number.POSITIVE_INFINITY;
    return aDistance - bDistance;
  });

  return ranked;
}

function hasStrongDisambiguator(input: {
  question: ParsedLineItemQuestion;
  topCandidate: RankedLineItemCandidate;
}): boolean {
  if (input.topCandidate.ref_code_match) return true;
  if (input.question.titlePhrase && input.topCandidate.title_phrase_match) return true;

  const normalizedQuestion = normalizeTitle(input.question.normalizedQuestion);
  const normalizedTopTitle = normalizeTitle(input.topCandidate.program_project_title);
  if (normalizedQuestion && normalizedTopTitle && normalizedQuestion.includes(normalizedTopTitle)) {
    return true;
  }

  return false;
}

export function shouldAskLineItemClarification(input: {
  question: ParsedLineItemQuestion;
  candidates: RankedLineItemCandidate[];
}): boolean {
  if (input.candidates.length < 2) return false;

  const top1 = input.candidates[0];
  const top2 = input.candidates[1];

  if (hasStrongDisambiguator({ question: input.question, topCandidate: top1 })) {
    return false;
  }

  const topTitle = normalizeTitle(top1.program_project_title);
  const secondTitle = normalizeTitle(top2.program_project_title);
  if (!topTitle || !secondTitle || topTitle === secondTitle) {
    return false;
  }

  if (typeof top1.distance !== "number" || typeof top2.distance !== "number") {
    return false;
  }

  return Math.abs(top2.distance - top1.distance) <= 0.05;
}

export function formatPhpAmount(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  return `PHP ${new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function formatSchedule(startDate: string | null, endDate: string | null): string {
  const start = (startDate || "").trim();
  const end = (endDate || "").trim();
  if (start && end) return `${start} to ${end}`;
  if (start) return `${start} to N/A`;
  if (end) return `N/A to ${end}`;
  return "N/A";
}

export function buildLineItemScopeDisclosure(input: {
  scopeReason: LineItemScopeReason;
  barangayName: string | null;
}): string | null {
  if (input.scopeReason === "default_user_barangay") {
    const normalized = normalizeBarangayName(input.barangayName) ?? "your barangay";
    return `(${normalized} - based on your account scope)`;
  }

  if (input.scopeReason === "global") {
    return "(Scope: all barangays)";
  }

  return null;
}

export function buildLineItemAnswer(input: {
  row: LineItemRowRecord;
  fields: LineItemFactField[];
  scopeDisclosure?: string | null;
}): string {
  const row = input.row;
  const title = row.program_project_title.trim() || "the selected line item";
  const refCode = (row.aip_ref_code || "").trim();
  const refText = refCode ? ` (Ref ${refCode})` : "";

  const clauses: string[] = [];
  for (const field of input.fields) {
    if (field === "amount") {
      clauses.push(`total allocation: ${formatPhpAmount(row.total)}`);
    } else if (field === "schedule") {
      clauses.push(`schedule: ${formatSchedule(row.start_date, row.end_date)}`);
    } else if (field === "fund_source") {
      clauses.push(`fund source: ${(row.fund_source || "N/A").trim() || "N/A"}`);
    } else if (field === "implementing_agency") {
      clauses.push(`implementing agency: ${(row.implementing_agency || "N/A").trim() || "N/A"}`);
    } else if (field === "expected_output") {
      clauses.push(`expected output: ${(row.expected_output || "N/A").trim() || "N/A"}`);
    }
  }

  if (!clauses.length) {
    return `I found ${title}, but I need a specific field (amount, schedule, fund source, implementing agency, or expected output).`;
  }

  const disclosure = input.scopeDisclosure ? ` ${input.scopeDisclosure}` : "";
  return `For ${title}${refText}${disclosure}, ${clauses.join("; ")}.`;
}

export function buildLineItemCitationScopeName(input: {
  title: string;
  fiscalYear: number | null;
  barangayName: string | null;
  scopeReason: LineItemScopeReason;
}): string {
  const safeTitle = input.title.trim() || "Untitled line item";
  const yearLabel = typeof input.fiscalYear === "number" ? String(input.fiscalYear) : "Any";
  const normalizedBarangay = normalizeBarangayName(input.barangayName);

  if (input.scopeReason === "global" || !normalizedBarangay) {
    return `All barangays — FY ${yearLabel} — ${safeTitle}`;
  }

  return `${normalizedBarangay} — FY ${yearLabel} — ${safeTitle}`;
}

export function buildLineItemCitationSnippet(row: LineItemRowRecord): string {
  const title = row.program_project_title.trim() || "Untitled line item";
  const fund = (row.fund_source || "N/A").trim() || "N/A";
  const schedule = formatSchedule(row.start_date, row.end_date).replace(" to ", "..");
  const total = formatPhpAmount(row.total);
  return `${title} - Fund: ${fund} - Schedule: ${schedule} - Total: ${total}`;
}

export function buildClarificationOptions(input: {
  candidates: RankedLineItemCandidate[];
  rowsById: Map<string, LineItemRowRecord>;
  defaultBarangayName: string | null;
  scopeReason: LineItemScopeReason;
}): string[] {
  const seen = new Set<string>();
  const options: string[] = [];

  for (const candidate of input.candidates) {
    const row = input.rowsById.get(candidate.line_item_id) ?? null;
    const title = (row?.program_project_title || candidate.program_project_title || "").trim();
    if (!title) continue;
    const ref = (row?.aip_ref_code || candidate.aip_ref_code || "").trim();
    const total = row ? formatPhpAmount(row.total) : "N/A";
    const year =
      typeof row?.fiscal_year === "number"
        ? row.fiscal_year
        : typeof candidate.fiscal_year === "number"
          ? candidate.fiscal_year
          : "Any";

    const barangayLabel =
      input.scopeReason === "global"
        ? "All barangays"
        : normalizeBarangayName(input.defaultBarangayName) ?? "Barangay (unspecified)";

    const label =
      `${title}` +
      (ref ? ` (Ref ${ref})` : "") +
      ` - Total: ${total} - FY ${year} - ${barangayLabel}`;

    if (seen.has(label)) continue;
    seen.add(label);
    options.push(label);
    if (options.length >= 3) break;
  }

  return options;
}
