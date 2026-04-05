export const CANONICAL_INSUFFICIENT_CONTEXT_REPLY =
  "I couldn\u2019t find a reliable answer for that in the published AIP records.";

const LEGACY_INSUFFICIENT_CONTEXT_REPLY = "Insufficient context.";

function normalizeInsufficientContextText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u2019]/g, "'")
    .replace(/\s+/g, " ");
}

const INSUFFICIENT_CONTEXT_REPLY_SET = new Set(
  [
    CANONICAL_INSUFFICIENT_CONTEXT_REPLY,
    LEGACY_INSUFFICIENT_CONTEXT_REPLY,
    LEGACY_INSUFFICIENT_CONTEXT_REPLY.replace(".", ""),
  ].map(normalizeInsufficientContextText)
);

export function isInsufficientContextReply(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const normalized = normalizeInsufficientContextText(value);
  return INSUFFICIENT_CONTEXT_REPLY_SET.has(normalized);
}