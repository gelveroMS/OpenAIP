import { describe, expect, it } from "vitest";
import { parseScopeCue } from "@/lib/chat/scope-parser";

describe("parseScopeCue", () => {
  it("detects own barangay cue", () => {
    const parsed = parseScopeCue("What are our priorities in our barangay this year?");
    expect(parsed.hasOwnBarangayCue).toBe(true);
    expect(parsed.requestedScopes).toHaveLength(0);
  });

  it("detects multiple named barangays", () => {
    const parsed = parseScopeCue("Compare programs in barangay San Isidro and barangay Maligaya.");
    expect(parsed.hasOwnBarangayCue).toBe(false);
    expect(parsed.requestedScopes).toEqual([
      { scopeType: "barangay", scopeName: "San Isidro" },
      { scopeType: "barangay", scopeName: "Maligaya" },
    ]);
  });

  it("detects multiple named barangays joined by or", () => {
    const parsed = parseScopeCue(
      "Which barangay have higher total investment Barangay Pulo or Barangay Mamatid?"
    );
    expect(parsed.requestedScopes).toEqual([
      { scopeType: "barangay", scopeName: "Pulo" },
      { scopeType: "barangay", scopeName: "Mamatid" },
    ]);
  });

  it("detects city and municipality cues in Filipino", () => {
    const parsed = parseScopeCue(
      "Ihambing ang pondo sa lungsod ng Naga at sa bayan ng Pili."
    );
    expect(parsed.requestedScopes).toEqual([
      { scopeType: "city", scopeName: "Naga" },
      { scopeType: "municipality", scopeName: "Pili" },
    ]);
  });

  it("detects barangay scope when followed by a colon-prefixed query", () => {
    const parsed = parseScopeCue(
      "FY 2026 Barangay Mamatid: what is the implementing agency for Road Concreting?"
    );

    expect(parsed.requestedScopes).toEqual([
      { scopeType: "barangay", scopeName: "Mamatid" },
    ]);
  });

  it("extracts barangay scope cleanly when fiscal tokens follow", () => {
    const parsed = parseScopeCue(
      "What does the AIP say about road maintenance projects in Barangay Pulo FY 2026?"
    );

    expect(parsed.requestedScopes).toEqual([
      { scopeType: "barangay", scopeName: "Pulo" },
    ]);
  });

  it("does not treat descriptor phrase as unresolved barangay name", () => {
    const parsed = parseScopeCue(
      "Explain the barangay health clinic-related projects in Pulo with citations."
    );

    expect(parsed.requestedScopes).toEqual([]);
  });
});
