import type { ChatCitation, ChatRetrievalMeta } from "@/lib/repos/chat/types";

export type VerifierMode = "structured" | "retrieval" | "mixed";

export type VerifierPolicyInput = {
  mode: VerifierMode;
  citations: ChatCitation[];
  retrievalMeta?: ChatRetrievalMeta;
  structuredExpected?: unknown;
  structuredActual?: unknown;
};

export type VerifierPolicyResult = {
  mode: VerifierMode;
  passed: boolean;
  reasonCode:
    | "structured_match"
    | "structured_mismatch"
    | "narrative_grounded"
    | "narrative_ungrounded"
    | "mixed_pass"
    | "mixed_fail";
};

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeys(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
    next[key] = sortObjectKeys(record[key]);
  }
  return next;
}

export function verifyStructuredClaims(input: {
  expected?: unknown;
  actual?: unknown;
}): boolean {
  if (input.expected === undefined || input.actual === undefined) {
    return true;
  }
  return JSON.stringify(sortObjectKeys(input.expected)) === JSON.stringify(sortObjectKeys(input.actual));
}

export function verifyRetrievalGrounding(input: {
  citations: ChatCitation[];
  retrievalMeta?: ChatRetrievalMeta;
}): boolean {
  if (!Array.isArray(input.citations) || input.citations.length === 0) {
    return false;
  }
  if (!input.retrievalMeta) {
    return true;
  }
  if (input.retrievalMeta.reason === "validation_failed") {
    return false;
  }
  if (input.retrievalMeta.reason === "verifier_failed") {
    return false;
  }
  if (input.retrievalMeta.verifierPassed === false) {
    return false;
  }
  if (input.retrievalMeta.verifierPolicyPassed === false) {
    return false;
  }
  return true;
}

export function evaluateVerifierPolicy(input: VerifierPolicyInput): VerifierPolicyResult {
  const structuredPassed = verifyStructuredClaims({
    expected: input.structuredExpected,
    actual: input.structuredActual,
  });
  const retrievalPassed = verifyRetrievalGrounding({
    citations: input.citations,
    retrievalMeta: input.retrievalMeta,
  });

  if (input.mode === "structured") {
    return {
      mode: input.mode,
      passed: structuredPassed,
      reasonCode: structuredPassed ? "structured_match" : "structured_mismatch",
    };
  }

  if (input.mode === "retrieval") {
    return {
      mode: input.mode,
      passed: retrievalPassed,
      reasonCode: retrievalPassed ? "narrative_grounded" : "narrative_ungrounded",
    };
  }

  const hasStructuredSnapshot =
    input.structuredExpected !== undefined && input.structuredActual !== undefined;
  const requireNarrativeGrounding = input.retrievalMeta?.mixedNarrativeIncluded !== false;

  const passed =
    hasStructuredSnapshot &&
    structuredPassed &&
    (requireNarrativeGrounding ? retrievalPassed : true);

  return {
    mode: input.mode,
    passed,
    reasonCode: passed ? "mixed_pass" : "mixed_fail",
  };
}
