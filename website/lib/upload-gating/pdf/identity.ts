import type { SupportedLGULevel } from "../constants";
import {
  extractYearCandidates,
  normalizeLGUName,
  normalizeText,
} from "../normalize";

export type IdentityCandidateSummary = {
  name: string;
  score: number;
  hits: number;
  pages: number[];
  flags: string[];
};

export type IdentityDiagnostics = {
  headerSnippets: string[];
  barangayCandidates: IdentityCandidateSummary[];
  cityCandidates: IdentityCandidateSummary[];
  identitySource: "primary_header" | "scope_fallback" | null;
  levelSignals: {
    barangay: number;
    city: number;
  };
  ambiguous: {
    barangay: boolean;
    city: boolean;
  };
  fallback: {
    attempted: boolean;
    applied: boolean;
    confidence: number;
    explicitMatchCount: number;
    contextualMatchCount: number;
    ambiguous: boolean;
    reasons: string[];
  };
};

export type IdentityDetectionResult = {
  isAipDocument: boolean;
  documentType: "AIP" | "BAIP" | "unknown";
  detectedYear: number | null;
  detectedLGU: string | null;
  detectedLGULevel: SupportedLGULevel | null;
  detectedParentLGU: string | null;
  diagnostics: IdentityDiagnostics;
};

const BAIP_INDICATOR_PATTERNS: RegExp[] = [
  /\bbaip\b/i,
  /\bbarangay\s+annual\s+investment\s+program\b/i,
];

const AIP_INDICATOR_PATTERNS: RegExp[] = [
  /\baip\b/i,
  /\bannual\s+investment\s+program\b/i,
  /\bannual\s+investment\s+plan\b/i,
];

const YEAR_HINT_PATTERNS: RegExp[] = [
  /\bfy\s*[:\-]?\s*(20\d{2}|2100)\b/i,
  /\bfiscal\s+year\s*[:\-]?\s*(20\d{2}|2100)\b/i,
  /\bannual\s+investment\s+(?:program|plan)\s*[:\-]?\s*(20\d{2}|2100)\b/i,
];

const TABLE_BODY_MARKERS: RegExp[] = [
  /\b\d{3,4}(?:-\d{1,3}){1,5}\b/i,
  /\bprogram\/project\/activity\b/i,
  /\bsource\s+of\s+funds\b/i,
  /\bstart(?:ing)?\s+date\b/i,
  /\bcompletion\s+date\b/i,
  /\bexpected\s+outputs?\b/i,
];

const HEADER_CONTEXT_PATTERNS: RegExp[] = [
  /\brepublic\s+of\s+the\s+philippines\b/i,
  /\bannual\s+investment\s+(?:program|plan)\b/i,
  /\bfiscal\s+year\b/i,
  /\bfy\s*20\d{2}\b/i,
  /\bcity\s+of\b/i,
  /\bcity\s+government\b/i,
  /\bmunicipality\s+of\b/i,
  /\bprovince\s+of\b/i,
];

const FACILITY_CONTEXT_TOKENS = new Set([
  "hall",
  "health",
  "center",
  "centre",
  "daycare",
  "day",
  "care",
  "gym",
  "gymnasium",
  "office",
  "building",
  "school",
  "chapel",
  "court",
  "covered",
  "road",
  "street",
  "station",
]);

const ROLE_CONTEXT_TOKENS = new Set([
  "treasurer",
  "secretary",
  "punong",
  "captain",
  "kagawad",
  "chairman",
  "chairperson",
  "official",
  "officer",
  "admin",
  "administrative",
]);

const LEADING_NOISE_TOKENS = new Set([
  "and",
  "or",
  "of",
  "the",
  "for",
  "in",
  "at",
  "on",
  "to",
  "ng",
  "sa",
  "ni",
]);

const TRAILING_NOISE_TOKENS = new Set([
  "constituents",
  "resident",
  "residents",
  "official",
  "officials",
  "office",
  "offices",
  "hall",
  "building",
  "staff",
  "admin",
  "administrative",
  "program",
  "project",
  "activity",
  "fund",
  "funds",
  "sector",
  "unit",
  "department",
  "treasurer",
  "secretary",
  "captain",
]);

