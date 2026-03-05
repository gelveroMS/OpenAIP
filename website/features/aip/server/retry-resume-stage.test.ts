import { describe, expect, it } from "vitest";
import { deriveRetryResumeStage } from "./retry-resume-stage";

describe("deriveRetryResumeStage", () => {
  it("maps stage-specific resume starts", () => {
    expect(deriveRetryResumeStage("validate")).toBe("validate");
    expect(deriveRetryResumeStage("summarize")).toBe("summarize");
    expect(deriveRetryResumeStage("categorize")).toBe("categorize");
  });

  it("maps embed failures to categorize", () => {
    expect(deriveRetryResumeStage("embed")).toBe("categorize");
  });

  it("falls back to extract for unknown stages", () => {
    expect(deriveRetryResumeStage("extract")).toBe("extract");
    expect(deriveRetryResumeStage("")).toBe("extract");
    expect(deriveRetryResumeStage("unknown")).toBe("extract");
    expect(deriveRetryResumeStage(undefined)).toBe("extract");
    expect(deriveRetryResumeStage(null)).toBe("extract");
  });
});
