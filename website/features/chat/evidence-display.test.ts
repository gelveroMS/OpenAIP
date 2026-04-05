import { describe, expect, it } from "vitest";
import { isSystemEvidenceCitation } from "@/lib/chat/evidence-display";

describe("isSystemEvidenceCitation", () => {
  it("treats S0 insufficient citations as fallback system evidence", () => {
    expect(
      isSystemEvidenceCitation({
        sourceId: "S0",
        scopeType: "system",
        snippet: "No retrieval citations were produced for this response.",
        insufficient: true,
      })
    ).toBe(true);
  });

  it("treats known fallback snippets as fallback when insufficient is true", () => {
    expect(
      isSystemEvidenceCitation({
        sourceId: "L1",
        scopeType: "system",
        snippet: "Pipeline request failed.",
        insufficient: true,
      })
    ).toBe(true);
  });

  it("does not hide non-fallback system totals citations", () => {
    expect(
      isSystemEvidenceCitation({
        sourceId: "S12",
        scopeType: "system",
        snippet: "Total investment program value from structured totals table.",
        insufficient: false,
        metadata: {
          type: "aip_totals",
          aip_id: "aip-1",
        },
      })
    ).toBe(false);
  });

  it("does not hide insufficient system citations without fallback signature", () => {
    expect(
      isSystemEvidenceCitation({
        sourceId: "L2",
        scopeType: "system",
        snippet: "Structured SQL citation.",
        insufficient: true,
      })
    ).toBe(false);
  });
});
