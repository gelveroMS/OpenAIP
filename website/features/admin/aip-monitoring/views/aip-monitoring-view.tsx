"use client";

import { useEffect, useMemo, useState } from "react";
import AipMonitoringTabs, { AipMonitoringTab } from "../components/AipMonitoringTabs";
import AipFiltersRow from "../components/AipFiltersRow";
import AipsTable from "../components/AipsTable";
import CasesTable from "../components/CasesTable";
import AipDetailsModal from "../components/AipDetailsModal";
import WorkflowActionModal, {
  WorkflowActionType,
} from "../components/WorkflowActionModal";
import { getAipMonitoringRepo } from "@/lib/repos/aip-monitoring";
import type { AipMonitoringRow, CaseRow } from "../types/monitoring.types";
import {
  mapActivityToCaseRows,
  mapAipRowsToMonitoringRows,
} from "@/lib/mappers/aip-monitoring";

type WorkflowState = { actionType: WorkflowActionType; rowId: string } | null;

const todayStamp = () => new Date().toISOString().slice(0, 10);

export default function AipMonitoringView() {
  const repo = useMemo(() => getAipMonitoringRepo(), []);

  const [activeTab, setActiveTab] = useState<AipMonitoringTab>("aips");
  const [query, setQuery] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [caseTypeFilter, setCaseTypeFilter] = useState("all");
  const [lguFilter, setLguFilter] = useState("all");

  const [aipRows, setAipRows] = useState<AipMonitoringRow[]>([]);
  const [caseRows, setCaseRows] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedAipId, setSelectedAipId] = useState<string | null>(null);
  const [workflowState, setWorkflowState] = useState<WorkflowState>(null);

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
        setCaseRows(
          mapActivityToCaseRows({
            activity: seedData.activity,
            aips: seedData.aips,
            lguNameByAipId: seedData.lguNameByAipId,
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

  const selectedAip = useMemo(
    () => aipRows.find((row) => row.id === selectedAipId) ?? null,
    [aipRows, selectedAipId]
  );

  const yearOptions = useMemo(() => {
    const rows = activeTab === "aips" ? aipRows : caseRows;
    return Array.from(new Set(rows.map((row) => row.year))).sort((a, b) => b - a);
  }, [activeTab, aipRows, caseRows]);

  const statusOptions = useMemo(
    () => Array.from(new Set(aipRows.map((row) => row.status))),
    [aipRows]
  );

  const caseTypeOptions = useMemo(
    () => Array.from(new Set(caseRows.map((row) => row.caseType))),
    [caseRows]
  );

  const lguOptions = useMemo(() => {
    const rows = activeTab === "aips" ? aipRows : caseRows;
    return Array.from(new Set(rows.map((row) => row.lguName)));
  }, [activeTab, aipRows, caseRows]);

  const filteredAipRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return aipRows.filter((row) => {
      if (yearFilter !== "all" && row.year !== Number(yearFilter)) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (lguFilter !== "all" && row.lguName !== lguFilter) return false;
      if (!q) return true;

      const haystack = `${row.lguName} ${row.claimedBy ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [aipRows, query, yearFilter, statusFilter, lguFilter]);

  const filteredCaseRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return caseRows.filter((row) => {
      if (yearFilter !== "all" && row.year !== Number(yearFilter)) return false;
      if (caseTypeFilter !== "all" && row.caseType !== caseTypeFilter) return false;
      if (lguFilter !== "all" && row.lguName !== lguFilter) return false;
      if (!q) return true;

      const haystack = `${row.lguName} ${row.claimedBy ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [caseRows, query, yearFilter, caseTypeFilter, lguFilter]);

  const openWorkflow = (actionType: WorkflowActionType, rowId: string) => {
    setWorkflowState({ actionType, rowId });
  };

  const handleWorkflowConfirm = (reason: string) => {
    if (!workflowState) return;
    const { actionType, rowId } = workflowState;
    const now = todayStamp();

    setCaseRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;

        if (actionType === "forceUnclaim") {
          return { ...row, claimedBy: null, lastUpdated: now };
        }
        if (actionType === "cancel") {
          return { ...row, lastUpdated: now };
        }
        if (actionType === "archive") {
          return {
            ...row,
            isArchived: true,
            previousCaseType:
              row.caseType === "Archived" ? row.previousCaseType : row.caseType,
            caseType: "Archived",
            lastUpdated: now,
          };
        }
        if (actionType === "unarchive") {
          return {
            ...row,
            isArchived: false,
            caseType: row.previousCaseType ?? "Locked",
            lastUpdated: now,
          };
        }

        return row;
      })
    );

    setWorkflowState(null);
    void reason;
  };

  const selectedCase = workflowState
    ? caseRows.find((row) => row.id === workflowState.rowId) ?? null
    : null;
  const workflowTargetLabel = selectedCase
    ? `${selectedCase.lguName} - ${selectedCase.year}`
    : "";

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
        You can review submissions and manage workflow actions, but cannot edit AIP content.
      </div>

      <AipMonitoringTabs
        value={activeTab}
        onChange={setActiveTab}
        casesCount={caseRows.length}
      />

      <AipFiltersRow
        tab={activeTab}
        query={query}
        onQueryChange={setQuery}
        yearFilter={yearFilter}
        onYearChange={setYearFilter}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        caseTypeFilter={caseTypeFilter}
        onCaseTypeChange={setCaseTypeFilter}
        lguFilter={lguFilter}
        onLguChange={setLguFilter}
        yearOptions={yearOptions}
        statusOptions={statusOptions}
        caseTypeOptions={caseTypeOptions}
        lguOptions={lguOptions}
      />

      {loading ? (
        <div className="text-sm text-slate-500">Loading monitoring data...</div>
      ) : error ? (
        <div className="text-sm text-rose-600">{error}</div>
      ) : activeTab === "aips" ? (
        <AipsTable rows={filteredAipRows} onViewDetails={(id) => setSelectedAipId(id)} />
      ) : (
        <CasesTable
          rows={filteredCaseRows}
          onForceUnclaim={(id) => openWorkflow("forceUnclaim", id)}
          onCancelSubmission={(id) => openWorkflow("cancel", id)}
          onArchiveSubmission={(id) => openWorkflow("archive", id)}
          onUnarchiveSubmission={(id) => openWorkflow("unarchive", id)}
        />
      )}

      <AipDetailsModal
        open={selectedAipId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedAipId(null);
        }}
        aip={selectedAip}
      />

      <WorkflowActionModal
        open={workflowState !== null}
        onOpenChange={(open) => {
          if (!open) setWorkflowState(null);
        }}
        actionType={workflowState?.actionType ?? "forceUnclaim"}
        targetLabel={workflowTargetLabel}
        onConfirm={handleWorkflowConfirm}
      />
    </div>
  );
}
