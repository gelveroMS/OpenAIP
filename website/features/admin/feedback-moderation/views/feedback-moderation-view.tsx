"use client";

import { useEffect, useMemo, useState } from "react";
import FeedbackModerationTabs, {
  FeedbackModerationTab,
} from "../components/FeedbackModerationTabs";
import FeedbackFiltersRow from "../components/FeedbackFiltersRow";
import PublicFeedbackTable from "../components/PublicFeedbackTable";
import FeedbackDetailsModal from "../components/FeedbackDetailsModal";
import HideFeedbackModal from "../components/HideFeedbackModal";
import UnhideFeedbackModal from "../components/UnhideFeedbackModal";
import ProjectUpdatesPage from "@/features/admin/feedback-moderation-project-updates/components/ProjectUpdatesPage";
import {
  mapFeedbackModerationRows,
  type FeedbackModerationRow,
} from "@/lib/mappers/feedback-moderation";
import type { FeedbackModerationDataset } from "@/lib/repos/feedback-moderation/types";
import { getFeedbackModerationRepo } from "@/lib/repos/feedback-moderation/repo";
import { CATEGORY_KINDS, formatFeedbackKind } from "@/lib/constants/feedback-kind";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const VIOLATION_OPTIONS = [
  "Spam",
  "Harassment",
  "Offensive Language",
  "Misinformation",
  "Policy Violation",
  "Rate Limit Breach",
];

const CATEGORY_OPTIONS = [
  { value: "all", label: "All Category" },
  ...CATEGORY_KINDS.map((kind) => ({ value: kind, label: formatFeedbackKind(kind) })),
];

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

const ADMIN_ACTOR = {
  id: "admin_001",
  role: "admin" as const,
};

