export type { AipHeader, AipStatus, LguScope } from "@/lib/repos/aip/repo";

export type PipelineStageUi =
  | "extract"
  | "validate"
  | "scale_amounts"
  | "summarize"
  | "categorize"
  | "embed";

export type PipelineStatusUi = "queued" | "running" | "succeeded" | "failed";

export type AipProcessingRunView = {
  stage: PipelineStageUi | null;
  status: PipelineStatusUi | null;
  message?: string | null;
  progressByStage?: Record<PipelineStageUi, number> | null;
  overallProgressPct?: number | null;
  stageProgressPct?: number | null;
  progressMessage?: string | null;
};

