import type { RouteDecision } from "@/lib/chat/router-decision";

const COMPOUND_CONJUNCTION_PATTERN =
  /\b(?:and also|and then|and|also|plus|compare|vs|versus)\b/i;
const WH_PATTERN = /\b(what|why|how|who|when|where|which)\b/gi;

export type SubAskPlan = {
  index: number;
  text: string;
};

export type QueryPlan = {
  isCompound: boolean;
  subAsks: SubAskPlan[];
};

function normalizePart(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hasMultipleWhWords(text: string): boolean {
  const matches = text.toLowerCase().match(WH_PATTERN) ?? [];
  const unique = Array.from(new Set(matches));
  return unique.length >= 2;
}

export function detectCompoundAsk(text: string): boolean {
  const normalized = normalizePart(text);
  if (!normalized) return false;

  const questionCount = (normalized.match(/\?/g) ?? []).length;
  if (questionCount >= 2) return true;
  if (COMPOUND_CONJUNCTION_PATTERN.test(normalized)) return true;
  if (hasMultipleWhWords(normalized)) return true;
  return false;
}

export function splitIntoSubAsks(text: string, maxParts = 2): SubAskPlan[] {
  const normalized = normalizePart(text);
  if (!normalized) return [];

  const questionParts = normalized
    .split("?")
    .map((part) => normalizePart(part))
    .filter(Boolean);
  const baseParts = questionParts.length > 0 ? questionParts : [normalized];

  const exploded: string[] = [];
  for (const base of baseParts) {
    const parts = base
      .split(/\b(?:and also|and then|plus|also|and)\b/i)
      .map((part) => normalizePart(part))
      .filter(Boolean);

    if (parts.length <= 1) {
      exploded.push(base);
      continue;
    }

    for (const part of parts) {
      exploded.push(part);
    }
  }

  const deduped = exploded.filter((part, index, all) => all.indexOf(part) === index);
  const sliced = deduped.slice(0, Math.max(1, maxParts));
  return sliced.map((part, index) => ({ index: index + 1, text: part }));
}

export function planQuery(text: string, maxParts = 2): QueryPlan {
  const isCompound = detectCompoundAsk(text);
  const subAsks = isCompound ? splitIntoSubAsks(text, maxParts) : [{ index: 1, text: normalizePart(text) }];
  return {
    isCompound,
    subAsks: subAsks.filter((sub) => sub.text.length > 0),
  };
}

export function shouldClarifyBeforeExecution(decisions: RouteDecision[]): boolean {
  if (decisions.length === 0) return false;
  if (decisions.some((decision) => decision.kind === "CLARIFY")) return true;

  const kinds = decisions.map((decision) => decision.kind);
  const uniqueKinds = Array.from(new Set(kinds));
  return uniqueKinds.length > 1;
}