export default function FeedbackModerationView() {
  const repo = useMemo(() => getFeedbackModerationRepo(), []);
  const [activeTab, setActiveTab] = useState<FeedbackModerationTab>("feedback");
  const [dataset, setDataset] = useState<FeedbackModerationDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [lguFilter, setLguFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10);

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
        const result = await repo.listDataset();
        if (!isActive) return;
        setDataset(result);
      } catch (err) {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : "Failed to load feedback dataset.");
      } finally {
        if (isActive) setLoading(false);
      }
    }

    load();

    return () => {
      isActive = false;
    };
  }, [repo]);

  const rows = useMemo<FeedbackModerationRow[]>(
    () => (dataset ? mapFeedbackModerationRows(dataset) : []),
    [dataset]
  );

  const lguOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.lguName))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const loweredQuery = query.trim().toLowerCase();

    return rows.filter((row) => {
      if (categoryFilter !== "all" && row.kind !== categoryFilter) return false;

      if (statusFilter !== "all") {
        const statusValue = row.status === "Visible" ? "visible" : "hidden";
        if (statusValue !== statusFilter) return false;
      }

      if (lguFilter !== "all" && row.lguName !== lguFilter) return false;

      if (!loweredQuery) return true;

      const haystack = [
        row.commentPreview,
        row.submittedByName,
        row.submittedByEmail,
        row.lguName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(loweredQuery);
    });
  }, [rows, categoryFilter, statusFilter, lguFilter, query]);

  useEffect(() => {
    setPage(1);
  }, [query, categoryFilter, statusFilter, lguFilter, pageSize]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredRows.length / pageSize)),
    [filteredRows.length, pageSize]
  );

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pagedRows = useMemo(() => {
    const offset = (page - 1) * pageSize;
    return filteredRows.slice(offset, offset + pageSize);
  }, [filteredRows, page, pageSize]);

  const showingFrom = filteredRows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(filteredRows.length, page * pageSize);

  const detailsRow = rows.find((row) => row.id === detailsId) ?? null;

  const resetHideState = () => {
    setHideId(null);
    setHideReason("");
    setHideViolation("");
  };

  const resetUnhideState = () => {
    setUnhideId(null);
    setUnhideReason("");
  };

  const handleHideConfirm = async () => {
    if (!hideId) return;

    const next = await repo.hideFeedback({
      feedbackId: hideId,
      reason: hideReason.trim(),
      violationCategory: hideViolation || null,
      actorId: ADMIN_ACTOR.id,
      actorRole: ADMIN_ACTOR.role,
    });

    setDataset(next);
    resetHideState();
  };

  const handleUnhideConfirm = async () => {
    if (!unhideId) return;

    const next = await repo.unhideFeedback({
      feedbackId: unhideId,
      reason: unhideReason.trim(),
      violationCategory: null,
      actorId: ADMIN_ACTOR.id,
      actorRole: ADMIN_ACTOR.role,
    });

    setDataset(next);
    resetUnhideState();
  };

  return (
    <div className="space-y-6 text-[13.5px] text-slate-700">
      <div className="space-y-2">
        <h1 className="text-[28px] font-semibold text-slate-900">Feedback Moderation</h1>
        <p className="text-[14px] text-muted-foreground">
          Moderate public feedback and enforce compliance on project updates and uploaded media while preserving accountability records.
        </p>
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[13.5px] text-slate-700">
        <span className="font-semibold text-slate-900">Accountability Policy:</span>{" "}
        All moderation actions are audit-logged. Content is never permanently deleted; hidden items are preserved for accountability and can be restored.
      </div>

      <FeedbackModerationTabs value={activeTab} onChange={setActiveTab} />

      {activeTab === "feedback" ? (
        <div className="space-y-6">
          <div className="space-y-1">
            <div className="text-base font-semibold text-slate-900">Public Feedback</div>
            <div className="text-sm text-slate-500">
              Feedback are moderated but never permanently deleted.
            </div>
          </div>

          <FeedbackFiltersRow
            query={query}
            onQueryChange={setQuery}
            categoryFilter={categoryFilter}
            onCategoryChange={setCategoryFilter}
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            lguFilter={lguFilter}
            onLguChange={setLguFilter}
            categoryOptions={CATEGORY_OPTIONS}
            statusOptions={STATUS_OPTIONS}
            lguOptions={lguOptions}
          />

          {loading ? (
            <div className="text-sm text-slate-500">Loading feedback...</div>
          ) : error ? (
            <div className="text-sm text-rose-600">{error}</div>
          ) : (
            <div className="space-y-4">
              <PublicFeedbackTable
                rows={pagedRows}
                onViewDetails={(id) => setDetailsId(id)}
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

              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-600">
                  {`Showing ${showingFrom}-${showingTo} of ${filteredRows.length} feedback records`}
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Rows</span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(value) =>
                        setPageSize(Number(value) as (typeof PAGE_SIZE_OPTIONS)[number])
                      }
                    >
                      <SelectTrigger className="h-9 w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((size) => (
                          <SelectItem key={size} value={String(size)}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(Math.max(1, page - 1))}
                      disabled={page <= 1}
                    >
                      Previous
                    </Button>
                    <span className="text-xs text-slate-600">{`Page ${page} of ${totalPages}`}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(Math.min(totalPages, page + 1))}
                      disabled={page >= totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <ProjectUpdatesPage />
      )}

      <FeedbackDetailsModal
        open={detailsId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailsId(null);
        }}
        row={detailsRow}
      />

      <HideFeedbackModal
        open={hideId !== null}
        onOpenChange={(open) => {
          if (!open) resetHideState();
        }}
        reason={hideReason}
        onReasonChange={setHideReason}
        violationCategory={hideViolation}
        onViolationCategoryChange={setHideViolation}
        onConfirm={handleHideConfirm}
        violationOptions={VIOLATION_OPTIONS}
      />

      <UnhideFeedbackModal
        open={unhideId !== null}
        onOpenChange={(open) => {
          if (!open) resetUnhideState();
        }}
        reason={unhideReason}
        onReasonChange={setUnhideReason}
        onConfirm={handleUnhideConfirm}
      />
    </div>
  );
}
