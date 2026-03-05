"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/ui/utils";
import type {
  AipProcessingRunView,
  PipelineStageUi,
  PipelineStatusUi,
} from "@/features/aip/types";

export type AipProcessingState = "idle" | "processing" | "complete" | "error";

const STAGES: { key: Exclude<PipelineStageUi, "embed">; label: string; message: string }[] = [
  { key: "extract", label: "Extraction", message: "Extracting data from document..." },
  { key: "validate", label: "Validation", message: "Validating extracted information..." },
  { key: "summarize", label: "Summarization", message: "Generating summary and insights..." },
  { key: "categorize", label: "Categorization", message: "Categorizing projects and entries..." },
];

const clampProgress = (value: number) => Math.min(100, Math.max(0, value));

const getActiveStageIndex = (stage: PipelineStageUi | null) => {
  if (stage === "embed") return STAGES.length - 1;
  return Math.max(0, STAGES.findIndex((s) => s.key === stage));
};

const getStatusMessage = (stage: PipelineStageUi | null) => {
  if (stage === "embed") return "Finalizing processed output...";
  if (!stage) return "Preparing submission...";
  return STAGES.find((s) => s.key === stage)?.message ?? "Processing...";
};

const isStageComplete = (
  stage: Exclude<PipelineStageUi, "embed">,
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
            <div className="grid w-full grid-cols-4 items-start justify-items-center">
              {STAGES.map((stage, index) => {
                const completed = isStageComplete(stage.key, run?.progressByStage ?? null, run?.status ?? null);
                const active = activeIndex === index;
                const connectorActive = completed || index < activeIndex;
                return (
                  <div key={stage.key} className="flex min-w-0 flex-col items-center gap-3">
                    <div className="relative w-full">
                      <div
                        className={cn(
                          "relative z-10 mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 text-sm font-semibold",
                          completed || active
                            ? "border-[#0E5D6F] bg-[#0E5D6F] text-white shadow"
                            : "border-slate-200 bg-white text-slate-400"
                        )}
                      >
                        {completed && !active ? <Check className="h-5 w-5" /> : index + 1}
                      </div>
                      {index < STAGES.length - 1 ? (
                        <div
                          className={cn(
                            "absolute left-1/2 right-[-50%] top-1/2 z-0 h-1 -translate-y-1/2 rounded-full",
                            connectorActive ? "bg-[#0E5D6F]" : "bg-slate-200"
                          )}
                        />
                      ) : null}
                    </div>
                    <div className={cn("w-full text-center text-xs font-semibold", active ? "text-[#0E5D6F]" : "text-slate-500")}>
                      {stage.label}
                    </div>
                    <div className="w-full space-y-2">
                      <Progress value={clampProgress(run?.progressByStage?.[stage.key] ?? 0)} className="h-2" />
                      <div className="text-center text-[11px] text-slate-500">
                        {clampProgress(run?.progressByStage?.[stage.key] ?? 0)}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
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