const CITY_TRAILING_NOISE_TOKENS = new Set([
  "province",
  "philippines",
  "annual",
  "investment",
  "program",
  "plan",
  "fiscal",
  "year",
  "office",
  "government",
]);

const BARANGAY_CONFIDENCE_THRESHOLD = 6;
const CITY_CONFIDENCE_THRESHOLD = 7;
const MAX_HEADER_CHARS_PER_PAGE = 1400;
const EARLY_BODY_MARKER_WINDOW = 120;

type CandidateKind = "barangay" | "city";

type MentionCandidate = {
  kind: CandidateKind;
  canonicalName: string;
  normalizedName: string;
  score: number;
  pageNumber: number;
  flags: string[];
};

type CandidateAggregate = {
  canonicalName: string;
  normalizedName: string;
  score: number;
  hits: number;
  pages: Set<number>;
  flags: Set<string>;
};

type CandidateSelection = {
  selected: CandidateAggregate | null;
  ambiguous: boolean;
};

type ScopeFallbackResult = {
  detectedLGU: string | null;
  detectedLGULevel: SupportedLGULevel | null;
  confidence: number;
  explicitMatchCount: number;
  contextualMatchCount: number;
  ambiguous: boolean;
  reasons: string[];
};

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

function cleanDetectedName(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\([^)]*\)/g, "")
    .replace(/[;,]+$/g, "")
    .trim();
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => {
      if (!part) return part;
      if (/^\d+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

function detectDocumentType(text: string): "AIP" | "BAIP" | "unknown" {
  const baipHits = BAIP_INDICATOR_PATTERNS.reduce(
    (sum, pattern) => sum + (pattern.test(text) ? 1 : 0),
    0
  );
  const aipHits = AIP_INDICATOR_PATTERNS.reduce(
    (sum, pattern) => sum + (pattern.test(text) ? 1 : 0),
    0
  );
  if (baipHits === 0 && aipHits === 0) return "unknown";
  if (baipHits >= aipHits) return "BAIP";
  return "AIP";
}

function detectYear(text: string): number | null {
  for (const pattern of YEAR_HINT_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const year = Number(match[1]);
    if (Number.isInteger(year)) {
      return year;
    }
  }
  const candidates = extractYearCandidates(text);
  return candidates.length > 0 ? candidates[0] : null;
}

function extractHeaderSnippet(pageText: string): string {
  const compact = pageText.replace(/\s+/g, " ").trim();
  if (!compact) return "";

  const firstRefCode = compact.search(/\b\d{3,4}(?:-\d{1,3}){1,5}\b/i);
  const looksLikeBodyImmediately =
    firstRefCode >= 0 &&
    firstRefCode < EARLY_BODY_MARKER_WINDOW &&
    !HEADER_CONTEXT_PATTERNS.some((pattern) => pattern.test(compact.slice(0, 180)));
  if (looksLikeBodyImmediately) {
    return "";
  }

  let cutoff = Math.min(compact.length, MAX_HEADER_CHARS_PER_PAGE);
  for (const marker of TABLE_BODY_MARKERS) {
    const index = compact.search(marker);
    if (index >= 0 && index >= EARLY_BODY_MARKER_WINDOW && index < cutoff) {
      cutoff = index;
    }
  }
  return compact.slice(0, cutoff).trim();
}

function collectHeaderSnippets(pages: string[]): string[] {
  const snippets: string[] = [];
  for (const page of pages) {
    const snippet = extractHeaderSnippet(page);
    if (!snippet) continue;
    snippets.push(snippet);
  }
  return snippets;
}

function splitWords(value: string): string[] {
  return value
    .split(/\s+/)
    .map((word) => cleanDetectedName(word))
    .filter((word) => word.length > 0);
}

function containsToken(text: string, tokenSet: Set<string>): boolean {
  const words = splitWords(normalizeText(text));
  return words.some((word) => tokenSet.has(word));
}

function trimNoiseTokens(
  words: string[],
  trailingNoiseTokens: Set<string>
): string[] {
  const trimmed = [...words];
  while (trimmed.length > 0) {
    const first = normalizeText(trimmed[0]);
    if (LEADING_NOISE_TOKENS.has(first)) {
      trimmed.shift();
      continue;
    }
    break;
  }
  while (trimmed.length > 0) {
    const last = normalizeText(trimmed[trimmed.length - 1]);
    if (trailingNoiseTokens.has(last)) {
      trimmed.pop();
      continue;
    }
    break;
  }
  return trimmed;
}

function sanitizeBarangayName(raw: string): string | null {
  const cleaned = cleanDetectedName(raw);
  if (!cleaned) return null;
  const trimmedTokens = trimNoiseTokens(splitWords(cleaned), TRAILING_NOISE_TOKENS);
  if (trimmedTokens.length === 0 || trimmedTokens.length > 5) return null;
  const candidate = trimmedTokens.join(" ");
  if (!candidate) return null;
  if (/^\d+$/.test(candidate)) return null;
  if (/\b(?:annual|investment|program|project|activity)\b/i.test(candidate)) {
    return null;
  }
  return toTitleCase(candidate);
}

function sanitizeCityName(raw: string): string | null {
  const cleaned = cleanDetectedName(raw);
  if (!cleaned) return null;
  const trimmedTokens = trimNoiseTokens(
    splitWords(cleaned),
    CITY_TRAILING_NOISE_TOKENS
  );
  if (trimmedTokens.length === 0 || trimmedTokens.length > 6) return null;
  const candidate = trimmedTokens.join(" ");
  if (!candidate) return null;
  if (/^\d+$/.test(candidate)) return null;
  return toTitleCase(candidate);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatExpectedLGUName(
  level: SupportedLGULevel,
  expectedLGUName: string
): string | null {
  const base = normalizeLGUName(expectedLGUName);
  if (!base) return null;
  const title = toTitleCase(base);
  if (level === "barangay") {
    return `Barangay ${title}`;
  }
  const normalized = normalizeText(expectedLGUName);
  if (normalized.startsWith("municipality of")) {
    return `Municipality of ${title}`;
  }
  return `City of ${title}`;
}

function isNoiseBarangayCandidate(name: string): boolean {
  const normalized = normalizeText(name);
  if (!normalized) return true;
  if (containsToken(normalized, FACILITY_CONTEXT_TOKENS)) return true;
  if (containsToken(normalized, ROLE_CONTEXT_TOKENS)) return true;
  if (/\b\d+\b/.test(normalized)) return true;
  return false;
}

function isNoiseCityCandidate(name: string): boolean {
  const normalized = normalizeText(name);
  if (!normalized) return true;
  if (containsToken(normalized, FACILITY_CONTEXT_TOKENS)) return true;
  if (containsToken(normalized, ROLE_CONTEXT_TOKENS)) return true;
  if (/\bbarangay\b/.test(normalized)) return true;
  return false;
}

function detectScopeAnchoredFallback(input: {
  pages: string[];
  expectedScope: SupportedLGULevel | null | undefined;
  expectedLGUName: string | null | undefined;
}): ScopeFallbackResult {
  if (!input.expectedScope || !input.expectedLGUName) {
    return {
      detectedLGU: null,
      detectedLGULevel: null,
      confidence: 0,
      explicitMatchCount: 0,
      contextualMatchCount: 0,
      ambiguous: false,
      reasons: ["fallback_inputs_missing"],
    };
  }

  const expectedCanonical = formatExpectedLGUName(
    input.expectedScope,
    input.expectedLGUName
  );
  const expectedBaseName = normalizeLGUName(input.expectedLGUName);
  if (!expectedCanonical || !expectedBaseName) {
    return {
      detectedLGU: null,
      detectedLGULevel: null,
      confidence: 0,
      explicitMatchCount: 0,
      contextualMatchCount: 0,
      ambiguous: false,
      reasons: ["fallback_expected_lgu_missing"],
    };
  }

  const expectedNamePattern = expectedBaseName
    .split(/\s+/)
    .map((part) => escapeRegExp(part))
    .join("\\s+");

  const normalizedPages = input.pages
    .map((page) => normalizeText(page))
    .filter((page) => page.length > 0);
  const normalizedJoined = normalizedPages.join("\n");

  if (input.expectedScope === "barangay") {
    const explicitPattern = new RegExp(
      `\\b(?:barangay|brgy)\\s+${expectedNamePattern}\\b`,
      "g"
    );
    const contextualPattern = new RegExp(
      `\\b${expectedNamePattern}\\b`,
      "g"
    );
    const headerPattern = new RegExp(
      `\\b${expectedNamePattern}\\s+aip\\b|\\bannual\\s+investment\\s+program\\s+\\(?aip\\)?\\b[\\s\\S]{0,80}\\b${expectedNamePattern}\\b`,
      "g"
    );

    const explicitMatchCount =
      normalizedJoined.match(explicitPattern)?.length ?? 0;
    let contextualMatchCount = 0;
    let headerZoneHitCount = 0;
    for (const page of normalizedPages) {
      const headerZone = page.slice(0, 420);
      const contextualMatches = headerZone.match(contextualPattern) ?? [];
      const contextualWithBarangayContext = contextualMatches.filter(() =>
        /\bbarangay\b|\bbrgy\b/.test(headerZone)
      ).length;
      contextualMatchCount += contextualWithBarangayContext;
      if (headerPattern.test(headerZone)) {
        headerZoneHitCount += 1;
      }
      headerPattern.lastIndex = 0;
    }

    const otherNames = new Map<string, number>();
    const otherPattern =
      /\b(?:barangay|brgy)\s+([a-z][a-z0-9'-]*(?:\s+[a-z0-9][a-z0-9'-]*){0,4}?)(?=\s+(?:barangay|brgy|city|municipality|province|annual|investment|aip|baip|fiscal|fy|reference|code|\d{3,4}(?:-\d{1,3}){1,5})\b|$)/g;
    let otherMatch = otherPattern.exec(normalizedJoined);
    while (otherMatch) {
      const rawName = otherMatch[1] ?? "";
      const sanitized = sanitizeBarangayName(rawName);
      if (sanitized) {
        const normalized = normalizeLGUName(sanitized);
        if (
          normalized &&
          normalized !== expectedBaseName &&
          !isNoiseBarangayCandidate(normalized)
        ) {
          otherNames.set(normalized, (otherNames.get(normalized) ?? 0) + 1);
        }
      }
      otherMatch = otherPattern.exec(normalizedJoined);
    }
    const strongestOtherCount = Math.max(0, ...otherNames.values());
    const ambiguous =
      strongestOtherCount >= 2 && strongestOtherCount >= explicitMatchCount;

    let confidence = 0;
    const reasons: string[] = [];
    if (explicitMatchCount > 0) {
      confidence += 6;
      reasons.push("explicit_expected_barangay");
    }
    if (headerZoneHitCount > 0) {
      confidence += 4;
      reasons.push("header_zone_expected_lgu");
    }
    if (contextualMatchCount >= 2) {
      confidence += 2;
      reasons.push("repeated_contextual_matches");
    }
    if (ambiguous) {
      confidence -= 4;
      reasons.push("ambiguous_other_barangay_mentions");
    }

    const applied = !ambiguous && confidence >= 6;
    return {
      detectedLGU: applied ? expectedCanonical : null,
      detectedLGULevel: applied ? "barangay" : null,
      confidence,
      explicitMatchCount,
      contextualMatchCount,
      ambiguous,
      reasons,
    };
  }

  const explicitPattern = new RegExp(
    `\\b(?:city\\s+of|city\\s+government\\s+of|municipality\\s+of)\\s+${expectedNamePattern}\\b`,
    "g"
  );
  const contextualPattern = new RegExp(`\\b${expectedNamePattern}\\b`, "g");
  const explicitMatchCount = normalizedJoined.match(explicitPattern)?.length ?? 0;
  let contextualMatchCount = 0;
  for (const page of normalizedPages) {
    const headerZone = page.slice(0, 420);
    if (/\bcity\b|\bmunicipality\b/.test(headerZone)) {
      contextualMatchCount += headerZone.match(contextualPattern)?.length ?? 0;
    }
  }

  const otherNames = new Map<string, number>();
  const otherPattern =
    /\b(?:city\s+of|city\s+government\s+of|municipality\s+of)\s+([a-z][a-z0-9'-]*(?:\s+[a-z0-9][a-z0-9'-]*){0,5}?)(?=\s+(?:barangay|brgy|annual|investment|aip|baip|fiscal|fy|province|region|\d{3,4}(?:-\d{1,3}){1,5})\b|$)/g;
  let otherMatch = otherPattern.exec(normalizedJoined);
  while (otherMatch) {
    const rawName = otherMatch[1] ?? "";
    const sanitized = sanitizeCityName(rawName);
    if (sanitized) {
      const normalized = normalizeLGUName(sanitized);
      if (normalized && normalized !== expectedBaseName && !isNoiseCityCandidate(normalized)) {
        otherNames.set(normalized, (otherNames.get(normalized) ?? 0) + 1);
      }
    }
    otherMatch = otherPattern.exec(normalizedJoined);
  }
  const strongestOtherCount = Math.max(0, ...otherNames.values());
  const ambiguous =
    strongestOtherCount >= 2 && strongestOtherCount >= explicitMatchCount;

  let confidence = 0;
  const reasons: string[] = [];
  if (explicitMatchCount > 0) {
    confidence += 7;
    reasons.push("explicit_expected_city");
  }
  if (contextualMatchCount >= 2) {
    confidence += 2;
    reasons.push("repeated_contextual_matches");
  }
  if (ambiguous) {
    confidence -= 4;
    reasons.push("ambiguous_other_city_mentions");
  }

  const applied = !ambiguous && confidence >= 7;
  return {
    detectedLGU: applied ? expectedCanonical : null,
    detectedLGULevel: applied ? "city" : null,
    confidence,
    explicitMatchCount,
    contextualMatchCount,
    ambiguous,
    reasons,
  };
}

function scoreBarangayCandidate(input: {
  pageIndex: number;
  mentionIndex: number;
  mentionRaw: string;
  candidateName: string;
  context: string;
}): { score: number; flags: string[] } {
  let score = 0;
  const flags: string[] = [];

  if (input.pageIndex === 0) {
    score += 3;
    flags.push("first_page");
  } else if (input.pageIndex === 1) {
    score += 2;
    flags.push("early_page");
  } else {
    score += 1;
  }

  if (input.mentionIndex < 220) {
    score += 3;
    flags.push("early_position");
  } else if (input.mentionIndex < 500) {
    score += 1;
  }

  if (HEADER_CONTEXT_PATTERNS.some((pattern) => pattern.test(input.context))) {
    score += 3;
    flags.push("header_context");
  }

  if (/\bbarangay\b/i.test(input.mentionRaw)) {
    score += 1;
  }

  const wordCount = splitWords(input.candidateName).length;
  if (wordCount <= 2) {
    score += 2;
  } else if (wordCount <= 4) {
    score += 1;
  } else {
    score -= 2;
    flags.push("too_many_words");
  }

  const normalizedName = normalizeText(input.candidateName);
  const nameWords = splitWords(normalizedName);
  const hasFacilityToken = containsToken(normalizedName, FACILITY_CONTEXT_TOKENS);
  const hasRoleToken = containsToken(normalizedName, ROLE_CONTEXT_TOKENS);
  const firstWord = nameWords[0] ? normalizeText(nameWords[0]) : "";
  const hasNumericTail = /\b\d+\b$/.test(normalizedName);
  const hasContextFacility = containsToken(input.context, FACILITY_CONTEXT_TOKENS);
  const hasContextRole = containsToken(input.context, ROLE_CONTEXT_TOKENS);

  if (hasFacilityToken || hasContextFacility) {
    score -= 8;
    flags.push("facility_context");
  }
  if (hasRoleToken || hasContextRole) {
    score -= 8;
    flags.push("role_context");
  }
  if (hasNumericTail) {
    score -= 5;
    flags.push("numeric_tail");
  }
  if (LEADING_NOISE_TOKENS.has(firstWord)) {
    score -= 7;
    flags.push("noise_prefix");
  }

  return { score, flags };
}

function scoreCityCandidate(input: {
  pageIndex: number;
  mentionIndex: number;
  mentionRaw: string;
  candidateName: string;
  context: string;
}): { score: number; flags: string[] } {
  let score = 8;
  const flags: string[] = ["explicit_city_pattern"];

  if (input.pageIndex === 0) {
    score += 2;
    flags.push("first_page");
  } else if (input.pageIndex === 1) {
    score += 1;
  }

  if (input.mentionIndex < 240) {
    score += 2;
    flags.push("early_position");
  }

  if (HEADER_CONTEXT_PATTERNS.some((pattern) => pattern.test(input.context))) {
    score += 2;
    flags.push("header_context");
  }

  const normalizedName = normalizeText(input.candidateName);
  if (containsToken(normalizedName, FACILITY_CONTEXT_TOKENS)) {
    score -= 6;
    flags.push("facility_context");
  }
  if (containsToken(normalizedName, ROLE_CONTEXT_TOKENS)) {
    score -= 6;
    flags.push("role_context");
  }
  if (/\b\d+\b$/.test(normalizedName)) {
    score -= 4;
    flags.push("numeric_tail");
  }
  if (/\bbarangay\b/.test(normalizedName)) {
    score -= 8;
    flags.push("barangay_noise");
  }
  if (/\b(?:annual|investment|program|plan|fiscal|year)\b/.test(normalizedName)) {
    score -= 5;
    flags.push("title_noise");
  }

  return { score, flags };
}

function aggregateCandidates(candidates: MentionCandidate[]): CandidateAggregate[] {
  const byName = new Map<string, CandidateAggregate>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.normalizedName}`;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, {
        canonicalName: candidate.canonicalName,
        normalizedName: candidate.normalizedName,
        score: candidate.score,
        hits: 1,
        pages: new Set([candidate.pageNumber]),
        flags: new Set(candidate.flags),
      });
      continue;
    }
    existing.score += candidate.score;
    existing.hits += 1;
    existing.pages.add(candidate.pageNumber);
    candidate.flags.forEach((flag) => existing.flags.add(flag));
  }

  return [...byName.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.hits !== a.hits) return b.hits - a.hits;
    return a.canonicalName.localeCompare(b.canonicalName);
  });
}

function selectBestCandidate(
  aggregates: CandidateAggregate[],
  minScore: number
): CandidateSelection {
  if (aggregates.length === 0) {
    return { selected: null, ambiguous: false };
  }
  const top = aggregates[0];
  if (top.score < minScore) {
    return { selected: null, ambiguous: false };
  }
  const second = aggregates[1];
  if (second && second.score === top.score) {
    return { selected: null, ambiguous: true };
  }
  return { selected: top, ambiguous: false };
}

function summarizeCandidates(
  aggregates: CandidateAggregate[]
): IdentityCandidateSummary[] {
  return aggregates.slice(0, 5).map((candidate) => ({
    name: candidate.canonicalName,
    score: candidate.score,
    hits: candidate.hits,
    pages: [...candidate.pages].sort((a, b) => a - b),
    flags: [...candidate.flags].sort(),
  }));
}

function detectCityCandidates(headerSnippets: string[]): MentionCandidate[] {
  const candidates: MentionCandidate[] = [];
  const cityPatterns: Array<{
    pattern: RegExp;
    prefix: "City of" | "Municipality of";
  }> = [
    {
      pattern:
        /\bcity\s+government\s+of\s+([A-Za-z][A-Za-z0-9.'-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.'-]*){0,5}?)(?=\s+(?:barangay|brgy\.?|annual|investment|aip|baip|fiscal|fy|province|region|\d{3,4}(?:-\d{1,3}){1,5})\b|$)/gi,
      prefix: "City of",
    },
    {
      pattern:
        /\bcity\s+of\s+([A-Za-z][A-Za-z0-9.'-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.'-]*){0,5}?)(?=\s+(?:barangay|brgy\.?|annual|investment|aip|baip|fiscal|fy|province|region|\d{3,4}(?:-\d{1,3}){1,5})\b|$)/gi,
      prefix: "City of",
    },
    {
      pattern:
        /\bmunicipality\s+of\s+([A-Za-z][A-Za-z0-9.'-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.'-]*){0,5}?)(?=\s+(?:barangay|brgy\.?|annual|investment|aip|baip|fiscal|fy|province|region|\d{3,4}(?:-\d{1,3}){1,5})\b|$)/gi,
      prefix: "Municipality of",
    },
  ];

  for (let pageIndex = 0; pageIndex < headerSnippets.length; pageIndex += 1) {
    const snippet = headerSnippets[pageIndex];
    for (const { pattern, prefix } of cityPatterns) {
      pattern.lastIndex = 0;
      let match = pattern.exec(snippet);
      while (match) {
        const rawName = typeof match[1] === "string" ? match[1] : "";
        const sanitizedName = sanitizeCityName(rawName);
        if (sanitizedName) {
          const mentionRaw = match[0] ?? "";
          const context = snippet.slice(
            Math.max(0, match.index - 120),
            Math.min(snippet.length, match.index + mentionRaw.length + 120)
          );
          const { score, flags } = scoreCityCandidate({
            pageIndex,
            mentionIndex: match.index,
            mentionRaw,
            candidateName: sanitizedName,
            context,
          });
          candidates.push({
            kind: "city",
            canonicalName: `${prefix} ${sanitizedName}`,
            normalizedName: normalizeText(`${prefix} ${sanitizedName}`),
            score,
            pageNumber: pageIndex + 1,
            flags,
          });
        }
        match = pattern.exec(snippet);
      }
    }
  }

  return candidates;
}

function detectBarangayCandidates(headerSnippets: string[]): MentionCandidate[] {
  const candidates: MentionCandidate[] = [];
  const barangayPattern =
    /\b(?:barangay|brgy\.?)\s+([A-Za-z][A-Za-z0-9.'-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.'-]*){0,4}?)(?=\s+(?:barangay|brgy\.?|city|municipality|province|annual|investment|aip|baip|fiscal|fy|reference|code|\d{3,4}(?:-\d{1,3}){1,5})\b|$)/gi;

  for (let pageIndex = 0; pageIndex < headerSnippets.length; pageIndex += 1) {
    const snippet = headerSnippets[pageIndex];
    barangayPattern.lastIndex = 0;
    let match = barangayPattern.exec(snippet);
    while (match) {
      const rawName = typeof match[1] === "string" ? match[1] : "";
      const sanitizedName = sanitizeBarangayName(rawName);
      if (sanitizedName) {
        const mentionRaw = match[0] ?? "";
        const context = snippet.slice(
          Math.max(0, match.index - 120),
          Math.min(snippet.length, match.index + mentionRaw.length + 120)
        );
        const { score, flags } = scoreBarangayCandidate({
          pageIndex,
          mentionIndex: match.index,
          mentionRaw,
          candidateName: sanitizedName,
          context,
        });
        candidates.push({
          kind: "barangay",
          canonicalName: `Barangay ${sanitizedName}`,
          normalizedName: normalizeText(`Barangay ${sanitizedName}`),
          score,
          pageNumber: pageIndex + 1,
          flags,
        });
      }
      match = barangayPattern.exec(snippet);
    }
  }

  return candidates;
}

function detectLGULevel(input: {
  lines: string[];
  documentType: "AIP" | "BAIP" | "unknown";
  barangaySelection: CandidateSelection;
  citySelection: CandidateSelection;
}): {
  level: SupportedLGULevel | null;
  signals: { barangay: number; city: number };
} {
  const headerLines = input.lines.slice(0, 60);
  let barangaySignals = 0;
  let citySignals = 0;

  for (const line of headerLines) {
    const normalized = normalizeText(line);
    if (!normalized) continue;

    if (/\bbaip\b/.test(normalized)) barangaySignals += 6;
    if (/\bbarangay\s+annual\s+investment\s+program\b/.test(normalized)) {
      barangaySignals += 5;
    }
    if (/\bbarangay\b|\bbrgy\b/.test(normalized)) barangaySignals += 1;
    if (
      /\bcity\s+of\b|\bcity\s+government\b|\bmunicipality\s+of\b/.test(
        normalized
      )
    ) {
      citySignals += 3;
    }
  }

  if (input.documentType === "BAIP") {
    barangaySignals += 4;
  }
  if (input.barangaySelection.selected) {
    barangaySignals += 2;
  }
  if (input.citySelection.selected) {
    citySignals += 2;
  }

  if (citySignals === 0 && barangaySignals === 0) {
    return {
      level: null,
      signals: { barangay: barangaySignals, city: citySignals },
    };
  }
  if (citySignals > barangaySignals) {
    return {
      level: "city",
      signals: { barangay: barangaySignals, city: citySignals },
    };
  }
  if (barangaySignals > citySignals) {
    return {
      level: "barangay",
      signals: { barangay: barangaySignals, city: citySignals },
    };
  }
  return {
    level: null,
    signals: { barangay: barangaySignals, city: citySignals },
  };
}

export function detectDocumentIdentity(input: {
  pages: string[];
  expectedScope?: SupportedLGULevel | null;
  expectedLGUName?: string | null;
}): IdentityDetectionResult {
  const pages = input.pages.slice(0, Math.max(1, input.pages.length)).filter(Boolean);
  const joined = pages.join("\n");
  const headerSnippets = collectHeaderSnippets(pages);
  const headerLines = splitLines(headerSnippets.join("\n"));
  const isAipDocument =
    /\bannual\s+investment\s+(program|plan)\b/i.test(joined) ||
    /\baip\b/i.test(joined) ||
    /\bbaip\b/i.test(joined);
  const documentType = detectDocumentType(joined);
  const detectedYear = detectYear(joined);

  const barangayCandidates = aggregateCandidates(
    detectBarangayCandidates(headerSnippets)
  );
  const cityCandidates = aggregateCandidates(detectCityCandidates(headerSnippets));
  const barangaySelection = selectBestCandidate(
    barangayCandidates,
    BARANGAY_CONFIDENCE_THRESHOLD
  );
  const citySelection = selectBestCandidate(cityCandidates, CITY_CONFIDENCE_THRESHOLD);

  const levelDecision = detectLGULevel({
    lines: headerLines,
    documentType,
    barangaySelection,
    citySelection,
  });
  let detectedLGULevel = levelDecision.level;

  if (!detectedLGULevel) {
    if (barangaySelection.selected && !citySelection.selected) {
      detectedLGULevel = "barangay";
    } else if (citySelection.selected && !barangaySelection.selected) {
      detectedLGULevel = "city";
    }
  }

  let detectedLGU: string | null = null;
  let detectedParentLGU: string | null = null;
  let identitySource: "primary_header" | "scope_fallback" | null = null;
  if (detectedLGULevel === "city") {
    detectedLGU = citySelection.selected?.canonicalName ?? null;
  } else if (detectedLGULevel === "barangay") {
    detectedLGU = barangaySelection.selected?.canonicalName ?? null;
    detectedParentLGU = citySelection.selected?.canonicalName ?? null;
  }
  if (detectedLGU) {
    identitySource = "primary_header";
  }

  const fallback = detectScopeAnchoredFallback({
    pages,
    expectedScope: input.expectedScope,
    expectedLGUName: input.expectedLGUName,
  });
  if (!detectedLGU && fallback.detectedLGU && fallback.detectedLGULevel) {
    detectedLGU = fallback.detectedLGU;
    detectedLGULevel = fallback.detectedLGULevel;
    identitySource = "scope_fallback";
  }

  const diagnostics: IdentityDiagnostics = {
    headerSnippets: headerSnippets.map((snippet) => snippet.slice(0, 220)),
    barangayCandidates: summarizeCandidates(barangayCandidates),
    cityCandidates: summarizeCandidates(cityCandidates),
    identitySource,
    levelSignals: levelDecision.signals,
    ambiguous: {
      barangay: barangaySelection.ambiguous,
      city: citySelection.ambiguous,
    },
    fallback: {
      attempted: Boolean(input.expectedScope && input.expectedLGUName),
      applied: identitySource === "scope_fallback",
      confidence: fallback.confidence,
      explicitMatchCount: fallback.explicitMatchCount,
      contextualMatchCount: fallback.contextualMatchCount,
      ambiguous: fallback.ambiguous,
      reasons: fallback.reasons,
    },
  };

  return {
    isAipDocument: isAipDocument || documentType !== "unknown",
    documentType,
    detectedYear,
    detectedLGU,
    detectedLGULevel,
    detectedParentLGU,
    diagnostics,
  };
}
