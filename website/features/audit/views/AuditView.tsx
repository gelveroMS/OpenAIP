/**
 * Audit and Accountability View Component
 * 
 * Displays a comprehensive audit log of system events and user actions.
 * Provides filtering by year, event type, and search functionality.
 * Essential for transparency, compliance tracking, and accountability.
 * 
 * @module feature/audit/audit-view
 */

"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ActivityLogRow } from "@/lib/repos/audit/repo";
import { getAuditActionLabel, getAuditRoleLabel } from "@/features/audit/types/audit";
import { Search } from "lucide-react";

const PAGE_SIZE = 15;

/**
 * Formats an ISO datetime string to a human-readable format
 * @param iso - ISO datetime string
 * @returns Formatted date and time string
 */
function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * AuditView Component
 * 
 * Main audit log interface displaying system events and user actions.
 * Features:
 * - Year-based filtering
 * - Event type filtering
 * - Full-text search across multiple fields
 * - Chronologically sorted display (newest first)
 * - Detailed event information in table format
 * 
 * @param logs - Array of audit log entries to display
 */
function getMetadataString(
  metadata: ActivityLogRow["metadata"],
  key: string
): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

export default function AuditView({ logs }: { logs: ActivityLogRow[] }) {
  const displayRows = useMemo(() => {
    return logs.map((row) => {
      const createdAt = new Date(row.createdAt);
      const year = Number.isFinite(createdAt.getTime()) ? createdAt.getFullYear() : null;
      const name = (getMetadataString(row.metadata, "actor_name") ?? "").trim() || row.actorId;
      const position =
        getMetadataString(row.metadata, "actor_position") ?? getAuditRoleLabel(row.actorRole ?? null);
      const event = getAuditActionLabel(row.action);
      const details =
        getMetadataString(row.metadata, "details") ?? `${event} (${row.entityType})`;

      return { row, year, name, position, event, details };
    });
  }, [logs]);

  const years = useMemo(() => {
    const yearSet = new Set<number>();
    for (const item of displayRows) {
      if (typeof item.year === "number") yearSet.add(item.year);
    }
    return Array.from(yearSet).sort((a, b) => b - a);
  }, [displayRows]);

  const events = useMemo(() => {
    const eventSet = new Set<string>();
    for (const item of displayRows) eventSet.add(item.event);
    return Array.from(eventSet).sort((a, b) => a.localeCompare(b));
  }, [displayRows]);

  const [year, setYear] = useState<string>(String(years[0] ?? "all"));
  const [event, setEvent] = useState<string>("all");
  const [query, setQuery] = useState<string>("");
  const [page, setPage] = useState<number>(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return displayRows
      .filter((x) => (year === "all" ? true : x.year === Number(year)))
      .filter((x) => (event === "all" ? true : x.event === event))
      .filter((x) => {
        if (!q) return true;
        return (
          x.name.toLowerCase().includes(q) ||
          x.position.toLowerCase().includes(q) ||
          x.event.toLowerCase().includes(q) ||
          x.details.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (a.row.createdAt < b.row.createdAt ? 1 : -1));
  }, [displayRows, year, event, query]);

  React.useEffect(() => {
    setPage(1);
  }, [year, event, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pagedRows = filtered.slice(startIndex, startIndex + PAGE_SIZE);
  const showingFrom = filtered.length === 0 ? 0 : startIndex + 1;
  const showingTo = filtered.length === 0 ? 0 : startIndex + pagedRows.length;

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden md:space-y-6">
      {/* Header */}
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-bold text-slate-900 md:text-3xl">Audit and Accountability</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Review recorded actions and events for transparency, compliance tracking, and accountability.
        </p>
      </div>

      {/* Filters bar */}
      <div className="rounded-xl px-0 py-1 sm:px-0 sm:py-2">
        <div className="grid grid-cols-1 gap-3 md:ml-auto md:w-fit md:grid-cols-[140px_180px_minmax(0,420px)] md:items-end md:gap-4">
          <div className="space-y-2">
            <div className="text-xs text-slate-500">Year</div>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="h-11 w-full border-slate-200 bg-white">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-slate-500">Events</div>
            <Select value={event} onValueChange={setEvent}>
              <SelectTrigger className="h-11 w-full border-slate-200 bg-white">
                <SelectValue placeholder="All Events" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                {events.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-full min-w-0 space-y-2 md:w-[420px]">
            <div className="text-xs text-slate-500">Search</div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or keyword"
                className="h-11 w-full border-slate-200 bg-white pl-9"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="text-sm text-slate-500">
        {`Showing ${showingFrom}-${showingTo} of ${filtered.length} events`}
      </div>

      {/* Table */}
      <div className="max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white [scrollbar-width:thin]">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-[170px] pl-4">NAME</TableHead>
              <TableHead className="w-[180px] pl-4">POSITION</TableHead>
              <TableHead className="w-[170px] pl-4">EVENT</TableHead>
              <TableHead className="w-[220px] pl-4">DATE &amp; TIME</TableHead>
              <TableHead className="w-[320px] pl-4">DETAILS</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {pagedRows.map(({ row, name, position, event: eventLabel, details }) => (
              <TableRow key={row.id} className="border-slate-200">
                <TableCell className="p-4 font-medium text-slate-900 whitespace-normal break-words align-top">
                  {name}
                </TableCell>
                <TableCell className="text-slate-600 whitespace-normal break-words align-top">{position}</TableCell>
                <TableCell className="text-slate-900 whitespace-normal break-words align-top">{eventLabel}</TableCell>
                <TableCell className="text-slate-600 whitespace-normal break-words align-top">
                  {formatDateTime(row.createdAt)}
                </TableCell>
                <TableCell className="text-slate-600 whitespace-normal break-words align-top">{details}</TableCell>
              </TableRow>
            ))}

            {pagedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-slate-500">
                  No events found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage <= 1}
          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
        >
          Previous
        </Button>
        <span className="text-xs text-slate-600">{`Page ${currentPage} of ${totalPages}`}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage >= totalPages}
          onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
