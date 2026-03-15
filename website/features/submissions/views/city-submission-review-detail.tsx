"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { AipHeader } from "@/features/aip/types";
import { getAipStatusBadgeClass } from "@/features/aip/utils";
import { AipPdfContainer } from "@/features/aip/components/aip-pdf-container";
import { AipDetailsSummary } from "@/features/aip/components/aip-details-summary";
import { AipUploaderInfo } from "@/features/aip/components/aip-uploader-info";
import { AipStatusInfoCard } from "@/features/aip/components/aip-status-info-card";
import { AipPublishedByCard } from "@/features/aip/components/aip-published-by-card";
import { AipDetailsTableView } from "@/features/aip/views/aip-details-table";
import { BreadcrumbNav } from "@/components/layout/breadcrumb-nav";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import type { RoleType } from "@/lib/contracts/databasev2";
import type { LatestReview } from "@/lib/repos/submissions/repo";
import {
  getAipStatusLabel,
  getCitySubmissionAipLabel,
} from "../presentation/submissions.presentation";
import {
  claimReviewAction,
  publishAipAction,
  requestRevisionAction,
} from "../actions/submissionsReview.actions";
import { PublishSuccessCard } from "../components/PublishSuccessCard";
import {
  CityRevisionFeedbackHistoryCard,
  toCityRevisionFeedbackCycles,
} from "../components/city-revision-feedback-history-card";

