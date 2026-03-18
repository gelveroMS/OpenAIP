"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock } from "lucide-react";
import type { ReviewBacklogVM } from "@/lib/repos/admin-dashboard/types";
import { CITIZEN_DASHBOARD_TOKENS } from "@/lib/ui/tokens";

export default function ReviewBacklogCard({
  backlog,
  onViewAips,
}: {
  backlog: ReviewBacklogVM;
  onViewAips: () => void;
}) {
  return (
    <Card className="border-slate-200 py-3 shadow-none">
      <CardHeader className="space-y-1 pb-0">
        <CardTitle className="text-base sm:text-[18px]">Review Backlog</CardTitle>
        <div className="text-[12px] text-slate-500">Aging analysis for pending reviews</div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="rounded-[10px] border border-blue-200 bg-blue-50 px-3 py-2.5 text-[12px] text-blue-900 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[22px] leading-7 font-semibold sm:text-[24px]">{backlog.awaitingCount}</div>
              <div className="text-[11px] text-blue-700">Awaiting Review</div>
              <div className="text-[11px] text-blue-700">Oldest: {backlog.awaitingOldestDays} days</div>
            </div>
          </div>
        </div>

        <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[22px] leading-7 font-semibold sm:text-[24px]">{backlog.stuckCount}</div>
              <div className="text-[11px] text-amber-700">Stuck / Long-running</div>
              <div className="text-[11px] text-amber-700">
                &gt; {backlog.stuckOlderThanDays} days
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[10px] bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          <b>Note:</b> Stuck/Long-running items are derived from Current Status Duration exceeding {backlog.stuckOlderThanDays} days.
        </div>

        <Button className={CITIZEN_DASHBOARD_TOKENS.reviewBacklogButtonClass} onClick={onViewAips}>
          View AIPs
        </Button>
      </CardContent>
    </Card>
  );
}

