import { describe, expect, it } from "vitest";
import { reconstructPdfPageText } from "@/lib/upload-gating/pdf/text";

describe("reconstructPdfPageText", () => {
  it("reconstructs reading order from unordered pdf text items", () => {
    const text = reconstructPdfPageText([
      // Row/content tokens that appear early in source order.
      { str: "1000-01", transform: [1, 0, 0, 1, 60, 480] },
      { str: "Brgy. Hall", transform: [1, 0, 0, 1, 290, 471] },
      { str: "Start Date", transform: [1, 0, 0, 1, 370, 603] },
      // Header tokens that appear late in source order.
      { str: "ANNUAL INVESTMENT PROGRAM (AIP)", transform: [1, 0, 0, 1, 465, 707] },
      { str: "FY 2025", transform: [1, 0, 0, 1, 569, 686] },
      { str: "BARANGAY MAMATID", transform: [1, 0, 0, 1, 520, 665] },
    ]);

    const lines = text.split("\n");
    expect(lines[0]).toContain("ANNUAL INVESTMENT PROGRAM");
    expect(lines[1]).toContain("FY 2025");
    expect(lines[2]).toContain("BARANGAY MAMATID");
    expect(text).toContain("1000-01");
  });
});
