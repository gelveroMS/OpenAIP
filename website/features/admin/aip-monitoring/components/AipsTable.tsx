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
import type { AipMonitoringRow, AipMonitoringStatus } from "../types/monitoring.types";
import { cn } from "@/lib/ui/utils";

function statusBadgeClass(status: AipMonitoringStatus) {
  switch (status) {
    case "Approved":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "For Revision":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "In Review":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "Locked":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "Pending":
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function durationClass(days: number) {
  if (days >= 60) return "text-rose-600 font-semibold";
  if (days >= 30) return "text-amber-600 font-semibold";
  return "text-slate-700";
}

export default function AipsTable({
  rows,
  onOpenDetails,
}: {
  rows: AipMonitoringRow[];
  onOpenDetails: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white m-5">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Year
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                LGU
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Status
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Submitted Date
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Current Status Since
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Duration (Days)
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Claimed By
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Last Updated
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer hover:bg-slate-50"
                tabIndex={0}
                role="button"
                aria-label={`Open AIP details for ${row.lguName} ${row.year}`}
                onClick={() => onOpenDetails(row.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenDetails(row.id);
                  }
                }}
              >
                <TableCell className="text-[13.5px] text-slate-900 font-medium">
                  {row.year}
                </TableCell>
                <TableCell className="text-[13.5px] text-slate-700">{row.lguName}</TableCell>
                <TableCell>
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
                <TableCell className="text-[13.5px] text-slate-700">
                  {row.submittedDate}
                </TableCell>
                <TableCell className="text-[13.5px] text-slate-700">
                  {row.currentStatusSince}
                </TableCell>
                <TableCell className={cn("text-[13.5px]", durationClass(row.durationDays))}>
                  {row.durationDays}
                </TableCell>
                <TableCell className="text-[13.5px] text-slate-700">
                  {row.claimedBy ?? "-"}
                </TableCell>
                <TableCell className="text-[13.5px] text-slate-700">
                  {row.lastUpdated}
                </TableCell>
              </TableRow>
            ))}

            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-sm text-slate-500">
                  No AIP records found.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

