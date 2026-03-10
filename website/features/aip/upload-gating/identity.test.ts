import { describe, expect, it } from "vitest";
import { detectDocumentIdentity } from "@/lib/upload-gating/pdf/identity";

describe("detectDocumentIdentity", () => {
  it("prefers barangay header identity over facility row mentions", () => {
    const result = detectDocumentIdentity({
      pages: [
        [
          "Republic of the Philippines",
          "City of Cabuyao",
          "Barangay Mamatid",
          "Barangay Annual Investment Program FY 2025",
          "AIP Reference Code Program/Project/Activity Description",
          "1000-01 Renovation of Barangay Hall 1",
        ].join(" "),
      ],
    });

    expect(result.detectedLGULevel).toBe("barangay");
    expect(result.detectedLGU).toBe("Barangay Mamatid");
  });

  it("returns null LGU when only facility-like barangay phrases are present", () => {
    const result = detectDocumentIdentity({
      pages: [
        "AIP Reference Code Program/Project/Activity Description 1000-01 Repair of Barangay Hall 1 FY 2025",
      ],
      expectedScope: "barangay",
      expectedLGUName: "Mamatid",
    });

    expect(result.detectedLGU).toBeNull();
  });

  it("fails closed when competing barangay header candidates tie", () => {
    const result = detectDocumentIdentity({
      pages: [
        [
          "Republic of the Philippines",
          "City of Cabuyao",
          "Barangay Mamatid",
          "Barangay Banlic",
          "Barangay Annual Investment Program FY 2025",
          "AIP Reference Code 1000-01",
        ].join(" "),
      ],
    });

    expect(result.detectedLGU).toBeNull();
  });

  it("keeps city detection from header even when rows contain barangay names", () => {
    const result = detectDocumentIdentity({
      pages: [
        [
          "Republic of the Philippines",
          "City Government of Cabuyao",
          "Annual Investment Program",
          "Fiscal Year 2026",
          "AIP Reference Code Program/Project/Activity Description 1000-01",
        ].join(" "),
        "1000-02 Flood control for Barangay Mamatid and Barangay Banlic",
      ],
    });

    expect(result.detectedLGULevel).toBe("city");
    expect(result.detectedLGU).toBe("City of Cabuyao");
  });

  it("uses scope fallback for header-missing barangay documents with explicit expected LGU text", () => {
    const result = detectDocumentIdentity({
      pages: [
        "1000-13 Medical Supplies Brgy. Hall 1/1/2025 12/31/2025 and laboratory supplies among Mamatid constituents",
        "3000-15 Financial Assistance among PWD residing at Barangay Mamatid",
        "Prepared by Approved by Barangay Treasurer Barangay Secretary Punong Barangay",
      ],
      expectedScope: "barangay",
      expectedLGUName: "Mamatid",
    });

    expect(result.detectedLGU).toBe("Barangay Mamatid");
    expect(result.detectedLGULevel).toBe("barangay");
    expect(result.diagnostics.identitySource).toBe("scope_fallback");
  });

  it("keeps fallback fail-closed when competing barangay mentions are equally plausible", () => {
    const result = detectDocumentIdentity({
      pages: [
        "AIP 1000-11 Assistance at Barangay Mamatid",
        "AIP 1000-12 Assistance at Barangay Banlic",
        "AIP 1000-13 Relief operation at Barangay Banlic",
      ],
      expectedScope: "barangay",
      expectedLGUName: "Mamatid",
    });

    expect(result.detectedLGU).toBeNull();
    expect(result.diagnostics.identitySource).toBeNull();
  });
});
