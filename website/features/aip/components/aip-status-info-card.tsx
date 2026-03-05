"use client";

import { AlertCircle, CheckCircle2, TriangleAlert } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { AipStatus } from "../types";
import { getAipStatusLabel } from "../utils";

type AipStatusInfoCardProps = {
  status: AipStatus;
  reviewerMessage?: string | null;
  title?: string;
};

type Tone = "info" | "warning" | "success";

type StatusConfig = {
  tone: Tone;
  message: string;
};

const STATUS_CONFIG: Record<Exclude<AipStatus, "draft">, StatusConfig> = {
  pending_review: {
    tone: "info",
    message:
      "Editing is not allowed while the AIP is pending review. Please wait for the review process to complete.",
  },
  under_review: {
    tone: "info",
    message:
      "Editing is not allowed while the AIP is under review. Please wait for the review process to complete.",
  },
  for_revision: {
    tone: "warning",
    message: "Reviewer feedback is available.",
  },
  published: {
    tone: "success",
    message: "Annual Investment Plan (AIP) has been officially published.",
  },
};

function getToneStyles(tone: Tone) {
  switch (tone) {
    case "success":
      return {
        wrapper: "border-emerald-200 bg-emerald-50 text-emerald-800",
        icon: "text-emerald-600",
      };
    case "warning":
      return {
        wrapper: "border-amber-200 bg-amber-50 text-amber-800",
        icon: "text-amber-600",
      };
    case "info":
    default:
      return {
        wrapper: "border-sky-200 bg-sky-50 text-sky-800",
        icon: "text-sky-600",
      };
  }
}

function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === "success") return <CheckCircle2 className="h-4 w-4" />;
  if (tone === "warning") return <TriangleAlert className="h-4 w-4" />;
  return <AlertCircle className="h-4 w-4" />;
}

export function AipStatusInfoCard({
  status,
  reviewerMessage,
  title,
}: AipStatusInfoCardProps) {
  if (status === "draft") return null;

  const config = STATUS_CONFIG[status];
  const styles = getToneStyles(config.tone);
  const resolvedTitle = title ?? `${getAipStatusLabel(status)} Status`;
  const message =
    status === "for_revision" &&
    typeof reviewerMessage === "string" &&
    reviewerMessage.trim().length > 0
      ? reviewerMessage
      : config.message;

  return (
    <Card className="border-slate-200">
      <CardContent className="space-y-4 px-5">
        <h3 className="text-lg font-bold text-slate-900">{resolvedTitle}</h3>
        <div className={`rounded-lg border p-3 text-sm ${styles.wrapper}`}>
          <div className="flex items-start gap-2">
            <span className={`${styles.icon} mt-0.5`}>
              <ToneIcon tone={config.tone} />
            </span>
            <p>{message}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
