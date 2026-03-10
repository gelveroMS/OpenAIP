"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AipProcessingStepper,
  type ProcessingStep,
} from "./aip-processing-stepper";
import type {
  AipProcessingRunView,
  PipelineStageUi,
  PipelineStatusUi,
} from "@/features/aip/types";

export type AipProcessingState = "idle" | "processing" | "complete" | "error";

type DisplayPipelineStage = Exclude<PipelineStageUi, "scale_amounts" | "embed">;

const STAGES: { key: DisplayPipelineStage; label: string; message: string }[] = [
  { key: "extract", label: "Extraction", message: "Extracting data from document..." },
  { key: "validate", label: "Validation", message: "Validating extracted information..." },
  { key: "summarize", label: "Summarization", message: "Generating summary and insights..." },
  { key: "categorize", label: "Categorization", message: "Categorizing projects and entries..." },
];

const clampProgress = (value: number) => Math.min(100, Math.max(0, value));

const normalizeStageForDisplay = (
  stage: PipelineStageUi | null
): DisplayPipelineStage | "embed" | null => {
  if (stage === "scale_amounts") return "validate";
  if (
    stage === "extract" ||
    stage === "validate" ||
    stage === "summarize" ||
    stage === "categorize" ||
    stage === "embed"
  ) {
    return stage;
  }
  return null;
};

const getActiveStageIndex = (stage: PipelineStageUi | null) => {
  const normalizedStage = normalizeStageForDisplay(stage);
  if (normalizedStage === "embed") return STAGES.length - 1;
  return Math.max(0, STAGES.findIndex((s) => s.key === normalizedStage));
};

const getStatusMessage = (stage: PipelineStageUi | null) => {
  const normalizedStage = normalizeStageForDisplay(stage);
  if (normalizedStage === "embed") return "Finalizing processed output...";
  if (!normalizedStage) return "Preparing submission...";
  return STAGES.find((s) => s.key === normalizedStage)?.message ?? "Processing...";
};

const isStageComplete = (
  stage: DisplayPipelineStage,
  progressByStage: Record<PipelineStageUi, number> | null,
  status: PipelineStatusUi | null
) => {
  if (!progressByStage) return false;
  return clampProgress(progressByStage[stage]) >= 100 || status === "succeeded";
};

type Props = {
  run: AipProcessingRunView | null;
  state: AipProcessingState;
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  errorHint?: string;
};

export function AipProcessingStatusContent({
  run,
  state,
  onPrimaryAction,
  primaryActionLabel,
  errorHint,
}: Props) {
  const activeIndex = getActiveStageIndex(run?.stage ?? "extract");
  const stepperSteps: ProcessingStep[] = STAGES.map((stage, index) => {
    const completed = isStageComplete(
      stage.key,
      run?.progressByStage ?? null,
      run?.status ?? null
    );
    const active = activeIndex === index;

    return {
      key: stage.key,
      label: stage.label,
      status: completed && !active ? "completed" : active ? "active" : "upcoming",
      progressPct: clampProgress(run?.progressByStage?.[stage.key] ?? 0),
    };
  });
  const shouldShowSyncingMessage =
    state === "processing" &&
    (run?.status === "queued" || run?.status === "running") &&
    typeof run?.stageProgressPct !== "number" &&
    !run?.progressMessage;
  const statusMessage =
    run?.progressMessage ||
    run?.message ||
    (shouldShowSyncingMessage ? "Syncing live progress..." : null) ||
    getStatusMessage(run?.stage ?? null);

  return (
    <>
      <div className="px-10 pt-10 pb-8 text-center">
        <div className="text-2xl font-semibold text-[#0E5D6F]">Processing AIP Submission</div>
        <div className="mt-2 text-sm text-slate-500">Please wait while the AI processes your data.</div>
      </div>

      {state === "complete" ? (
        <div className="space-y-6 px-10 pb-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <Check className="h-7 w-7" />
          </div>
          <div>
            <div className="text-xl font-semibold text-slate-900">Processing Complete</div>
            <div className="mt-2 text-sm text-slate-500">
              Your AIP submission has been processed successfully.
            </div>
          </div>
          {onPrimaryAction && primaryActionLabel ? (
            <Button
              className="h-11 bg-[#0E5D6F] px-8 hover:bg-[#0E5D6F]/90"
              onClick={onPrimaryAction}
            >
              {primaryActionLabel}
            </Button>
          ) : null}
        </div>
      ) : state === "error" ? (
        <div className="space-y-6 px-10 pb-10">
          <div className="space-y-2 text-center">
            <div className="text-xl font-semibold text-slate-900">Processing Failed</div>
            <div className="text-sm text-slate-500">{run?.message ?? "Please try again later."}</div>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorHint ??
              "We were unable to complete the AIP processing pipeline. You can close this dialog and retry the upload."}
          </div>
          {onPrimaryAction && primaryActionLabel ? (
            <div className="flex justify-end">
              <Button variant="outline" onClick={onPrimaryAction}>
                {primaryActionLabel}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="bg-gradient-to-b from-[#F1FAFF] to-white px-10 pb-10">
            <AipProcessingStepper steps={stepperSteps} />
            <div className="mt-8 text-center text-sm text-slate-600" aria-live="polite">
              {statusMessage}
            </div>
          </div>

          <div className="border-t px-10 py-4 text-center text-xs text-slate-500">
            Processing continues in the background even if you leave this page. Reopen this AIP to check progress.
          </div>
        </>
      )}
    </>
  );
}
