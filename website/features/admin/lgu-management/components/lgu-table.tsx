"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LguRecord } from "@/lib/repos/lgu/repo";
import { cn } from "@/lib/ui/utils";
import LguRowActions from "./lgu-row-actions";

function statusBadgeClass(status: LguRecord["status"]) {
  if (status === "active") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-600";
}

function lguTypeLabel(type: LguRecord["type"]) {
  if (type === "region") return "Region";
  if (type === "province") return "Province";
  if (type === "city") return "City";
  if (type === "municipality") return "Municipality";
  return "Barangay";
}

export default function LguTable({
  rows,
  onEdit,
  onDeactivate,
  onActivate,
}: {
  rows: LguRecord[];
  onEdit: (id: string) => void;
  onDeactivate: (id: string) => void;
  onActivate: (id: string) => void;
}) {
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <div className="divide-y divide-slate-200 md:hidden">
        {rows.map((lgu) => (
          <div key={lgu.id} className="space-y-3 p-4" data-testid={`admin-lgu-row-${lgu.id}`} data-lgu-code={lgu.code}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 break-words">{lgu.name}</div>
                <div className="mt-0.5 text-xs text-slate-600">{lguTypeLabel(lgu.type)}</div>
              </div>
              <Badge
                variant="outline"
                className={cn("rounded-full px-3 py-1 text-[11px]", statusBadgeClass(lgu.status))}
              >
                {lgu.status === "active" ? "Active" : "Deactivated"}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
              <div>
                <span className="font-medium">PSGC:</span> {lgu.code}
              </div>
              <div>
                <span className="font-medium">Parent:</span> {lgu.parentName ?? "-"}
              </div>
              <div className="col-span-2">
                <span className="font-medium">Updated:</span> {lgu.updatedAt}
              </div>
            </div>

            <div className="flex justify-end">
              <LguRowActions
                lgu={lgu}
                onEdit={() => onEdit(lgu.id)}
                onDeactivate={() => onDeactivate(lgu.id)}
                onActivate={() => onActivate(lgu.id)}
              />
            </div>
          </div>
        ))}

        {rows.length === 0 && (
          <div className="py-12 text-center text-sm text-slate-500">No LGUs found.</div>
        )}
      </div>

      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold whitespace-nowrap">
                Type
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold whitespace-nowrap">
                Name
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold whitespace-nowrap">
                PSGC Code
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold whitespace-nowrap">
                Parent LGU
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold whitespace-nowrap">
                Status
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold whitespace-nowrap">
                Last Updated
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold text-right whitespace-nowrap">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((lgu) => (
              <TableRow
                key={lgu.id}
                data-testid={`admin-lgu-row-${lgu.id}`}
                data-lgu-code={lgu.code}
                className="hover:bg-slate-50"
              >
                <TableCell className="text-sm text-slate-700 whitespace-nowrap">
                  {lguTypeLabel(lgu.type)}
                </TableCell>
                <TableCell className="text-sm text-slate-900 font-medium min-w-[180px]">
                  {lgu.name}
                </TableCell>
                <TableCell className="text-sm text-slate-700 whitespace-nowrap">{lgu.code}</TableCell>
                <TableCell className="text-sm text-slate-700 min-w-[140px]">
                  {lgu.parentName ?? "-"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full px-3 py-1 text-[11px] whitespace-nowrap",
                      statusBadgeClass(lgu.status)
                    )}
                  >
                    {lgu.status === "active" ? "Active" : "Deactivated"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-slate-700 tabular-nums whitespace-nowrap">
                  {lgu.updatedAt}
                </TableCell>
                <TableCell className="text-right">
                  <LguRowActions
                    lgu={lgu}
                    onEdit={() => onEdit(lgu.id)}
                    onDeactivate={() => onDeactivate(lgu.id)}
                    onActivate={() => onActivate(lgu.id)}
                  />
                </TableCell>
              </TableRow>
            ))}

            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-12 text-center text-sm text-slate-500"
                >
                  No LGUs found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
