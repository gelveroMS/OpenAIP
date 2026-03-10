import type { SupportedLGULevel } from "./constants";

const YEAR_PATTERN = /\b(20\d{2}|2100)\b/g;

export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeLGUName(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return normalized
    .replace(/^(?:city government of|city of|municipality of|province of)\s+/, "")
    .replace(/^(?:barangay|brgy)\s+/, "")
    .replace(/^(?:city|municipality|province)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLGULevel(
  value: string | null | undefined
): SupportedLGULevel | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (normalized === "barangay" || normalized === "brgy") return "barangay";
  if (
    normalized === "city" ||
    normalized === "city government" ||
    normalized === "municipality" ||
    normalized === "municipal"
  ) {
    return "city";
  }
  return null;
}

export function extractYearCandidates(value: string | null | undefined): number[] {
  const normalized = value ?? "";
  if (!normalized) return [];
  const found = new Set<number>();
  YEAR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = YEAR_PATTERN.exec(normalized);
  while (match) {
    const year = Number(match[1]);
    if (Number.isInteger(year)) {
      found.add(year);
    }
    match = YEAR_PATTERN.exec(normalized);
  }
  return Array.from(found).sort((a, b) => b - a);
}

export function compareLGUIdentity(
  detectedName: string | null | undefined,
  expectedName: string | null | undefined
): boolean {
  const detected = normalizeLGUName(detectedName);
  const expected = normalizeLGUName(expectedName);
  if (!detected || !expected) return false;
  if (detected === expected) return true;
  return detected.includes(expected) || expected.includes(detected);
}

export function compareLGULevel(
  detected: string | null | undefined,
  expected: string | null | undefined
): boolean {
  const detectedLevel = normalizeLGULevel(detected);
  const expectedLevel = normalizeLGULevel(expected);
  if (!detectedLevel || !expectedLevel) return false;
  return detectedLevel === expectedLevel;
}
