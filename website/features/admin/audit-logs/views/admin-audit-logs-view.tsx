"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search } from "lucide-react";
import type { ActivityLogRow, AuditRoleFilter } from "@/lib/repos/audit/types";
import { getAuditActionLabel, getAuditRoleLabel } from "@/features/audit/presentation/audit";

type Props = {
  logs: ActivityLogRow[];
  total: number;
  filters: {
    page: number;
    pageSize: number;
    role: AuditRoleFilter;
    year: "all" | number;
    event: "all" | string;
    q: string;
  };
};

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

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

function getMetadataString(
  metadata: ActivityLogRow["metadata"],
  key: string
): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default function AdminAuditLogsView({ logs, total, filters }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = React.useState(filters.q);

  React.useEffect(() => {
    setSearchInput(filters.q);
  }, [filters.q]);

  const years = React.useMemo(() => {
    const yearSet = new Set<number>();
    for (const row of logs) {
      const parsed = new Date(row.createdAt).getUTCFullYear();
      if (Number.isFinite(parsed)) yearSet.add(parsed);
    }
    if (typeof filters.year === "number") {
      yearSet.add(filters.year);
    }
    return Array.from(yearSet).sort((a, b) => b - a);
  }, [logs, filters.year]);

  const events = React.useMemo(() => {
    const actionSet = new Set<string>(logs.map((row) => row.action));
    if (filters.event !== "all") actionSet.add(filters.event);
    return Array.from(actionSet).sort((a, b) =>
      getAuditActionLabel(a).localeCompare(getAuditActionLabel(b))
    );
  }, [logs, filters.event]);

  const rows = React.useMemo(() => {
    return logs.map((row) => {
      const eventLabel = getAuditActionLabel(row.action);
      return {
        row,
        name: (getMetadataString(row.metadata, "actor_name") ?? "").trim() || row.actorId,
        position:
          getMetadataString(row.metadata, "actor_position") ??
          getAuditRoleLabel(row.actorRole ?? null),
        eventLabel,
        details:
          getMetadataString(row.metadata, "details") ?? `${eventLabel} (${row.entityType})`,
      };
    });
  }, [logs]);

  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const showingFrom = total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const showingTo = total === 0 ? 0 : showingFrom + rows.length - 1;

  const updateParams = React.useCallback(
    (updates: Record<string, string | null>, resetPage = false) => {
      const params = new URLSearchParams(searchParams.toString());

      if (resetPage) {
        params.set("page", "1");
      }

      for (const [key, value] of Object.entries(updates)) {
        if (!value) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }

      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const applySearch = React.useCallback(() => {
    const nextQ = searchInput.trim();
    updateParams({ q: nextQ || null }, true);
  }, [searchInput, updateParams]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Audit and Accountability</h1>
        <p className="mt-2 text-sm text-slate-600">
          Review recorded actions and events for transparency, compliance tracking, and accountability.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <label className="space-y-2">
            <span className="text-xs text-slate-500">Role</span>
            <select
              aria-label="Role filter"
              className="h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-sm"
              value={filters.role}
              onChange={(event) => updateParams({ role: event.target.value }, true)}
            >
              <option value="all">All Roles</option>
              <option value="admin">Admin</option>
              <option value="citizen">Citizen</option>
              <option value="lgu_officials">LGU Officials</option>
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-xs text-slate-500">Year</span>
            <select
              aria-label="Year filter"
              className="h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-sm"
              value={String(filters.year)}
              onChange={(event) => updateParams({ year: event.target.value }, true)}
            >
              <option value="all">All Years</option>
              {years.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-xs text-slate-500">Events</span>
            <select
              aria-label="Event filter"
              className="h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-sm"
              value={filters.event}
              onChange={(event) => updateParams({ event: event.target.value }, true)}
            >
              <option value="all">All Events</option>
              {events.map((action) => (
                <option key={action} value={action}>
                  {getAuditActionLabel(action)}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-2">
            <div className="text-xs text-slate-500">Search</div>
            <div className="relative flex items-center gap-2">
              <Search className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" />
              <Input
                aria-label="Search filter"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onBlur={applySearch}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applySearch();
                  }
                }}
                placeholder="Search by name or keyword"
                className="h-11 bg-slate-50 pl-9"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="text-sm text-slate-500">{`Showing ${showingFrom}-${showingTo} of ${total} events`}</div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-[180px]">NAME</TableHead>
              <TableHead className="w-[200px]">POSITION</TableHead>
              <TableHead className="w-[170px]">EVENT</TableHead>
              <TableHead className="w-[240px]">DATE &amp; TIME</TableHead>
              <TableHead>DETAILS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ row, name, position, eventLabel, details }) => (
              <TableRow key={row.id} className="border-slate-200">
                <TableCell className="p-4 font-medium text-slate-900">{name}</TableCell>
                <TableCell className="text-slate-600">{position}</TableCell>
                <TableCell className="text-slate-900">{eventLabel}</TableCell>
                <TableCell className="text-slate-600">{formatDateTime(row.createdAt)}</TableCell>
                <TableCell className="text-slate-600">{details}</TableCell>
              </TableRow>
            ))}

            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-slate-500">
                  No events found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <span>Rows</span>
          <select
            aria-label="Rows per page"
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700"
            value={String(filters.pageSize)}
            onChange={(event) => updateParams({ pageSize: event.target.value }, true)}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={String(size)}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page <= 1}
            onClick={() => updateParams({ page: String(Math.max(1, filters.page - 1)) })}
          >
            Previous
          </Button>
          <span className="text-xs text-slate-600">{`Page ${filters.page} of ${totalPages}`}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page >= totalPages}
            onClick={() =>
              updateParams({ page: String(Math.min(totalPages, filters.page + 1)) })
            }
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
