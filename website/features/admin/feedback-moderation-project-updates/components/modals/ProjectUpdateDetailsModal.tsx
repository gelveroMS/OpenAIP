"use client";

import Image from "next/image";
import { CalendarDays, User2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import type { ProjectUpdateDetailsModel } from "@/lib/repos/feedback-moderation-project-updates/types";

export default function ProjectUpdateDetailsModal({
  open,
  onOpenChange,
  details,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  details: ProjectUpdateDetailsModel | null;
}) {
  if (!details) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Project Update Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-[13.5px] text-slate-700">
          <div>
            <div className="text-base font-semibold text-slate-900">{details.projectTitle}</div>
            <div className="text-sm text-slate-500">{details.lguName}</div>
          </div>

          <Card className="border-slate-200">
            <div className="space-y-3 p-4">
              <div className="text-sm font-semibold text-slate-900">
                Update Title: {details.updateTitle}
              </div>
              {details.updateCaption ? (
                <div className="text-xs text-slate-500">{details.updateCaption}</div>
              ) : null}

              <div>
                <div className="text-xs font-semibold text-slate-700">Update Content</div>
                <div className="mt-2 text-sm text-slate-600">{details.updateContent}</div>
              </div>

              <div className="grid gap-4 text-sm text-slate-600 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-slate-500">Progress Percentage</div>
                  <div className="font-medium text-slate-900">
                    {details.progressPercent ?? "\u2014"}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Attendance Count</div>
                  <div className="font-medium text-slate-900">{details.attendanceCount ?? "\u2014"}</div>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-700">Attachments</div>
                <div className="mt-2 flex flex-wrap gap-3">
                  {details.attachments.length ? (
                    details.attachments.map((url) => (
                      <div
                        key={url}
                        className="relative h-16 w-16 overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                      >
                        <Image src={url} alt="Attachment" fill className="object-cover" sizes="64px" />
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-500">No attachments</div>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            <div className="flex items-center gap-2">
              <User2 className="h-4 w-4 text-slate-400" />
              <span className="font-medium text-slate-900">Uploaded By</span>
              <span>{details.uploadedByName}</span>
              {details.uploadedByPosition ? `(${details.uploadedByPosition})` : ""}
            </div>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-slate-400" />
              <span className="font-medium text-slate-900">Upload Date</span>
              <span>{details.uploadedAt}</span>
            </div>
          </div>

          {details.status === "Hidden" ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <div className="font-semibold text-rose-800">Content Hidden</div>
              <div className="mt-1">Reason: {details.hiddenReason ?? "Policy violation."}</div>
              {details.violationCategory ? (
                <div className="mt-1">Violation Category: {details.violationCategory}</div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
            Audit Logging: All actions performed on this workflow case are automatically logged with
            timestamps, user information, and justification for compliance purposes.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
