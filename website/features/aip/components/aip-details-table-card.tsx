"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AipProjectRow } from "../types";
import { SECTOR_TABS } from "../utils";

const PAGE_SIZE = 10;

function LegendItem({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-500">
      <span className={`h-2 w-2 rounded-[2px] ${colorClass}`} />
      <span>{label}</span>
    </div>
  );
}

export function AipDetailsTableCard({
  year,
  rows,
  onRowClick,
  canComment = true,
  showCommentingNote = true,
  focusedRowId,
  enablePagination = false,
}: {
  year: number;
  rows: AipProjectRow[];
  onRowClick: (row: AipProjectRow) => void;
  canComment?: boolean;
  showCommentingNote?: boolean;
  focusedRowId?: string;
  enablePagination?: boolean;
}) {
  const [activeSector, setActiveSector] = React.useState<(typeof SECTOR_TABS)[number]>("General Sector");
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(1);
  const lastAppliedFocusRowIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!focusedRowId) {
      lastAppliedFocusRowIdRef.current = null;
      return;
    }
    if (lastAppliedFocusRowIdRef.current === focusedRowId) return;

    const match = rows.find((row) => row.id === focusedRowId);
    if (match && match.sector !== "Unknown" && match.sector !== activeSector) {
      setActiveSector(match.sector);
    }

    lastAppliedFocusRowIdRef.current = focusedRowId;
  }, [focusedRowId, rows, activeSector]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => r.sector === activeSector)
      .filter((r) => {
        if (!q) return true;
        return (
          r.projectRefCode.toLowerCase().includes(q) ||
          r.aipDescription.toLowerCase().includes(q)
        );
      });
  }, [rows, activeSector, query]);

  React.useEffect(() => {
    setPage(1);
  }, [activeSector, query]);

  const totalPages = React.useMemo(() => {
    return Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  }, [filtered.length]);

  React.useEffect(() => {
    if (!enablePagination) return;
    setPage((prev) => Math.max(1, Math.min(prev, totalPages)));
  }, [enablePagination, totalPages]);

  React.useEffect(() => {
    if (!enablePagination || !focusedRowId) return;
    const focusedIndex = filtered.findIndex((row) => row.id === focusedRowId);
    if (focusedIndex < 0) return;
    const nextPage = Math.floor(focusedIndex / PAGE_SIZE) + 1;
    setPage(nextPage);
  }, [enablePagination, filtered, focusedRowId]);

  const currentPage = enablePagination ? Math.max(1, Math.min(page, totalPages)) : 1;
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length);
  const visibleRows = enablePagination ? filtered.slice(pageStart, pageEnd) : filtered;
  const showingStart = filtered.length === 0 ? 0 : pageStart + 1;
  const showingEnd = filtered.length === 0 ? 0 : pageEnd;

  return (
    <Card data-testid="aip-details-table-card" className="min-w-0 border-slate-200">
      <CardContent className="px-3 py-4 sm:px-5 md:px-6">
        {showCommentingNote && !canComment && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <strong>Note:</strong> Commenting on projects is only available when the AIP status is Draft or For Revision.
          </div>
        )}
        
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="break-words text-base font-bold text-slate-900 sm:text-lg">
              Annual Investment Plan {year} Details
            </h3>

            <div className="-mx-1 mt-3 min-w-0 overflow-x-auto px-1 [scrollbar-width:thin]">
              <Tabs value={activeSector} onValueChange={(v) => setActiveSector(v as typeof SECTOR_TABS[number])}>
                <TabsList className="h-10 w-max min-w-max rounded-full bg-slate-100 p-1">
                  {SECTOR_TABS.map((s) => (
                    <TabsTrigger
                      key={s}
                      value={s}
                      className="h-8 shrink-0 rounded-full px-3 text-xs leading-none sm:h-7 sm:px-3 sm:text-[11px] data-[state=active]:bg-white data-[state=active]:shadow-sm"
                    >
                      {s}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>

          <div className="w-full sm:w-[260px]">
            <div className="text-[11px] text-slate-500 mb-1">Search Projects</div>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by project name or keyword"
              className="h-8 bg-white border-slate-200 text-xs"
              aria-label="Search projects"
            />
          </div>
        </div>

        <div
          data-testid="aip-details-table"
          className="mt-4 max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white [scrollbar-width:thin]"
        >
          <Table className="min-w-[680px] md:min-w-[700px]">
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead className="text-xs text-slate-600 font-semibold">AIP Reference Code</TableHead>
                <TableHead className="text-xs text-slate-600 font-semibold">Program Description</TableHead>
                <TableHead className="text-xs text-slate-600 font-semibold text-right">Total Amount</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {visibleRows.map((r) => {
                const rowClass =
                  r.reviewStatus === "ai_flagged"
                    ? "bg-red-50 hover:bg-red-100"
                    : r.reviewStatus === "reviewed"
                    ? "bg-amber-50 hover:bg-amber-100"
                    : "hover:bg-slate-50";

                return (
                  <TableRow
                    key={r.id}
                    data-testid={`aip-project-row-${r.id}`}
                    className={`cursor-pointer ${rowClass} ${
                      focusedRowId === r.id
                        ? "ring-2 ring-amber-400 ring-inset"
                        : ""
                    }`}
                    onClick={() => onRowClick(r)}
                  >
                    <TableCell className="text-xs text-slate-700">{r.projectRefCode}</TableCell>
                    <TableCell className="min-w-[280px] whitespace-normal text-xs text-slate-700">
                      {r.aipDescription}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-700 text-right tabular-nums">
                      ₱{r.amount.toLocaleString()}
                    </TableCell>
                  </TableRow>
                );
              })}

              {visibleRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center text-sm text-slate-500">
                    No projects found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {enablePagination && (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-600">
              {`Showing ${showingStart}-${showingEnd} of ${filtered.length} projects`}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage <= 1}
              >
                Previous
              </Button>
              <span className="text-xs text-slate-600">{`Page ${currentPage} of ${totalPages}`}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end sm:gap-x-6">
          <LegendItem colorClass="bg-red-500" label="GPT detected a potential error" />
          <LegendItem colorClass="bg-amber-500" label="Reviewed and commented by official" />
          <LegendItem colorClass="bg-slate-300" label="No issues detected" />
        </div>
      </CardContent>
    </Card>
  );
}
