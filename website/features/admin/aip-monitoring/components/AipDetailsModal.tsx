"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AipPdfContainer } from "@/features/aip/components/aip-pdf-container";
import { AipDetailsSummary } from "@/features/aip/components/aip-details-summary";
import type { AipHeader } from "@/lib/repos/aip/types";
import type { AipMonitoringRow } from "../types/monitoring.types";

function toAipHeader(row: AipMonitoringRow): AipHeader {
  return {
    id: row.id,
    scope: "city",
    title: `${row.lguName} - Annual Investment Plan (AIP) ${row.year}`,
    description: `Annual Investment Plan for Fiscal Year ${row.year}.`,
    year: row.year,
    budget: row.budgetTotal,
    uploadedAt: row.submittedDate,
    publishedAt: undefined,
    status: row.aipStatus,
    fileName: row.fileName,
    pdfUrl: row.pdfUrl ?? "",
    summaryText: row.summaryText,
    detailedBullets: row.detailedBullets,
    sectors: [],
    uploader: {
      name: row.claimedBy ?? "LGU Official",
      role: "LGU Official",
      uploadDate: row.submittedDate,
      budgetAllocated: row.budgetTotal,
    },
    feedback: undefined,
  };
}

export default function AipDetailsModal({
  open,
  onOpenChange,
  aip,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  aip: AipMonitoringRow | null;
}) {
  const header = aip ? toAipHeader(aip) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold">
            AIP Details (Read-Only)
          </DialogTitle>
        </DialogHeader>

        {!aip || !header ? (
          <div className="text-[13.5px] text-slate-500">
            No AIP selected.
          </div>
        ) : (
          <div className="space-y-6 text-[13.5px] text-slate-700">
            <div>
              <div className="text-[15px] font-semibold text-slate-900">
                {aip.lguName}
              </div>
              <div className="text-[13.5px] text-slate-500">
                Annual Investment Plan - FY {aip.year}
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-6">
                <AipPdfContainer aip={header} />
                <AipDetailsSummary aip={header} />

                <Card className="border-slate-200">
                  <CardHeader className="pb-0">
                    <div className="text-[15px] font-semibold text-slate-900">
                      Submission History
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50 hover:bg-slate-50">
                            <TableHead className="text-xs text-slate-600 font-semibold">
                              Year
                            </TableHead>
                            <TableHead className="text-xs text-slate-600 font-semibold">
                              Submitted Date
                            </TableHead>
                            <TableHead className="text-xs text-slate-600 font-semibold">
                              Status
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {aip.submissionHistory.map((row) => (
                            <TableRow key={`${row.year}-${row.status}`}>
                              <TableCell className="text-xs text-slate-700">
                                {row.year}
                              </TableCell>
                              <TableCell className="text-xs text-slate-700">
                                {row.submittedDate}
                              </TableCell>
                              <TableCell className="text-xs text-slate-700">
                                {row.status}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-slate-200">
                  <CardHeader className="pb-0">
                    <div className="text-[15px] font-semibold text-slate-900">
                      Archived Submissions
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50 hover:bg-slate-50">
                            <TableHead className="text-xs text-slate-600 font-semibold">
                              Year
                            </TableHead>
                            <TableHead className="text-xs text-slate-600 font-semibold">
                              Submitted Date
                            </TableHead>
                            <TableHead className="text-xs text-slate-600 font-semibold">
                              Archived Date
                            </TableHead>
                            <TableHead className="text-xs text-slate-600 font-semibold">
                              Reason
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {aip.archivedSubmissions.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={4}
                                className="py-8 text-center text-xs text-slate-500"
                              >
                                No archived submissions.
                              </TableCell>
                            </TableRow>
                          ) : (
                            aip.archivedSubmissions.map((row) => (
                              <TableRow key={`${row.year}-${row.archivedDate}`}>
                                <TableCell className="text-xs text-slate-700">
                                  {row.year}
                                </TableCell>
                                <TableCell className="text-xs text-slate-700">
                                  {row.submittedDate}
                                </TableCell>
                                <TableCell className="text-xs text-slate-700">
                                  {row.archivedDate}
                                </TableCell>
                                <TableCell className="text-xs text-slate-700">
                                  {row.reason}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-slate-200 h-fit">
                <CardHeader className="pb-0">
                  <div className="text-[15px] font-semibold text-slate-900">
                    Timeline / Status History
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="space-y-4">
                    {aip.timeline.map((item, idx) => (
                      <div key={`${item.label}-${idx}`} className="flex gap-3">
                        <div className="mt-1 h-2 w-2 rounded-full bg-teal-600" />
                        <div>
                          <div className="text-[13.5px] font-medium text-slate-900">
                            {item.label}
                          </div>
                          <div className="text-[12px] text-slate-500">{item.date}</div>
                          {item.note ? (
                            <div className="text-[12px] text-slate-500 mt-1">
                              {item.note}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
