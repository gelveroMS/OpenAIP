"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BreadcrumbNav } from "@/components/layout/breadcrumb-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AipPdfContainer } from "@/features/aip/components/aip-pdf-container";
import { AipDetailsSummary } from "@/features/aip/components/aip-details-summary";
import { AipUploaderInfo } from "@/features/aip/components/aip-uploader-info";
import { AipStatusInfoCard } from "@/features/aip/components/aip-status-info-card";
import { AipPublishedByCard } from "@/features/aip/components/aip-published-by-card";
import { AipDetailsTableView } from "@/features/aip/views/aip-details-table";
import type { AipHeader } from "@/lib/repos/aip/types";
import type { LatestReview } from "@/lib/repos/submissions/repo";
import {
  getAipStatusBadgeClass,
  getAipStatusLabel,
} from "@/features/submissions/presentation/submissions.presentation";
import {
  forceUnclaimReviewAction,
  remindCityOfficialsReviewAction,
} from "../actions/aip-monitoring-workflow.actions";

type ActionFeedback = {
  kind: "success" | "error";
  text: string;
} | null;

export default function AdminAipMonitoringDetailView({
  aip,
  latestReview,
}: {
  aip: AipHeader;
  latestReview: LatestReview;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [adminMessage, setAdminMessage] = useState("");
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>(null);

  const aipDisplayLabel = `${aip.barangayName?.trim() || "LGU"} ${aip.year} AIP`;
  const isBarangayAip = aip.scope === "barangay";
  const hasActiveClaim =
    aip.status === "under_review" && latestReview?.action === "claim_review";

  const canForceUnclaim = isBarangayAip && hasActiveClaim;
  const canRemindCityOfficials = isBarangayAip && aip.status === "pending_review";
  const showActions = canForceUnclaim || canRemindCityOfficials;

  const activeClaimReviewer = hasActiveClaim
    ? latestReview?.reviewerName ?? "Assigned reviewer"
    : null;

  const breadcrumbItems = [
    { label: "AIP Monitoring", href: "/admin/aip-monitoring" },
    { label: aipDisplayLabel },
  ];

  function handleForceUnclaim() {
    const trimmed = adminMessage.trim();
    if (!trimmed) {
      setActionFeedback({ kind: "error", text: "Admin message is required." });
      return;
    }

    setActionFeedback(null);
    startTransition(() => {
      void (async () => {
        const response = await forceUnclaimReviewAction({
          aipId: aip.id,
          message: trimmed,
        });
        setActionFeedback({
          kind: response.ok ? "success" : "error",
          text: response.message,
        });
        if (response.ok) {
          setAdminMessage("");
          router.refresh();
        }
      })();
    });
  }

  function handleRemindCityOfficials() {
    setActionFeedback(null);
    startTransition(() => {
      void (async () => {
        const response = await remindCityOfficialsReviewAction({
          aipId: aip.id,
        });
        setActionFeedback({
          kind: response.ok ? "success" : "error",
          text: response.message,
        });
        if (response.ok) {
          router.refresh();
        }
      })();
    });
  }

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden md:space-y-6">
      <BreadcrumbNav items={breadcrumbItems} />

      <Card className="min-w-0 border-slate-200">
        <CardContent className="flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center sm:p-6">
          <h1 className="break-words text-xl font-bold text-slate-900 sm:text-2xl">
            {aipDisplayLabel}
          </h1>
          <Badge
            variant="outline"
            className={`rounded-full ${getAipStatusBadgeClass(aip.status)}`}
          >
            {getAipStatusLabel(aip.status)}
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
            aipStatus={aip.status}
            scope={aip.scope}
            enablePagination
          />
          <AipUploaderInfo aip={aip} />
        </div>

        <div className="h-fit space-y-4 lg:sticky lg:top-6 lg:space-y-6">
          {showActions ? (
            <Card className="border-slate-200">
              <CardContent className="space-y-4 p-5">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Admin Actions</div>
                  <div className="text-xs text-slate-500">
                    Workflow interventions for barangay submissions.
                  </div>
                </div>

                {activeClaimReviewer ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    Currently claimed by <span className="font-semibold">{activeClaimReviewer}</span>.
                  </div>
                ) : null}

                {canForceUnclaim ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-700">
                      Force unclaim message <span className="text-rose-600">*</span>
                    </div>
                    <Textarea
                      value={adminMessage}
                      onChange={(event) => setAdminMessage(event.target.value)}
                      placeholder="Provide the reason for force-unclaiming this review assignment."
                      className="min-h-[96px]"
                      disabled={isPending}
                    />
                    <Button
                      className="w-full bg-rose-600 hover:bg-rose-700"
                      onClick={handleForceUnclaim}
                      disabled={isPending}
                    >
                      Force Unclaim
                    </Button>
                  </div>
                ) : null}

                {canRemindCityOfficials ? (
                  <div className="space-y-2">
                    <div className="text-xs text-slate-600">
                      Send a reminder to city officials to review this pending submission. One
                      reminder is allowed per day (Asia/Manila).
                    </div>
                    <Button
                      variant="outline"
                      className="w-full border-sky-300 text-sky-700 hover:bg-sky-50"
                      onClick={handleRemindCityOfficials}
                      disabled={isPending}
                    >
                      Remind City Officials
                    </Button>
                  </div>
                ) : null}

                {actionFeedback ? (
                  <div
                    className={`text-xs ${
                      actionFeedback.kind === "success" ? "text-emerald-700" : "text-rose-600"
                    }`}
                  >
                    {actionFeedback.text}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            <AipStatusInfoCard status={aip.status} reviewerMessage={aip.feedback} />
          )}

          {aip.status === "published" && aip.publishedBy ? (
            <AipPublishedByCard publishedBy={aip.publishedBy} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
