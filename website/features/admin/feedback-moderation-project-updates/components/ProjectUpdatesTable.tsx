"use client";

import Image from "next/image";
import { FileText, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProjectUpdateRowModel, ProjectUpdateStatus } from "@/lib/repos/feedback-moderation-project-updates/types";

const statusBadgeClass = (status: ProjectUpdateStatus) => {
  switch (status) {
    case "Visible":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "Hidden":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
};

export default function ProjectUpdatesTable({
  rows,
  onViewPreview,
  onHide,
  onUnhide,
}: {
  rows: ProjectUpdateRowModel[];
  onViewPreview: (id: string) => void;
  onHide: (id: string) => void;
  onUnhide: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="text-xs text-slate-500">
            <TableHead>PREVIEW</TableHead>
            <TableHead>TITLE / CAPTION</TableHead>
            <TableHead>LGU</TableHead>
            <TableHead>UPLOADED BY</TableHead>
            <TableHead>TYPE</TableHead>
            <TableHead>STATUS</TableHead>
            <TableHead>DATE</TableHead>
            <TableHead className="text-right">ACTIONS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className="text-[13.5px] text-slate-700">
              <TableCell>
                <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  {row.previewUrl ? (
                    <Image
                      src={row.previewUrl}
                      alt={`${row.title} preview`}
                      fill
                      className="object-cover"
                      sizes="40px"
                    />
                  ) : (
                    <FileText className="h-5 w-5 text-slate-400" />
                  )}
                </div>
              </TableCell>
              <TableCell className="space-y-1">
                <div className="font-medium text-slate-900">{row.title}</div>
                {row.caption ? (
                  <div className="text-xs text-slate-500">{row.caption}</div>
                ) : null}
              </TableCell>
              <TableCell>{row.lguName}</TableCell>
              <TableCell>{row.uploadedBy}</TableCell>
              <TableCell>{row.type}</TableCell>
              <TableCell>
                <Badge variant="outline" className={`rounded-full px-3 py-1 text-[11px] ${statusBadgeClass(row.status)}`}>
                  {row.status}
                </Badge>
              </TableCell>
              <TableCell>{row.date}</TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Actions">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        onViewPreview(row.id);
                      }}
                    >
                      View Preview
                    </DropdownMenuItem>
                    {row.status !== "Hidden" ? (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          onHide(row.id);
                        }}
                        className="text-rose-600 focus:text-rose-600"
                      >
                        Hide Update
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          onUnhide(row.id);
                        }}
                      >
                        Unhide Update
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!rows.length && (
        <div className="px-6 py-8 text-center text-sm text-slate-500">
          No project updates found.
        </div>
      )}
    </div>
  );
}
