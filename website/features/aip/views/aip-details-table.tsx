// feature/aips/views/aip-details-table.view.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { AipProjectRow, AipStatus } from "../types";
import { AipDetailsTableCard } from "../components/aip-details-table-card";
import {
  BudgetAllocationTable,
  buildBudgetAllocationWithOptions,
} from "../components/budget-allocation-table";
import { listAipProjectsAction } from "../actions/aip-projects.actions";

type ProjectsStateSnapshot = {
  rows: AipProjectRow[];
  loading: boolean;
  error: string | null;
  unresolvedAiCount: number;
};

export function AipDetailsTableView({
  aipId,
  year,
  aipStatus,
  scope,
  focusedRowId,
  enablePagination = false,
  displayTotalBudget,
  onProjectRowClick,
  onProjectsStateChange,
}: {
  aipId: string;
  year: number;
  aipStatus: AipStatus;
  scope: "city" | "barangay";
  focusedRowId?: string;
  enablePagination?: boolean;
  displayTotalBudget?: number | null;
  onProjectRowClick?: (row: AipProjectRow) => void;
  onProjectsStateChange?: (state: ProjectsStateSnapshot) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = React.useState<AipProjectRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await listAipProjectsAction(aipId);
        if (alive) {
          setRows(data);
        }
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : "Failed to load projects.");
          setRows([]);
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [aipId]);

  const unresolvedAiCount = React.useMemo(
    () => rows.filter((row) => row.reviewStatus === "ai_flagged").length,
    [rows]
  );

  React.useEffect(() => {
    onProjectsStateChange?.({
      rows,
      loading,
      error,
      unresolvedAiCount,
    });
  }, [error, loading, onProjectsStateChange, rows, unresolvedAiCount]);

  const allocation = React.useMemo(
    () =>
      buildBudgetAllocationWithOptions(rows, {
        displayTotalBudget,
      }),
    [displayTotalBudget, rows]
  );

  if (loading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="h-5 w-48 animate-pulse rounded-full bg-slate-200" />
          <div className="mt-3 h-10 animate-pulse rounded-lg bg-slate-100" />
          <div className="mt-2 h-10 animate-pulse rounded-lg bg-slate-100" />
          <div className="mt-2 h-10 animate-pulse rounded-lg bg-slate-100" />
        </div>
      </div>
    );
  }
  if (error) {
    return <div className="text-sm text-rose-600">{error}</div>;
  }

  // Allow commenting when AIP is in draft or for_revision status
  const canComment = aipStatus === "draft" || aipStatus === "for_revision";

  return (
    <>
      <BudgetAllocationTable
        rows={allocation.rows}
        totalBudget={allocation.totalBudget}
        totalProjects={allocation.totalProjects}
        coveredPercentage={allocation.coveredPercentage}
      />

      <AipDetailsTableCard
        year={year}
        rows={rows}
        onRowClick={(row) => {
          if (onProjectRowClick) {
            onProjectRowClick(row);
            return;
          }
          if (scope === "barangay") {
            router.push(
              `/barangay/aips/${encodeURIComponent(aipId)}/${encodeURIComponent(row.id)}`
            );
            return;
          }
          router.push(
            `/city/aips/${encodeURIComponent(aipId)}/${encodeURIComponent(row.id)}`
          );
        }}
        canComment={canComment}
        showCommentingNote={scope === "barangay" && aipStatus !== "published"}
        focusedRowId={focusedRowId}
        enablePagination={enablePagination}
      />
    </>
  );
}
