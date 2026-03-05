export type RetryResumeStage = "extract" | "validate" | "summarize" | "categorize";

export function deriveRetryResumeStage(failedStage: string | null | undefined): RetryResumeStage {
  const normalized = (failedStage ?? "").trim().toLowerCase();
  if (normalized === "validate") return "validate";
  if (normalized === "summarize") return "summarize";
  if (normalized === "categorize") return "categorize";
  if (normalized === "embed") return "categorize";
  return "extract";
}