export default function CitySubmissionReviewDetail({
  aip,
  latestReview,
  actorUserId,
  actorRole,
  mode,
  intent,
  result,
  focusedRowId,
}: {
  aip: AipHeader;
  latestReview: LatestReview;
  actorUserId: string | null;
  actorRole: RoleType | null;
  mode?: string;
  intent?: string;
  result?: string;
  focusedRowId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAdmin = actorRole === "admin";
  const isReviewMode = mode === "review" || intent === "review";
  const [optimisticClaimedByActor, setOptimisticClaimedByActor] = useState(false);
  const [optimisticReviewMode, setOptimisticReviewMode] = useState(false);
  const aipDisplayLabel = getCitySubmissionAipLabel({
    barangayName: aip.barangayName,
    year: aip.year,
  });
  const breadcrumbItems = [
    { label: "Submissions", href: "/city/submissions" },
    { label: aipDisplayLabel },
  ];
  const effectiveReviewMode = isReviewMode || optimisticReviewMode;
  const effectiveStatus =
    optimisticClaimedByActor && aip.status === "pending_review"
      ? "under_review"
      : aip.status;
  const effectiveHasActiveClaim =
    (effectiveStatus === "under_review" && latestReview?.action === "claim_review") ||
    (optimisticClaimedByActor && effectiveStatus === "under_review");
  const effectiveIsOwner =
    optimisticClaimedByActor ||
    (effectiveHasActiveClaim &&
      !!actorUserId &&
      latestReview?.reviewerId === actorUserId);
  const effectiveAssignedToOther = effectiveHasActiveClaim && !effectiveIsOwner;
  const effectiveCanClaim =
    effectiveStatus === "pending_review" ||
    (effectiveStatus === "under_review" && (!effectiveHasActiveClaim || isAdmin));
  const effectiveShowClaimButton = effectiveCanClaim && !effectiveIsOwner;
  const effectiveClaimLabel =
    effectiveStatus === "pending_review"
      ? "Review & Claim AIP"
      : effectiveAssignedToOther
        ? "Take Over Review"
        : "Claim Review";
  const effectiveCanReview =
    effectiveReviewMode && effectiveStatus === "under_review" && effectiveIsOwner;

  const [publishedSuccess, setPublishedSuccess] = useState(false);
  const showSuccess = (effectiveReviewMode && result === "published") || publishedSuccess;
  const [claimOpen, setClaimOpen] = useState(false);

  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const revisionNote =
    effectiveStatus === "for_revision" && latestReview?.action === "request_revision"
      ? latestReview.note
      : null;
  const revisionFeedbackCycles = toCityRevisionFeedbackCycles({
    revisionFeedbackCycles: aip.revisionFeedbackCycles,
    revisionReply: aip.revisionReply,
    feedback: aip.feedback,
  });
  const shouldShowRevisionFeedbackHistory =
    effectiveStatus !== "published" || revisionFeedbackCycles.length > 0;

  useEffect(() => {
    setOptimisticClaimedByActor(false);
    setOptimisticReviewMode(false);
  }, [aip.id]);

  useEffect(() => {
    if (intent === "review" && effectiveShowClaimButton && !effectiveIsOwner) {
      setClaimOpen(true);
    }
  }, [intent, effectiveIsOwner, effectiveShowClaimButton]);

  function goToSubmissions() {
    router.push("/city/submissions");
  }

  function goToViewMode() {
    router.replace(`/city/submissions/aip/${aip.id}`);
  }

  function goToPublishedSuccess() {
    setPublishedSuccess(true);
    router.replace(`/city/submissions/aip/${aip.id}?mode=review&result=published`);
  }

  function stayInViewMode() {
    setClaimOpen(false);
    setSubmitError(null);
    router.replace(`/city/submissions/aip/${aip.id}`);
  }

  async function claimReview() {
    setSubmitError(null);
    try {
      setSubmitting(true);
      const response = await claimReviewAction({ aipId: aip.id });
      if (!response.ok) {
        setSubmitError(response.message ?? "Failed to claim review.");
        return;
      }

      setOptimisticClaimedByActor(true);
      setOptimisticReviewMode(true);
      setClaimOpen(false);
      router.replace(`/city/submissions/aip/${aip.id}?mode=review`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmPublish() {
    setSubmitError(null);
    try {
      setSubmitting(true);
      const trimmed = note.trim();
      const response = await publishAipAction({
        aipId: aip.id,
        note: trimmed ? trimmed : undefined,
      });

      if (!response.ok) {
        setSubmitError(response.message ?? "Failed to publish AIP.");
        return;
      }

      setPublishOpen(false);
      setNote("");
      setPublishedSuccess(true);
      goToPublishedSuccess();
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmRequestRevision() {
    setSubmitError(null);
    const trimmed = note.trim();
    if (!trimmed) {
      setNoteError("Revision comments are required.");
      return;
    }

    try {
      setSubmitting(true);
      const response = await requestRevisionAction({ aipId: aip.id, note: trimmed });

      if (!response.ok) {
        setSubmitError(response.message ?? "Failed to request revision.");
        return;
      }

      setRevisionOpen(false);
      setNote("");
      goToViewMode();
    } finally {
      setSubmitting(false);
    }
  }

  function openProjectDetail(projectId: string) {
    const basePath = `/city/submissions/aip/${encodeURIComponent(aip.id)}/${encodeURIComponent(
      projectId
    )}`;
    const query = searchParams.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  if (showSuccess) {
    return (
      <div data-testid="city-publish-success-card" className="space-y-6">
        <BreadcrumbNav items={breadcrumbItems} />
        <PublishSuccessCard
          barangayName={aip.barangayName}
          onBackToSubmissions={goToSubmissions}
          onViewPublishedAip={goToViewMode}
        />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden md:space-y-6">
      <BreadcrumbNav items={breadcrumbItems} />

      <Card className="min-w-0 border-slate-200">
        <CardContent className="flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center sm:p-6">
          <h1 className="break-words text-xl font-bold text-slate-900 sm:text-2xl">{aipDisplayLabel}</h1>
          <Badge
            data-testid="city-submission-status-badge"
            variant="outline"
            className={`rounded-full ${getAipStatusBadgeClass(effectiveStatus)}`}
          >
            {getAipStatusLabel(effectiveStatus)}
          </Badge>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
        <div className="min-w-0 space-y-4 md:space-y-6">
          <AipPdfContainer aip={aip} />
          <AipDetailsSummary aip={aip} />
          <AipDetailsTableView
            aipId={aip.id}
            year={aip.year}
            aipStatus={effectiveStatus}
            scope="city"
            focusedRowId={focusedRowId}
            enablePagination
            onProjectRowClick={(row) => openProjectDetail(row.id)}
          />
          <AipUploaderInfo aip={aip} />
        </div>

        <div className="h-fit space-y-4 lg:sticky lg:top-6 lg:space-y-6">

          {effectiveCanReview ? (
            <Card className="border-slate-200">
              <CardContent className="p-5 space-y-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Review Actions
                  </div>
                  <div className="text-xs text-slate-500">
                    Make a decision on this AIP
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-700">
                    Revision Comments <span className="text-rose-600">*</span>
                  </div>
                  <Textarea
                    data-testid="city-review-note-input"
                    value={note}
                    onChange={(e) => {
                      setNote(e.target.value);
                      setNoteError(null);
                    }}
                    placeholder="Write revision comments or feedback..."
                    className="min-h-[90px]"
                  />
                  {noteError ? (
                    <div data-testid="city-review-note-error" className="text-xs text-rose-600">
                      {noteError}
                    </div>
                  ) : null}
                </div>

                {submitError ? (
                  <div data-testid="city-review-error" className="text-xs text-rose-600">
                    {submitError}
                  </div>
                ) : null}

                <Button
                  data-testid="city-publish-aip-button"
                  className="w-full bg-teal-600 hover:bg-teal-700"
                  onClick={() => setPublishOpen(true)}
                  disabled={!effectiveCanReview || submitting}
                >
                  Publish AIP
                </Button>
                <Button
                  data-testid="city-request-revision-button"
                  variant="outline"
                  className="w-full border-orange-400 text-orange-600 hover:bg-orange-50"
                  onClick={() => {
                    const trimmed = note.trim();
                    if (!trimmed) {
                      setNoteError("Revision comments are required.");
                      return;
                    }
                    setRevisionOpen(true);
                  }}
                  disabled={!effectiveCanReview || submitting}
                >
                  Request Revision
                </Button>
              </CardContent>
            </Card>
          ) : effectiveShowClaimButton ? (
            <Card className="border-slate-200">
              <CardContent className="p-5 space-y-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Review Assignment
                  </div>
                  <div className="text-xs text-slate-500">
                    {effectiveAssignedToOther
                      ? `Currently assigned to ${latestReview?.reviewerName ?? "another reviewer"}.`
                      : "No reviewer is assigned yet."}
                  </div>
                </div>

                <div className="text-xs text-slate-600">
                  {effectiveStatus === "pending_review"
                    ? "Claiming will set this AIP to Under Review and assign it to you."
                    : effectiveAssignedToOther
                      ? "As admin, you can take over this review before taking actions."
                      : "Claim this AIP to enable publish and revision actions."}
                </div>

                {submitError ? (
                  <div data-testid="city-review-error" className="text-xs text-rose-600">
                    {submitError}
                  </div>
                ) : null}

                <Button
                  data-testid="city-claim-review-button"
                  className="w-full bg-teal-600 hover:bg-teal-700"
                  onClick={claimReview}
                  disabled={submitting}
                >
                  {effectiveClaimLabel}
                </Button>
              </CardContent>
            </Card>
          ) : effectiveReviewMode && effectiveAssignedToOther ? (
            <Card className="border-slate-200">
              <CardContent className="p-5 space-y-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Review Actions
                  </div>
                  <div className="text-xs text-slate-500">
                    Assigned to {latestReview?.reviewerName ?? "another reviewer"}.
                    You are in view-only mode.
                  </div>
                </div>

                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Write revision comments or feedback..."
                  className="min-h-[90px]"
                  disabled
                />

                <Button className="w-full bg-teal-600 hover:bg-teal-700" disabled>
                  Publish AIP
                </Button>
                <Button
                  variant="outline"
                  className="w-full border-orange-400 text-orange-600 hover:bg-orange-50"
                  disabled
                >
                  Request Revision
                </Button>
              </CardContent>
            </Card>
          ) : (
            <AipStatusInfoCard status={effectiveStatus} reviewerMessage={revisionNote} />
          )}
          {effectiveStatus === "published" && aip.publishedBy ? (
            <AipPublishedByCard publishedBy={aip.publishedBy} />
          ) : null}
          {shouldShowRevisionFeedbackHistory ? (
            <CityRevisionFeedbackHistoryCard cycles={revisionFeedbackCycles} />
          ) : null}
        </div>
      </div>

      <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Claim Review Ownership</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm text-slate-600">
            <div>
              Choosing <span className="font-semibold text-slate-900">Review &amp; Claim</span>{" "}
              will assign this AIP to you. Other reviewers will be blocked from publishing
              or requesting revision until ownership changes.
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">
                {aipDisplayLabel}
              </div>
              <div className="text-xs text-slate-500">
                {aip.barangayName ?? "Barangay"}
              </div>
            </div>

            {submitError ? (
              <div data-testid="city-review-error" className="text-xs text-rose-600">
                {submitError}
              </div>
            ) : null}

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={stayInViewMode} disabled={submitting}>
                Just View
              </Button>
              <Button
                data-testid="city-claim-review-confirm-button"
                className="bg-teal-600 hover:bg-teal-700"
                onClick={claimReview}
                disabled={submitting}
              >
                {effectiveClaimLabel}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Publish AIP</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm text-slate-600">
            <div>
              Are you sure you want to publish this Annual Investment Plan? Once
              published, it will be publicly available.
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">
                {aipDisplayLabel}
              </div>
              <div className="text-xs text-slate-500">
                {aip.barangayName ?? "Barangay"}
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setPublishOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                data-testid="city-publish-confirm-button"
                className="bg-teal-600 hover:bg-teal-700"
                onClick={confirmPublish}
                disabled={submitting}
              >
                Confirm &amp; Publish
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Revision</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm text-slate-600">
            <div>
              Are you sure you want to send this AIP back for revision? The
              barangay will be notified with your comments.
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs text-slate-500 mb-1">Your comment:</div>
              <div className="text-sm text-slate-900 whitespace-pre-wrap">
                {note.trim()}
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setRevisionOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                data-testid="city-request-revision-confirm-button"
                className="bg-orange-600 hover:bg-orange-700"
                onClick={confirmRequestRevision}
                disabled={submitting}
              >
                Confirm &amp; Send Request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

