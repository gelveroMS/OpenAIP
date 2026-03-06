export type TotalsScopeReason =
  | "explicit_barangay"
  | "explicit_our_barangay"
  | "default_user_barangay"
  | "unknown";

export type BarangayRef = {
  id: string;
  name: string;
};

const EXPLICIT_BARANGAY_PATTERN =
  /\b(?:barangay|brgy\.?)\s+([a-z0-9][a-z0-9 .,'-]{0,80}?)(?=\s+(?:for|fy|fiscal|year|total|investment|program|grand)\b|[.,;:!?)]|$)/gi;
const BARE_SCOPE_PATTERN =
  /\b(?:of|for|in)\s+([a-z][a-z\s-]{1,40}?)(?=\s+(?:for|fy|fiscal|year|total|investment|program|grand|budget|spending|allocation|and)\b|$)/gi;

const OWN_BARANGAY_PATTERNS: RegExp[] = [
  /\bin\s+our\s+barangay\b/i,
  /\bfor\s+our\s+barangay\b/i,
  /\bin\s+my\s+barangay\b/i,
  /\bfor\s+my\s+barangay\b/i,
];

const BARANGAY_DETECTOR_STOP_WORDS = new Set(["our", "my", "aming", "namin", "for", "fy", "fiscal", "year"]);

function hasOwnBarangayCue(message: string): boolean {
  return OWN_BARANGAY_PATTERNS.some((pattern) => pattern.test(message));
}

function normalizeMessageForDetection(message: string): string {
  return message.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeMessageForBareScopeDetection(message: string): string {
  return message
    .toLowerCase()
    .replace(/([a-z0-9])'s\b/g, "$1")
    .replace(/[()]/g, " ")
    .replace(/[.,;:!?'"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupDetectedBarangayName(raw: string): string | null {
  const cleaned = raw
    .replace(/[()]/g, " ")
    .replace(/[.,;:!?'"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const normalizedForMatch = normalizeBarangayNameForMatch(cleaned);
  if (!normalizedForMatch) return null;
  const firstToken = normalizedForMatch.split(/\s+/)[0] ?? "";
  if (BARANGAY_DETECTOR_STOP_WORDS.has(firstToken)) return null;

  return cleaned;
}

export function normalizeBarangayNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/([a-z0-9])'s\b/g, "$1")
    .replace(/[()]/g, " ")
    .replace(/[.,;:!?'"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:barangay|brgy)\s+/, "")
    .trim();
}

export function detectExplicitBarangayMention(message: string): string | null {
  const normalizedMessage = normalizeMessageForDetection(message);
  if (!normalizedMessage) return null;

  EXPLICIT_BARANGAY_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = EXPLICIT_BARANGAY_PATTERN.exec(normalizedMessage);
  while (match) {
    const candidate = cleanupDetectedBarangayName(match[1] ?? "");
    if (candidate) return candidate;
    match = EXPLICIT_BARANGAY_PATTERN.exec(normalizedMessage);
  }

  return null;
}

export function detectBareBarangayScopeMention(
  message: string,
  knownBarangayNamesNormalized: Set<string>
): string | null {
  const normalizedMessage = normalizeMessageForBareScopeDetection(message);
  if (!normalizedMessage || knownBarangayNamesNormalized.size === 0) return null;

  BARE_SCOPE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = BARE_SCOPE_PATTERN.exec(normalizedMessage);
  while (match) {
    const candidate = normalizeBarangayNameForMatch(match[1] ?? "");
    if (candidate && knownBarangayNamesNormalized.has(candidate)) {
      return candidate;
    }
    match = BARE_SCOPE_PATTERN.exec(normalizedMessage);
  }

  const matchedKnownBarangays = Array.from(knownBarangayNamesNormalized).filter((name) =>
    new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalizedMessage)
  );
  const hasBudgetCue =
    normalizedMessage.includes("budget") ||
    normalizedMessage.includes("spending") ||
    normalizedMessage.includes("allocation") ||
    normalizedMessage.includes("total");
  if (hasBudgetCue && matchedKnownBarangays.length === 1) {
    return matchedKnownBarangays[0] ?? null;
  }

  const standaloneCandidate = normalizeBarangayNameForMatch(normalizedMessage);
  if (standaloneCandidate && knownBarangayNamesNormalized.has(standaloneCandidate)) {
    return standaloneCandidate;
  }

  return null;
}

export function resolveTotalsScope(
  message: string,
  userBarangay: BarangayRef | null,
  explicitBarangay?: BarangayRef | null
): {
  barangayId: string | null;
  barangayName: string | null;
  scopeReason: TotalsScopeReason;
} {
  if (hasOwnBarangayCue(message) && userBarangay) {
    return {
      barangayId: userBarangay.id,
      barangayName: userBarangay.name,
      scopeReason: "explicit_our_barangay",
    };
  }

  if (explicitBarangay) {
    return {
      barangayId: explicitBarangay.id,
      barangayName: explicitBarangay.name,
      scopeReason: "explicit_barangay",
    };
  }

  if (userBarangay) {
    return {
      barangayId: userBarangay.id,
      barangayName: userBarangay.name,
      scopeReason: "default_user_barangay",
    };
  }

  return {
    barangayId: null,
    barangayName: null,
    scopeReason: "unknown",
  };
}
