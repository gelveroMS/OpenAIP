import { describe, expect, it } from "vitest";
import { detectMetadataIntent } from "@/lib/chat/metadata-intent";

describe("metadata intent detection", () => {
  it("detects available years", () => {
    const result = detectMetadataIntent("What years are available for this barangay?");
    expect(result.intent).toBe("available_years");
  });

  it("detects sector list", () => {
    const result = detectMetadataIntent("What sectors exist in the AIP?");
    expect(result.intent).toBe("sector_list");
  });

  it("detects fund source list", () => {
    const result = detectMetadataIntent("List fund sources for Barangay Mamatid.");
    expect(result.intent).toBe("fund_source_list");
  });

  it("detects project categories", () => {
    const result = detectMetadataIntent("List project categories for this barangay.");
    expect(result.intent).toBe("project_categories");
  });

  it("detects implementing agencies", () => {
    const result = detectMetadataIntent("Show implementing agencies in FY 2026.");
    expect(result.intent).toBe("implementing_agencies");
  });

  it("does not trigger on broad phrase", () => {
    const result = detectMetadataIntent("What data do we have for this barangay?");
    expect(result.intent).toBe("none");
  });

  it("does not steal line-item fact query", () => {
    const result = detectMetadataIntent(
      "What is the fund source for Ref 8000-003-002-006 in FY 2026?"
    );
    expect(result.intent).toBe("none");
  });
});
