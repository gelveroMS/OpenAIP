"use client";

import { useEffect, useMemo, useState } from "react";
import ProjectUpdatesFiltersRow from "./ProjectUpdatesFiltersRow";
import ProjectUpdatesTable from "./ProjectUpdatesTable";
import SensitiveGuidelinesPanel from "./SensitiveGuidelinesPanel";
import ProjectUpdateDetailsModal from "./modals/ProjectUpdateDetailsModal";
import HideUpdateModal from "./modals/RemoveUpdateModal";
import UnhideUpdateModal from "./modals/UnhideUpdateModal";
import { getFeedbackModerationProjectUpdatesRepo } from "@/lib/repos/feedback-moderation-project-updates";
import {
  mapProjectUpdateToDetails,
  mapProjectUpdatesToRows,
} from "@/lib/mappers/feedback-moderation-project-updates";
import type {
  AipRecord,
  ProjectUpdateRecord,
} from "@/lib/repos/feedback-moderation-project-updates/types";

const TYPE_OPTIONS = [
  { value: "all", label: "All Type" },
  { value: "update", label: "Update" },
  { value: "photo", label: "Photo" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
];

const VIOLATION_OPTIONS = [
  "Attendance Sheets",
  "Government IDs & Signatures",
  "Beneficiary Personal Info",
  "Inappropriate Images",
];

const toScope = (aip: AipRecord | undefined) => ({
  region_id: null,
  province_id: null,
  city_id: aip?.city_id ?? null,
  municipality_id: aip?.municipality_id ?? null,
  barangay_id: aip?.barangay_id ?? null,
});

export default function ProjectUpdatesPage() {
  const repo = useMemo(() => getFeedbackModerationProjectUpdatesRepo(), []);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [lguFilter, setLguFilter] = useState("all");

  const [seedData, setSeedData] = useState<Awaited<ReturnType<typeof repo.getSeedData>> | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [hideId, setHideId] = useState<string | null>(null);
  const [unhideId, setUnhideId] = useState<string | null>(null);
  const [hideReason, setHideReason] = useState("");
  const [hideViolation, setHideViolation] = useState("");
  const [unhideReason, setUnhideReason] = useState("");

  useEffect(() => {
    let isActive = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const nextSeed = await repo.getSeedData();
        if (!isActive) return;
        setSeedData(nextSeed);
      } catch (loadError) {
        if (!isActive) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load project update moderation data."
        );
      } finally {
        if (isActive) setLoading(false);
      }
    }

    void load();
    return () => {
      isActive = false;
    };
  }, [repo]);

  const rows = useMemo(
    () =>
      seedData
        ? mapProjectUpdatesToRows({
            updates: seedData.updates,
            media: seedData.media,
            projects: seedData.lguMap.projects,
            aips: seedData.lguMap.aips,
            profiles: seedData.lguMap.profiles,
            cities: seedData.lguMap.cities,
            barangays: seedData.lguMap.barangays,
            municipalities: seedData.lguMap.municipalities,
          })
        : [],
    [seedData]
  );

  const lguOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.lguName))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const loweredQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (typeFilter !== "all" && row.type.toLowerCase() !== typeFilter) return false;
      if (statusFilter !== "all" && row.status.toLowerCase() !== statusFilter) return false;
      if (lguFilter !== "all" && row.lguName !== lguFilter) return false;

      if (!loweredQuery) return true;
      const haystack = [row.title, row.caption, row.uploadedBy, row.lguName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(loweredQuery);
    });
  }, [rows, query, typeFilter, statusFilter, lguFilter]);

  const selectedUpdate: ProjectUpdateRecord | null = seedData
    ? seedData.updates.find((row) => row.id === detailsId) ?? null
    : null;
  const selectedProject = seedData?.lguMap.projects.find(
    (row) => row.id === selectedUpdate?.project_id
  );
  const selectedAip = seedData?.lguMap.aips.find((row) => row.id === selectedUpdate?.aip_id);
  const selectedProfile = seedData?.lguMap.profiles.find((row) => row.id === selectedUpdate?.posted_by);
  const selectedMedia =
    seedData?.media.filter((row) => row.update_id === selectedUpdate?.id) ?? [];

  const detailsModel =
    selectedUpdate && seedData
      ? mapProjectUpdateToDetails({
          update: selectedUpdate,
          media: selectedMedia,
          project: selectedProject,
          aip: selectedAip,
          profile: selectedProfile,
          cities: seedData.lguMap.cities,
          barangays: seedData.lguMap.barangays,
          municipalities: seedData.lguMap.municipalities,
        })
      : null;

  const resetHideState = () => {
    setHideId(null);
    setHideReason("");
    setHideViolation("");
  };

  const resetUnhideState = () => {
    setUnhideId(null);
    setUnhideReason("");
  };

  const withPendingAction = async (task: () => Promise<void>) => {
    setActionPending(true);
    setActionError(null);
    try {
      await task();
    } catch (actionErr) {
      setActionError(
        actionErr instanceof Error ? actionErr.message : "Failed to update project moderation state."
      );
    } finally {
      setActionPending(false);
    }
  };

  const handleHideConfirm = () => {
    if (!hideId || !seedData) return;
    const targetUpdate = seedData.updates.find((row) => row.id === hideId);
    if (!targetUpdate) return;
    const targetAip = seedData.lguMap.aips.find((row) => row.id === targetUpdate.aip_id);

    void withPendingAction(async () => {
      const nextSeed = await repo.hideUpdate({
        updateId: hideId,
        reason: hideReason.trim(),
        violationCategory: hideViolation || null,
        scope: toScope(targetAip),
      });
      setSeedData(nextSeed);
      resetHideState();
    });
  };

  const handleUnhideConfirm = () => {
    if (!unhideId || !seedData) return;
    const targetUpdate = seedData.updates.find((row) => row.id === unhideId);
    if (!targetUpdate) return;
    const targetAip = seedData.lguMap.aips.find((row) => row.id === targetUpdate.aip_id);

    void withPendingAction(async () => {
      const nextSeed = await repo.unhideUpdate({
        updateId: unhideId,
        reason: unhideReason.trim(),
        violationCategory: null,
        scope: toScope(targetAip),
      });
      setSeedData(nextSeed);
      resetUnhideState();
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="text-base font-semibold text-slate-900">Project Updates & Media Review</div>
        <div className="text-sm text-slate-500">
          Review updates and uploaded media for compliance and sensitive content.
        </div>
      </div>

      <ProjectUpdatesFiltersRow
        query={query}
        onQueryChange={setQuery}
        typeFilter={typeFilter}
        onTypeChange={setTypeFilter}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        lguFilter={lguFilter}
        onLguChange={setLguFilter}
        typeOptions={TYPE_OPTIONS}
        statusOptions={STATUS_OPTIONS}
        lguOptions={lguOptions}
      />

      {loading ? (
        <div className="text-sm text-slate-500">Loading project updates...</div>
      ) : error ? (
        <div className="text-sm text-rose-600">{error}</div>
      ) : (
        <>
          {actionError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {actionError}
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <ProjectUpdatesTable
              rows={filteredRows}
              onViewPreview={(id) => setDetailsId(id)}
              onHide={(id) => {
                setHideId(id);
                setHideReason("");
                setHideViolation("");
              }}
              onUnhide={(id) => {
                setUnhideId(id);
                setUnhideReason("");
              }}
            />

            <SensitiveGuidelinesPanel />
          </div>
        </>
      )}

      <ProjectUpdateDetailsModal
        open={detailsId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailsId(null);
        }}
        details={detailsModel}
      />

      <HideUpdateModal
        open={hideId !== null}
        onOpenChange={(open) => {
          if (!open) resetHideState();
        }}
        reason={hideReason}
        onReasonChange={setHideReason}
        violationCategory={hideViolation}
        onViolationCategoryChange={setHideViolation}
        violationOptions={VIOLATION_OPTIONS}
        onConfirm={handleHideConfirm}
        isSubmitting={actionPending}
      />

      <UnhideUpdateModal
        open={unhideId !== null}
        onOpenChange={(open) => {
          if (!open) resetUnhideState();
        }}
        reason={unhideReason}
        onReasonChange={setUnhideReason}
        onConfirm={handleUnhideConfirm}
        isSubmitting={actionPending}
      />
    </div>
  );
}
