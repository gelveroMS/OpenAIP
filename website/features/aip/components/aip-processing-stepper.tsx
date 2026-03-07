"use client";

import { Check } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/ui/utils";

export type ProcessingStepStatus = "completed" | "active" | "upcoming";

export type ProcessingStep = {
  key: string;
  label: string;
  status: ProcessingStepStatus;
  progressPct?: number | null;
};

export type ProcessingStepperProps = {
  steps: ProcessingStep[];
  className?: string;
};

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function getConnectorFillRatio(steps: ProcessingStep[]): number {
  if (steps.length <= 1) return 0;

  const segments = steps.length - 1;
  const lastIndex = steps.length - 1;
  const completedCount = steps.filter((step) => step.status === "completed").length;
  const activeIndex = steps.findIndex((step) => step.status === "active");

  if (activeIndex === lastIndex || completedCount >= segments) return 1;

  const activeProgress =
    activeIndex >= 0 ? clampProgress(steps[activeIndex]?.progressPct ?? 0) / 100 : 0;
  const filledSegments = completedCount + activeProgress;

  return Math.min(1, Math.max(0, filledSegments / segments));
}

export function AipProcessingStepper({ steps, className }: ProcessingStepperProps) {
  const fillRatio = getConnectorFillRatio(steps);
  const fillPercent = `${fillRatio * 100}%`;

  return (
    <div className={cn("w-full overflow-x-auto", className)} data-testid="processing-stepper">
      <div
        className="mx-auto w-full min-w-[720px] max-w-[900px]"
        data-testid="processing-stepper-rail"
      >
        <div className="relative">
          <div className="pointer-events-none absolute left-6 right-6 top-6 h-1 rounded-full bg-slate-200" />
          <div className="pointer-events-none absolute left-6 right-6 top-6 h-1">
            <div
              className="h-full rounded-full bg-[#0E5D6F]"
              data-testid="processing-stepper-connector-fill"
              style={{ width: fillPercent }}
            />
          </div>

          <div className="grid grid-cols-4 items-start" data-testid="processing-stepper-grid">
            {steps.map((step, index) => {
              const normalizedProgress =
                typeof step.progressPct === "number" ? clampProgress(step.progressPct) : null;

              return (
                <div
                  key={step.key}
                  className="flex min-w-0 flex-col items-center px-2"
                  data-testid={`processing-step-${step.key}`}
                >
                  <div
                    className={cn(
                      "relative z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 text-sm font-semibold",
                      step.status === "completed" || step.status === "active"
                        ? "border-[#0E5D6F] bg-[#0E5D6F] text-white shadow"
                        : "border-slate-200 bg-white text-slate-400"
                    )}
                    data-testid={`processing-step-badge-${step.key}`}
                  >
                    {step.status === "completed" ? <Check className="h-5 w-5" /> : index + 1}
                  </div>

                  <div
                    className={cn(
                      "mt-3 text-center text-xs font-semibold",
                      step.status === "active" ? "text-[#0E5D6F]" : "text-slate-500"
                    )}
                  >
                    {step.label}
                  </div>

                  <div
                    className="mt-3 w-[180px] max-w-full space-y-2"
                    data-testid={`processing-step-progress-${step.key}`}
                  >
                    <Progress value={normalizedProgress ?? 0} className="h-2" />
                    {normalizedProgress !== null ? (
                      <div className="text-center text-[11px] text-slate-500">
                        {normalizedProgress}%
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
