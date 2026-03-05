"use client";

import { useMemo, useState } from "react";

import type { AipRevisionFeedbackCycle } from "@/lib/repos/aip/repo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const CYCLES_PER_PAGE = 1;

type RevisionFeedbackHistoryCardProps = {
  cycles: AipRevisionFeedbackCycle[];
  title: string;
  description: string;
  reviewerFallbackLabel: string;
  replyAuthorFallbackLabel?: string;
  emptyStateLabel: string;
  emptyRepliesLabel: string;
};

function formatFeedbackDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function feedbackAuthorLabel(params: {
  authorName?: string | null;
  fallbackLabel: string;
}): string {
  if (typeof params.authorName === "string" && params.authorName.trim().length > 0) {
    return params.authorName.trim();
  }
  return params.fallbackLabel;
}

export function RevisionFeedbackHistoryCard({
  cycles,
  title,
  description,
  reviewerFallbackLabel,
  replyAuthorFallbackLabel = "Barangay Official",
  emptyStateLabel,
  emptyRepliesLabel,
}: RevisionFeedbackHistoryCardProps) {
  const [paginationState, setPaginationState] = useState<{ page: number; signature: string }>(() => ({
    page: 1,
    signature: "",
  }));
  const cycleSignature = useMemo(
    () =>
      cycles
        .map((cycle) => `${cycle.cycleId}:${cycle.reviewerRemark.id}:${cycle.replies.length}`)
        .join("|"),
    [cycles]
  );
  const totalPages = Math.max(1, Math.ceil(cycles.length / CYCLES_PER_PAGE));
  const page =
    paginationState.signature === cycleSignature ? paginationState.page : 1;
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const pageStart = (currentPage - 1) * CYCLES_PER_PAGE;
  const visibleCycles = cycles.slice(pageStart, pageStart + CYCLES_PER_PAGE);

  return (
    <Card className="border-slate-200">
      <CardContent className="space-y-3 px-5">
        <div>
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>

        <div className="space-y-3">
          {cycles.length ? (
            visibleCycles.map((cycle) => (
              <div
                key={cycle.cycleId}
                className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <div className="rounded-md border border-slate-300 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                    <span>
                      {feedbackAuthorLabel({
                        authorName: cycle.reviewerRemark.authorName,
                        fallbackLabel: reviewerFallbackLabel,
                      })}
                    </span>
                    <span className="text-slate-400">|</span>
                    <span>{formatFeedbackDate(cycle.reviewerRemark.createdAt)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                    {cycle.reviewerRemark.body}
                  </p>
                </div>

                {cycle.replies.length ? (
                  <div className="space-y-2 pl-3">
                    {cycle.replies.map((reply) => (
                      <div
                        key={reply.id}
                        className="rounded-md border border-slate-200 bg-white p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                          <span>
                            {feedbackAuthorLabel({
                              authorName: reply.authorName,
                              fallbackLabel: replyAuthorFallbackLabel,
                            })}
                          </span>
                          <span className="text-slate-400">|</span>
                          <span>{formatFeedbackDate(reply.createdAt)}</span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                          {reply.body}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 bg-white p-3 text-xs text-slate-500">
                    {emptyRepliesLabel}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="rounded border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              {emptyStateLabel}
            </div>
          )}
        </div>

        {cycles.length > 1 ? (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setPaginationState({
                  page: Math.max(1, currentPage - 1),
                  signature: cycleSignature,
                })
              }
              disabled={currentPage <= 1}
            >
              Previous
            </Button>
            <span className="text-xs text-slate-600">{`Cycle ${currentPage} of ${totalPages}`}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setPaginationState({
                  page: Math.min(totalPages, currentPage + 1),
                  signature: cycleSignature,
                })
              }
              disabled={currentPage >= totalPages}
            >
              Next
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
