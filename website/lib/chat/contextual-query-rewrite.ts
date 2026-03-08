import type { ChatMessage } from "@/lib/repos/chat/types";

export type ContextualRewriteResult =
  | {
      kind: "unchanged";
      query: string;
      reason: "not_follow_up" | "standalone" | "no_anchor";
    }
  | {
      kind: "rewritten";
      query: string;
      reason:
        | "safe_year_follow_up"
        | "safe_citation_follow_up"
        | "safe_scope_follow_up"
        | "safe_compare_follow_up"
        | "risky_follow_up_with_clear_anchor";
      anchor: string;
      risky: boolean;
    }
  | {
      kind: "clarify";
      reason: "risky_follow_up_ambiguous_anchor";
      prompt: string;
    };

type RecentTurns = {
  userTurns: ChatMessage[];
  assistantTurns: ChatMessage[];
};

export const CONTEXTUAL_REWRITE_MAX_USER_TURNS = 3;
export const CONTEXTUAL_REWRITE_MAX_ASSISTANT_TURNS = 2;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter((part) => part.length >= 2));
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = tokenSet(a);
  const bTokens = tokenSet(b);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  const union = new Set([...aTokens, ...bTokens]);
  const intersect = [...aTokens].filter((token) => bTokens.has(token));
  return union.size === 0 ? 0 : intersect.length / union.size;
}

function isGreeting(text: string): boolean {
  const normalized = normalize(text);
  return (
    normalized === "hello" ||
    normalized === "hi" ||
    normalized === "hey" ||
    normalized === "good morning" ||
    normalized === "good afternoon" ||
    normalized === "good evening"
  );
}

function hasDomainCues(text: string): boolean {
  const normalized = normalize(text);
  if (/\b20\d{2}\b/.test(normalized)) return true;
  return [
    "aip",
    "budget",
    "project",
    "program",
    "ref",
    "fund source",
    "sector",
    "barangay",
    "city",
    "municipality",
    "total",
    "top",
    "compare",
    "citation",
    "year",
    "fy",
  ].some((cue) => normalized.includes(cue));
}

function isLikelyStandalone(message: string): boolean {
  const normalized = normalize(message);
  if (!hasDomainCues(normalized)) return false;
  if (/^(how about|what about|and for|compare it|can you cite it|cite it)\b/.test(normalized)) {
    return false;
  }
  if (/^(what about this|what about that|how about that one|explain that)\b/.test(normalized)) {
    return false;
  }
  return true;
}

function getRecentTurns(input: {
  messages: ChatMessage[];
  currentMessageId?: string;
}): RecentTurns {
  const eligible = input.messages.filter((message) => message.id !== input.currentMessageId);
  const userTurns: ChatMessage[] = [];
  const assistantTurns: ChatMessage[] = [];

  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const message = eligible[index];
    if (message.role === "user" && userTurns.length < CONTEXTUAL_REWRITE_MAX_USER_TURNS) {
      userTurns.push(message);
      continue;
    }
    if (
      message.role === "assistant" &&
      assistantTurns.length < CONTEXTUAL_REWRITE_MAX_ASSISTANT_TURNS
    ) {
      assistantTurns.push(message);
    }
    if (
      userTurns.length >= CONTEXTUAL_REWRITE_MAX_USER_TURNS &&
      assistantTurns.length >= CONTEXTUAL_REWRITE_MAX_ASSISTANT_TURNS
    ) {
      break;
    }
  }

  return {
    userTurns,
    assistantTurns,
  };
}

function getClearAnchorQuery(turns: RecentTurns): string | null {
  const candidates = turns.userTurns.filter((message) => hasDomainCues(message.content));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].content;

  const first = candidates[0]?.content ?? "";
  const second = candidates[1]?.content ?? "";
  if (tokenOverlap(first, second) < 0.2) {
    return null;
  }
  return first;
}

function getLatestDomainAnchorQuery(turns: RecentTurns): string | null {
  const candidate = turns.userTurns.find((message) => hasDomainCues(message.content));
  return candidate?.content ?? null;
}

function replaceYear(anchor: string, year: number): string {
  const withReplacedYear = anchor.replace(/\b20\d{2}\b/g, String(year));
  if (withReplacedYear !== anchor) return withReplacedYear;
  if (/\bthis year\b/i.test(anchor)) {
    return anchor.replace(/\bthis year\b/i, `FY ${year}`);
  }
  return `${anchor.replace(/\?+$/, "")} for FY ${year}`;
}

function rewriteScope(anchor: string, scopePhrase: string): string {
  const scopePattern = /\b(barangay|city|municipality)\s+[a-z0-9.\- ]+/i;
  if (scopePattern.test(anchor)) {
    return anchor.replace(scopePattern, scopePhrase.trim());
  }
  return `${anchor.replace(/\?+$/, "")} for ${scopePhrase.trim()}`;
}

