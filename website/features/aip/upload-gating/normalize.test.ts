import { describe, expect, it } from "vitest";
import {
  compareLGUIdentity,
  compareLGULevel,
  extractYearCandidates,
  normalizeLGULevel,
  normalizeLGUName,
  normalizeText,
} from "@/lib/upload-gating/normalize";

describe("upload-gating normalize helpers", () => {
  it("normalizes generic text deterministically", () => {
    expect(normalizeText("  City,   OF  Cabuyao  ")).toBe("city of cabuyao");
    expect(normalizeText("Brgy. Mamatid")).toBe("brgy mamatid");
  });

  it("normalizes LGU names across common prefixes", () => {
    expect(normalizeLGUName("City of Cabuyao")).toBe("cabuyao");
    expect(normalizeLGUName("Cabuyao City")).toBe("cabuyao city");
    expect(normalizeLGUName("Barangay Mamatid")).toBe("mamatid");
    expect(normalizeLGUName("Brgy. Mamatid")).toBe("mamatid");
  });

  it("normalizes LGU levels into supported levels", () => {
    expect(normalizeLGULevel("barangay")).toBe("barangay");
    expect(normalizeLGULevel("Brgy")).toBe("barangay");
    expect(normalizeLGULevel("city")).toBe("city");
    expect(normalizeLGULevel("municipality")).toBe("city");
    expect(normalizeLGULevel("province")).toBeNull();
  });

  it("extracts fiscal year candidates", () => {
    expect(extractYearCandidates("FY 2026 AIP for 2025 baseline and 2026 copy")).toEqual([
      2026, 2025,
    ]);
  });

  it("compares LGU identity using normalized matching", () => {
    expect(compareLGUIdentity("City of Cabuyao", "Cabuyao City")).toBe(true);
    expect(compareLGUIdentity("Barangay Mamatid", "Brgy Mamatid")).toBe(true);
    expect(compareLGUIdentity("City of Cabuyao", "City of Calamba")).toBe(false);
  });

  it("compares LGU levels after normalization", () => {
    expect(compareLGULevel("barangay", "brgy")).toBe(true);
    expect(compareLGULevel("municipality", "city")).toBe(true);
    expect(compareLGULevel("city", "barangay")).toBe(false);
  });
});
