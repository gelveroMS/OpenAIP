"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EllipsisVertical, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import type { FeedbackModerationRow } from "@/lib/mappers/feedback-moderation";

const statusBadgeClass = (status: "Visible" | "Hidden") => {
  if (status === "Visible") return "bg-sky-50 text-sky-700 border-sky-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
};

export default function PublicFeedbackTable({
  rows,
  onViewDetails,
  onHide,
  onUnhide,
}: {
  rows: FeedbackModerationRow[];
  onViewDetails: (id: string) => void;
  onHide: (id: string) => void;
  onUnhide: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white m-5">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              <TableHead className="p-4 text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Feedback Preview
              </TableHead>
              <TableHead className="p-4 text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Submitted By
              </TableHead>
              <TableHead className="p-4 text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                LGU
              </TableHead>
              <TableHead className="p-4 text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Project
              </TableHead>
              <TableHead className="p-4 text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Violation Category
              </TableHead>
              <TableHead className="p-4 text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Status
              </TableHead>
              <TableHead className="p-4 text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Submitted Date
              </TableHead>
              <TableHead className="p-4 text-[11px] uppercase tracking-wide text-slate-500 font-semibold text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="hover:bg-slate-50">
                <TableCell className="p-4 text-[13.5px] text-slate-900 align-top">
                  <div className="max-w-[280px] whitespace-normal break-words">
                    {row.commentPreview}
                  </div>
                </TableCell>
                <TableCell className="p-4 text-[13.5px] text-slate-700">
                  <div className="font-medium text-slate-900">{row.submittedByName}</div>
                  {row.submittedByEmail ? (
                    <div className="text-xs text-slate-500">{row.submittedByEmail}</div>
                  ) : null}
                </TableCell>
                <TableCell className="p-4 text-[13.5px] text-slate-700">{row.lguName}</TableCell>
                <TableCell className="p-4 text-[13.5px] text-slate-700">
                  {row.projectName}
                </TableCell>
                <TableCell className="p-4 text-[13.5px] text-slate-700">
                  {row.violationCategory ?? "N/A"}
                </TableCell>
                <TableCell className="p-4">
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full px-3 py-1 text-[11px]",
                      statusBadgeClass(row.status)
                    )}
                  >
                    {row.status}
                  </Badge>
                </TableCell>
                <TableCell className="p-4 text-[13.5px] text-slate-700">
                  {row.submittedDateLabel}
                </TableCell>
                <TableCell className="p-4 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Actions">
                        <EllipsisVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          onViewDetails(row.id);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                        View Details
                      </DropdownMenuItem>
                      {row.status === "Visible" ? (
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={(event) => {
                            event.preventDefault();
                            onHide(row.id);
                          }}
                        >
                          <EyeOff className="h-4 w-4" />
                          Hide Feedback
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onSelect={(event) => {
                            event.preventDefault();
                            onUnhide(row.id);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                          Unhide Feedback
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}

            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="p-4 py-12 text-center text-sm text-slate-500">
                  No feedback records found.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