function toScopePhrase(anchor: string, rawScope: string): string | null {
  const cleaned = rawScope.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (/^(it|that|this|there|here)$/i.test(cleaned)) return null;
  if (/^(barangay|brgy\.?|city|municipality)\s+/i.test(cleaned)) {
    return cleaned.replace(/^brgy\.?\s+/i, "Barangay ");
  }

  const anchorScopeMatch = anchor.match(/\b(barangay|city|municipality)\b/i);
  const inferredScopeType = anchorScopeMatch?.[1] ?? "Barangay";
  return `${inferredScopeType} ${cleaned}`;
}

export function maybeRewriteFollowUpQuery(input: {
  message: string;
  messages: ChatMessage[];
  currentMessageId?: string;
}): ContextualRewriteResult {
  const message = input.message.trim();
  if (!message) return { kind: "unchanged", query: input.message, reason: "not_follow_up" };
  if (isGreeting(message)) return { kind: "unchanged", query: input.message, reason: "standalone" };
  if (isLikelyStandalone(message)) {
    return { kind: "unchanged", query: input.message, reason: "standalone" };
  }

  const normalized = normalize(message);
  const turns = getRecentTurns({ messages: input.messages, currentMessageId: input.currentMessageId });
  const anchor = getClearAnchorQuery(turns);
  const latestDomainAnchor = getLatestDomainAnchorQuery(turns);

  const safeYearMatch = normalized.match(/^(?:how|what)\s+about\s+(?:fy\s*)?(20\d{2})\??$/);
  if (safeYearMatch) {
    const safeAnchor = anchor ?? latestDomainAnchor;
    if (!safeAnchor) return { kind: "unchanged", query: input.message, reason: "no_anchor" };
    const year = Number.parseInt(safeYearMatch[1] ?? "", 10);
    if (!Number.isInteger(year)) return { kind: "unchanged", query: input.message, reason: "no_anchor" };
    return {
      kind: "rewritten",
      query: replaceYear(safeAnchor, year),
      reason: "safe_year_follow_up",
      anchor: safeAnchor,
      risky: false,
    };
  }

  if (/^(?:can you\s+)?(?:cite(?:\s+it|\s+that|\s+this)?|add citations?|with citations)\??$/.test(normalized)) {
    const safeAnchor = anchor ?? latestDomainAnchor;
    if (!safeAnchor) return { kind: "unchanged", query: input.message, reason: "no_anchor" };
    return {
      kind: "rewritten",
      query: `${safeAnchor.replace(/\?+$/, "")}. Explain with citations from published AIP chunks.`,
      reason: "safe_citation_follow_up",
      anchor: safeAnchor,
      risky: false,
    };
  }

  const safeScopeMatch = normalized.match(
    /^(?:and\s+)?for\s+([a-z0-9.\- ]+?)(?:\s+only)?\??$/
  );
  if (safeScopeMatch) {
    const safeAnchor = anchor ?? latestDomainAnchor;
    if (!safeAnchor) return { kind: "unchanged", query: input.message, reason: "no_anchor" };
    const scopePhrase = toScopePhrase(safeAnchor, safeScopeMatch[1] ?? "");
    if (!scopePhrase) return { kind: "unchanged", query: input.message, reason: "no_anchor" };
    return {
      kind: "rewritten",
      query: rewriteScope(safeAnchor, scopePhrase),
      reason: "safe_scope_follow_up",
      anchor: safeAnchor,
      risky: false,
    };
  }

  if (/^compare\s+(?:it|that|this)\s+with\s+last\s+year\??$/.test(normalized)) {
    const safeAnchor = anchor ?? latestDomainAnchor;
    if (!safeAnchor) return { kind: "unchanged", query: input.message, reason: "no_anchor" };
    const yearMatch = safeAnchor.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      const year = Number.parseInt(yearMatch[1] ?? "", 10);
      if (Number.isInteger(year)) {
        return {
          kind: "rewritten",
          query: `Compare ${replaceYear(safeAnchor, year)} with FY ${year - 1}.`,
          reason: "safe_compare_follow_up",
          anchor: safeAnchor,
          risky: false,
        };
      }
    }
    return {
      kind: "rewritten",
      query: `Compare ${safeAnchor.replace(/\?+$/, "")} with last year.`,
      reason: "safe_compare_follow_up",
      anchor: safeAnchor,
      risky: false,
    };
  }

  const riskyTrigger =
    /^what\s+about\s+this\??$/.test(normalized) ||
    /^how\s+about\s+that\s+one\??$/.test(normalized) ||
    /^explain\s+that\??$/.test(normalized);

  if (!riskyTrigger) {
    return { kind: "unchanged", query: input.message, reason: "not_follow_up" };
  }

  if (!anchor) {
    return {
      kind: "clarify",
      reason: "risky_follow_up_ambiguous_anchor",
      prompt:
        "Can you clarify what you mean by 'that'? Please restate the project/topic and, if possible, include scope or year.",
    };
  }

  return {
    kind: "rewritten",
    query: `Explain ${anchor.replace(/\?+$/, "")}.`,
    reason: "risky_follow_up_with_clear_anchor",
    anchor,
    risky: true,
  };
}
