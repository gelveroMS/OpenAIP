"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AipFiltersRow from "../components/AipFiltersRow";
import AipsTable from "../components/AipsTable";
import { getAipMonitoringRepo } from "@/lib/repos/aip-monitoring";
import type { AipMonitoringRow } from "../types/monitoring.types";
import { mapAipRowsToMonitoringRows } from "@/lib/mappers/aip-monitoring";
import type { AipStatus } from "@/lib/contracts/databasev2/enums";

const AIP_STATUS_OPTIONS: Array<{ value: AipStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "pending_review", label: "Pending Review" },
  { value: "under_review", label: "Under Review" },
  { value: "for_revision", label: "For Revision" },
  { value: "published", label: "Approved" },
];

function parseAipStatusParam(value: string | null): AipStatus | null {
  if (!value) return null;
  return AIP_STATUS_OPTIONS.some((option) => option.value === value)
    ? (value as AipStatus)
    : null;
}

export default function AipMonitoringView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const repo = useMemo(() => getAipMonitoringRepo(), []);
  const initialQueryAppliedRef = useRef(false);

  const [query, setQuery] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AipStatus>("all");
  const [lguFilter, setLguFilter] = useState("all");

  const [aipRows, setAipRows] = useState<AipMonitoringRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialQueryAppliedRef.current) return;
    const statusParam = parseAipStatusParam(searchParams.get("status"));
    if (statusParam) {
      setStatusFilter(statusParam);
    }
    initialQueryAppliedRef.current = true;
  }, [searchParams]);

  useEffect(() => {
    let isActive = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const seedData = await repo.getSeedData();
        if (!isActive) return;
        setAipRows(
          mapAipRowsToMonitoringRows({
            aips: seedData.aips,
            reviews: seedData.reviews,
            activity: seedData.activity,
            details: seedData.details,
            budgetTotalByAipId: seedData.budgetTotalByAipId,
            lguNameByAipId: seedData.lguNameByAipId,
            reviewerDirectory: seedData.reviewerDirectory,
          })
        );
      } catch (loadError) {
        if (!isActive) return;
        setError(
          loadError instanceof Error ? loadError.message : "Failed to load AIP monitoring data."
        );
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      isActive = false;
    };
  }, [repo]);

  const yearOptions = useMemo(
    () => Array.from(new Set(aipRows.map((row) => row.year))).sort((a, b) => b - a),
    [aipRows]
  );

  const lguOptions = useMemo(
    () => Array.from(new Set(aipRows.map((row) => row.lguName))),
    [aipRows]
  );

  const filteredAipRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return aipRows.filter((row) => {
      if (yearFilter !== "all" && row.year !== Number(yearFilter)) return false;
      if (statusFilter !== "all" && row.aipStatus !== statusFilter) return false;
      if (lguFilter !== "all" && row.lguName !== lguFilter) return false;
      if (!q) return true;

      const haystack = `${row.lguName} ${row.claimedBy ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [aipRows, query, yearFilter, statusFilter, lguFilter]);

  return (
    <div className="space-y-6 text-[13.5px] text-slate-700">
      <div className="space-y-2">
        <h1 className="text-[28px] font-semibold text-slate-900">AIP Monitoring</h1>
        <p className="text-[14px] text-muted-foreground">
          Monitor AIP submissions and workflow integrity across LGUs.
        </p>
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[13.5px] text-slate-700">
        <span className="font-semibold text-slate-900">Admin Role Restrictions:</span>{" "}
        You can review submissions and apply workflow interventions from each AIP detail page.
      </div>

      <AipFiltersRow
        query={query}
        onQueryChange={setQuery}
        yearFilter={yearFilter}
        onYearChange={setYearFilter}
        statusFilter={statusFilter}
        onStatusChange={(value) => setStatusFilter(value as "all" | AipStatus)}
        lguFilter={lguFilter}
        onLguChange={setLguFilter}
        yearOptions={yearOptions}
        statusOptions={AIP_STATUS_OPTIONS}
        lguOptions={lguOptions}
      />

      {loading ? (
        <div className="text-sm text-slate-500">Loading monitoring data...</div>
      ) : error ? (
        <div className="text-sm text-rose-600">{error}</div>
      ) : (
        <AipsTable
          rows={filteredAipRows}
          onOpenDetails={(id) => {
            router.push(`/admin/aip-monitoring/${encodeURIComponent(id)}`);
          }}
        />
      )}
    </div>
  );
}
