import { describe, expect, it } from "vitest";
import { evaluateVerifierPolicy, verifyRetrievalGrounding, verifyStructuredClaims } from "@/lib/chat/verifier-policy";
import type { ChatCitation } from "@/lib/repos/chat/types";

const sampleCitation: ChatCitation = {
  sourceId: "S1",
  snippet: "Sample cited evidence.",
  scopeType: "barangay",
  scopeName: "Barangay Mamatid",
};

describe("verifier policy", () => {
  it("passes SQL-only structured answers without citations when values match", () => {
    const result = evaluateVerifierPolicy({
      mode: "structured",
      citations: [],
      structuredExpected: [{ value: 1200 }],
      structuredActual: [{ value: 1200 }],
    });
    expect(result.passed).toBe(true);
  });

  it("fails structured mismatch", () => {
    const result = evaluateVerifierPolicy({
      mode: "structured",
      citations: [],
      structuredExpected: [{ value: 1200 }],
      structuredActual: [{ value: 900 }],
    });
    expect(result.passed).toBe(false);
  });

  it("fails retrieval verification when no citations are present", () => {
    expect(
      verifyRetrievalGrounding({
        citations: [],
      })
    ).toBe(false);
  });

  it("passes retrieval verification when citations are present", () => {
    expect(
      verifyRetrievalGrounding({
        citations: [sampleCitation],
      })
    ).toBe(true);
  });

  it("keeps mixed mode available but requires both checks", () => {
    const result = evaluateVerifierPolicy({
      mode: "mixed",
      citations: [sampleCitation],
      structuredExpected: [{ value: 1200 }],
      structuredActual: [{ value: 1200 }],
    });
    expect(result.mode).toBe("mixed");
    expect(result.passed).toBe(true);
  });

  it("verifies structured claims helper directly", () => {
    expect(verifyStructuredClaims({ expected: ["A", "B"], actual: ["A", "B"] })).toBe(true);
    expect(verifyStructuredClaims({ expected: ["A", "B"], actual: ["A"] })).toBe(false);
  });
});
