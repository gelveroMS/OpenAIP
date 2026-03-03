"use client";

import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FeedbackModerationRow } from "@/lib/mappers/feedback-moderation";

export default function FeedbackDetailsModal({
  open,
  onOpenChange,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: FeedbackModerationRow | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Feedback Details</DialogTitle>
        </DialogHeader>

        {!row ? (
          <div className="text-sm text-slate-500">No feedback selected.</div>
        ) : (
          <div className="space-y-4 text-[13.5px] text-slate-700">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-slate-500">Submitted By</div>
                  <div className="font-medium text-slate-900">{row.submittedByName}</div>
                  {row.submittedByEmail ? (
                    <div className="text-xs text-slate-500">{row.submittedByEmail}</div>
                  ) : null}
                </div>
                <div>
                  <div className="text-xs text-slate-500">Submitted Date</div>
                  <div className="font-medium text-slate-900">{row.submittedDateLabel}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">LGU</div>
                  <div className="font-medium text-slate-900">{row.lguName}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Project</div>
                  <div className="font-medium text-slate-900">{row.projectName}</div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-900">Full Feedback</div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-slate-700">
                {row.commentBody}
              </div>
            </div>

            {row.status === "Hidden" && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                  <div className="space-y-2 text-sm">
                    <div className="font-semibold">Feedback is Currently Hidden</div>
                    <div className="text-amber-800">
                      Citizens see: &quot;This feedback has been hidden due to policy violation.&quot;
                    </div>
                    <div className="text-amber-800">
                      Moderation Reason: {row.hiddenReason ?? "Policy violation."}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-900">Violation</div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-slate-600">
                <span className={row.status === "Hidden" ? "text-rose-600" : ""}>
                  {row.violationCategory ?? "No violation for this feedback."}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
              Audit Logging: All actions performed in this workflow case are automatically logged with timestamps, user information, and justification for compliance purposes.
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
