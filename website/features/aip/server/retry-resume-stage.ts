export type RetryResumeStage = "extract" | "validate" | "scale_amounts" | "summarize" | "categorize";

export function deriveRetryResumeStage(failedStage: string | null | undefined): RetryResumeStage {
  const normalized = (failedStage ?? "").trim().toLowerCase();
  if (normalized === "validate") return "validate";
  if (normalized === "scale_amounts") return "scale_amounts";
  if (normalized === "summarize") return "summarize";
  if (normalized === "categorize") return "categorize";
  if (normalized === "embed") return "categorize";
  return "extract";
}
