"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  RotateCw,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";

import type {
  AipHeader,
  AipProcessingRunView,
  PipelineStageUi,
  PipelineStatusUi,
} from "../types";
import { BreadcrumbNav } from "@/components/layout/breadcrumb-nav";
import { getAipStatusBadgeClass } from "../utils";
import { AipPdfContainer } from "../components/aip-pdf-container";
import { AipDetailsSummary } from "../components/aip-details-summary";
import { AipProcessingInlineStatus } from "../components/aip-processing-inline-status";
import type { AipProcessingState } from "../components/aip-processing-status-content";
import { AipStatusInfoCard } from "../components/aip-status-info-card";
import { AipPublishedByCard } from "../components/aip-published-by-card";
import { RevisionFeedbackHistoryCard } from "../components/revision-feedback-history-card";
import { AipDetailsTableView } from "./aip-details-table";
import { LguAipFeedbackThread } from "../components/lgu-aip-feedback-thread";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  cancelAipSubmissionAction,
  deleteAipDraftAction,
  saveAipRevisionReplyAction,
  submitCityAipForPublishAction,
  submitAipForReviewAction,
} from "../actions/aip-workflow.actions";
import {
  useExtractionRunsRealtime,
  type ExtractionRunRealtimeEvent,
} from "../hooks/use-extraction-runs-realtime";
import {
  getAipChatbotReadinessStatus,
  type AipChatbotReadinessKind,
  type AipChatbotReadinessTone,
} from "../lib/chatbot-readiness";
import { withCsrfHeader } from "@/lib/security/csrf";

const PIPELINE_STAGES: PipelineStageUi[] = [
  "extract",
  "validate",
  "summarize",
  "categorize",
  "embed",
];
const PIPELINE_STAGE_ORDER_FOR_FAILURE: PipelineStageUi[] = [
  "extract",
  "validate",
  "summarize",
  "categorize",
  "embed",
];
const PIPELINE_STAGE_LABELS: Record<PipelineStageUi, string> = {
  extract: "Extraction",
  validate: "Validation",
  summarize: "Summarization",
  categorize: "Categorization",
  embed: "Embedding",
};

const PIPELINE_STATUS: PipelineStatusUi[] = ["queued", "running", "succeeded", "failed"];
const FINALIZE_REFRESH_MAX_ATTEMPTS = 5;
const FINALIZE_REFRESH_INTERVAL_MS = 1500;
const FINALIZE_PROGRESS_MESSAGE =
  "Saving processed data to the database. You will be redirected shortly.";
const LIVE_STATUS_UNAVAILABLE_NOTICE =
  "Live extraction updates are unavailable right now. Refresh this page to check the latest status.";

function getChatbotStatusToneClass(tone: AipChatbotReadinessTone): string {
  switch (tone) {
    case "success":
      return "text-emerald-600";
    case "info":
      return "text-sky-600";
    case "danger":
      return "text-rose-600";
    case "warning":
    default:
      return "text-amber-600";
  }
}

function ChatbotStatusIcon({ kind }: { kind: AipChatbotReadinessKind }) {
  if (kind === "chatbot_ready") return <CheckCircle2 className="h-4 w-4" />;
  if (kind === "embedding") return <Loader2 className="h-4 w-4 animate-spin" />;
  if (kind === "failed") return <TriangleAlert className="h-4 w-4" />;
  return <CircleDashed className="h-4 w-4" />;
}

type RunStatusPayload = {
  runId: string;
  status: string;
  stage: string;
  errorMessage: string | null;
  overallProgressPct?: number | null;
  stageProgressPct?: number | null;
  progressMessage?: string | null;
  progressUpdatedAt?: string | null;
};

type ActiveRunLookupPayload = {
  run: {
    runId: string;
    aipId: string;
    stage: PipelineStageUi;
    status: "queued" | "running";
    errorMessage: string | null;
    createdAt: string | null;
  } | null;
  failedRun?: {
    runId: string;
    aipId: string;
    stage: PipelineStageUi;
    status: "failed";
    errorMessage: string | null;
    createdAt: string | null;
  } | null;
};

type RunSnapshotPayload = {
  runId: string;
  aipId: string;
  stage: string;
  status: string;
  errorMessage: string | null;
  overallProgressPct?: number | null;
  stageProgressPct?: number | null;
  progressMessage?: string | null;
  progressUpdatedAt?: string | null;
};

type RetryFailedRunMode = "scratch" | "failed_stage";

type FailedRunState = {
  runId: string;
  stage: PipelineStageUi;
  message: string | null;
};

function mapRealtimeEventToRunStatusPayload(
  event: ExtractionRunRealtimeEvent
): RunStatusPayload {
  return {
    runId: event.run.id,
    status: event.run.status ?? "",
    stage: event.run.stage ?? "",
    errorMessage: event.run.error_message,
    overallProgressPct: event.run.overall_progress_pct,
    stageProgressPct: event.run.stage_progress_pct,
    progressMessage: event.run.progress_message,
    progressUpdatedAt: event.run.progress_updated_at,
  };
}

function isPipelineStageUi(value: string): value is PipelineStageUi {
  return PIPELINE_STAGES.includes(value as PipelineStageUi);
}

function isPipelineStatusUi(value: string): value is PipelineStatusUi {
  return PIPELINE_STATUS.includes(value as PipelineStatusUi);
}

function mapRunStatusToProcessingState(status: PipelineStatusUi): AipProcessingState {
  if (status === "queued" || status === "running") return "processing";
  if (status === "failed") return "error";
  return "complete";
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function hasSummaryText(summaryText: string | undefined): boolean {
  return typeof summaryText === "string" && summaryText.trim().length > 0;
}

function getPipelineStageLabel(stage: PipelineStageUi): string {
  return PIPELINE_STAGE_LABELS[stage];
}

function getCompletedPipelineStageLabels(failedStage: PipelineStageUi): string[] {
  const failedIndex = PIPELINE_STAGE_ORDER_FOR_FAILURE.indexOf(failedStage);
  if (failedIndex <= 0) return [];
  return PIPELINE_STAGE_ORDER_FOR_FAILURE.slice(0, failedIndex).map(getPipelineStageLabel);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function buildProgressByStage(
  stage: PipelineStageUi | null,
  status: PipelineStatusUi | null,
  stageProgressPct?: number | null
): Record<PipelineStageUi, number> {
  const progressByStage: Record<PipelineStageUi, number> = {
    extract: 0,
    validate: 0,
    summarize: 0,
    categorize: 0,
    embed: 0,
  };

  if (!stage || !status) return progressByStage;

  const activeIndex = PIPELINE_STAGES.indexOf(stage);
  if (activeIndex < 0) return progressByStage;

  for (let index = 0; index < PIPELINE_STAGES.length; index += 1) {
    const key = PIPELINE_STAGES[index];
    if (status === "succeeded") {
      progressByStage[key] = 100;
      continue;
    }
    if (index < activeIndex) {
      progressByStage[key] = 100;
      continue;
    }
    if (index > activeIndex) {
      progressByStage[key] = 0;
      continue;
    }
    if (status === "queued") {
      progressByStage[key] =
        typeof stageProgressPct === "number" ? clampProgress(stageProgressPct) : 0;
      continue;
    }
    if (status === "running") {
      progressByStage[key] =
        typeof stageProgressPct === "number" ? clampProgress(stageProgressPct) : 0;
      continue;
    }
    if (status === "failed") {
      progressByStage[key] =
        typeof stageProgressPct === "number" ? clampProgress(stageProgressPct) : 80;
      continue;
    }
  }

  return progressByStage;
}

export default function AipDetailView({
  aip,
  scope = "barangay",
  onResubmit,
  onCancel,
  onCancelSubmission,
}: {
  aip: AipHeader;
  scope?: "city" | "barangay";
  onResubmit?: () => void;
  onCancel?: () => void;
  onCancelSubmission?: () => void;
}) {
  const isBarangayScope = scope === "barangay";
  const isCityScope = scope === "city";
  const shouldTrackRunStatus = isBarangayScope || isCityScope;
  const isForRevision = aip.status === "for_revision";
  const isPendingReview = aip.status === "pending_review";
  const hasRevisionHistory = (aip.revisionFeedbackCycles?.length ?? 0) > 0;
  const isDraftWithRevisionHistory = aip.status === "draft" && hasRevisionHistory;
  const showRevisionWorkflowSidebar =
    isBarangayScope &&
    (isForRevision || isPendingReview || isDraftWithRevisionHistory);
  const showStatusSidebar = aip.status !== "draft" && !showRevisionWorkflowSidebar;
  const showRightSidebar = showRevisionWorkflowSidebar || showStatusSidebar;

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const threadId = searchParams.get("thread");
  const commentId = searchParams.get("comment");
  const tab = searchParams.get("tab");
  const runIdFromQuery = searchParams.get("run");
  const activeTab = tab === "comments" ? "comments" : "summary";

  const [activeRunId, setActiveRunId] = useState<string | null>(runIdFromQuery);
  const [isCheckingRun, setIsCheckingRun] = useState<boolean>(
    shouldTrackRunStatus && !runIdFromQuery
  );
  const [processingRun, setProcessingRun] = useState<AipProcessingRunView | null>(null);
  const [processingState, setProcessingState] = useState<AipProcessingState>("idle");
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [failedRun, setFailedRun] = useState<FailedRunState | null>(null);
  const [retryingMode, setRetryingMode] = useState<RetryFailedRunMode | null>(null);
  const isRetrying = retryingMode !== null;
  const [retryError, setRetryError] = useState<string | null>(null);
  const [isFinalizingAfterSuccess, setIsFinalizingAfterSuccess] = useState(false);
  const [finalizingNotice, setFinalizingNotice] = useState<string | null>(null);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [isRetryingEmbedding, setIsRetryingEmbedding] = useState(false);
  const [embeddingRetryError, setEmbeddingRetryError] = useState<string | null>(null);
  const [embeddingRetrySuccess, setEmbeddingRetrySuccess] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [unresolvedAiCount, setUnresolvedAiCount] = useState(0);
  const [workflowPendingAction, setWorkflowPendingAction] = useState<
    | "delete_draft"
    | "cancel_submission"
    | "submit_review"
    | "submit_publish"
    | "save_reply"
    | null
  >(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowSuccess, setWorkflowSuccess] = useState<string | null>(null);
  const [revisionReplyDraft, setRevisionReplyDraft] = useState("");
  const [cityPublishConfirmOpen, setCityPublishConfirmOpen] = useState(false);
  const [deleteDraftConfirmOpen, setDeleteDraftConfirmOpen] = useState(false);
  const lastHydratedRunIdRef = useRef<string | null>(null);
  const chatbotReadiness =
    aip.status === "published" ? getAipChatbotReadinessStatus(aip.embedding) : null;
  const isEmbedFailed = chatbotReadiness?.kind === "failed";
  const isEmbedRunning = chatbotReadiness?.kind === "embedding";
  const canManualEmbedDispatch =
    aip.status === "published" &&
    (isBarangayScope || isCityScope) &&
    !isEmbedRunning &&
    Boolean(chatbotReadiness) &&
    (chatbotReadiness.kind === "failed" ||
      chatbotReadiness.kind === "needs_embedding");
  const embedActionButtonLabel = isEmbedFailed
    ? "Retry Embedding"
    : "Start Embedding";
  const embedActionButtonClass = isEmbedFailed
    ? "w-full bg-rose-600 hover:bg-rose-700"
    : "w-full bg-[#022437] hover:bg-[#022437]/90";

  const focusedRowId = searchParams.get("focus") ?? undefined;

  const clearRunQuery = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (!params.has("run")) return;
    params.delete("run");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!shouldTrackRunStatus) {
      setIsCheckingRun(false);
      setActiveRunId(null);
      setIsFinalizingAfterSuccess(false);
      return;
    }

    if (isFinalizingAfterSuccess) {
      setIsCheckingRun(false);
      return;
    }

    if (runIdFromQuery) {
      setIsCheckingRun(false);
      setActiveRunId(runIdFromQuery);
      setIsFinalizingAfterSuccess(false);
      setFinalizingNotice(null);
      return;
    }

    let cancelled = false;
    setIsCheckingRun(true);
    setRunNotice(null);

    async function lookupActiveRun() {
      try {
        const runApiScope = isCityScope ? "city" : "barangay";
        const response = await fetch(
          `/api/${runApiScope}/aips/${encodeURIComponent(aip.id)}/runs/active`
        );
        if (!response.ok) {
          throw new Error("Failed to check extraction status.");
        }
        const payload = (await response.json()) as ActiveRunLookupPayload;
        if (cancelled) return;

        if (payload.run?.runId) {
          setActiveRunId(payload.run.runId);
          setProcessingState("processing");
          setIsFinalizingAfterSuccess(false);
          setFailedRun(null);
          setRetryError(null);
          setFinalizingNotice(null);
        } else if (payload.failedRun?.runId) {
          setActiveRunId(null);
          setProcessingState("idle");
          setIsFinalizingAfterSuccess(false);
          setFinalizingNotice(null);
          setFailedRun({
            runId: payload.failedRun.runId,
            stage: payload.failedRun.stage,
            message: payload.failedRun.errorMessage,
          });
          setRetryError(null);
        } else {
          setActiveRunId(null);
          setProcessingState("idle");
          setFailedRun(null);
        }
      } catch {
        if (cancelled) return;
        setActiveRunId(null);
        setProcessingState("idle");
        setRunNotice("Unable to check extraction status right now. Showing AIP details.");
      } finally {
        if (!cancelled) {
          setIsCheckingRun(false);
        }
      }
    }

    void lookupActiveRun();

    return () => {
      cancelled = true;
    };
  }, [aip.id, isCityScope, isFinalizingAfterSuccess, runIdFromQuery, shouldTrackRunStatus]);

  useEffect(() => {
    if (!shouldTrackRunStatus || !activeRunId) {
      if (!isFinalizingAfterSuccess) {
        setProcessingRun(null);
        setProcessingState("idle");
      }
      return;
    }

    setProcessingState("processing");
    setIsFinalizingAfterSuccess(false);
    setFinalizingNotice(null);
    setRunNotice(null);
    setRetryError(null);
  }, [activeRunId, isFinalizingAfterSuccess, shouldTrackRunStatus]);

  const applyRunStatusPayload = useCallback(
    (payload: RunStatusPayload) => {
      if (!isPipelineStatusUi(payload.status) || !isPipelineStageUi(payload.stage)) {
        setRunNotice(
          "Received an unexpected live extraction status payload. Refresh this page to continue."
        );
        return;
      }

      const shouldShowSyncingMessage =
        (payload.status === "queued" || payload.status === "running") &&
        typeof payload.stageProgressPct !== "number" &&
        !payload.progressMessage;

      setProcessingRun({
        stage: payload.stage,
        status: payload.status,
        message:
          payload.errorMessage ??
          (shouldShowSyncingMessage ? "Syncing live progress..." : null),
        progressByStage: buildProgressByStage(
          payload.stage,
          payload.status,
          payload.stageProgressPct
        ),
        overallProgressPct: payload.overallProgressPct ?? null,
        stageProgressPct: payload.stageProgressPct ?? null,
        progressMessage:
          payload.progressMessage ??
          (shouldShowSyncingMessage ? "Syncing live progress..." : null),
      });

      const nextState = mapRunStatusToProcessingState(payload.status);
      if (nextState === "processing") {
        setProcessingState("processing");
        setFailedRun(null);
        return;
      }

      if (nextState === "complete") {
        setActiveRunId(null);
        setFailedRun(null);
        setRetryError(null);
        setRunNotice(null);
        setProcessingState("processing");
        setIsFinalizingAfterSuccess(true);
        setFinalizingNotice(null);
        setProcessingRun({
          stage: "categorize",
          status: "running",
          message: FINALIZE_PROGRESS_MESSAGE,
          progressByStage: buildProgressByStage("categorize", "running", 100),
          overallProgressPct: 100,
          stageProgressPct: 100,
          progressMessage: FINALIZE_PROGRESS_MESSAGE,
        });
        if (runIdFromQuery) {
          clearRunQuery();
        }
        return;
      }

      setProcessingRun(null);
      setProcessingState("idle");
      setIsFinalizingAfterSuccess(false);
      setActiveRunId(null);
      setFailedRun({
        runId: payload.runId,
        stage: payload.stage,
        message: payload.errorMessage ?? payload.progressMessage ?? null,
      });
      setRetryError(null);
      if (runIdFromQuery) {
        clearRunQuery();
      }
    },
    [clearRunQuery, runIdFromQuery]
  );

  const hydrateRunSnapshot = useCallback(async (mode: "initial" | "resync" = "initial") => {
    if (!activeRunId || !shouldTrackRunStatus) return;
    if (mode === "initial" && lastHydratedRunIdRef.current === activeRunId) return;
    if (mode === "initial") {
      lastHydratedRunIdRef.current = activeRunId;
    }
    try {
      const runApiScope = isCityScope ? "city" : "barangay";
      const res = await fetch(
        `/api/${runApiScope}/aips/runs/${encodeURIComponent(activeRunId)}`
      );
      if (!res.ok) return;
      const payload = (await res.json()) as RunSnapshotPayload;
      if (!payload || payload.runId !== activeRunId) return;
      applyRunStatusPayload({
        runId: payload.runId,
        status: payload.status,
        stage: payload.stage,
        errorMessage: payload.errorMessage,
        overallProgressPct: payload.overallProgressPct,
        stageProgressPct: payload.stageProgressPct,
        progressMessage: payload.progressMessage,
        progressUpdatedAt: payload.progressUpdatedAt,
      });
    } catch {
      // best-effort sync; realtime remains primary transport
    }
  }, [activeRunId, applyRunStatusPayload, isCityScope, shouldTrackRunStatus]);

  useEffect(() => {
    if (!activeRunId) {
      lastHydratedRunIdRef.current = null;
      return;
    }
    void hydrateRunSnapshot("initial");
  }, [activeRunId, hydrateRunSnapshot]);

  const handleRealtimeUnavailable = useCallback(() => {
    setRunNotice(LIVE_STATUS_UNAVAILABLE_NOTICE);
  }, []);

  const handleRealtimeRunEvent = useCallback(
    (event: ExtractionRunRealtimeEvent) => {
      applyRunStatusPayload(mapRealtimeEventToRunStatusPayload(event));
    },
    [applyRunStatusPayload]
  );

  const handleRealtimeStatusChange = useCallback(
    (status: REALTIME_SUBSCRIBE_STATES) => {
      if (status === "SUBSCRIBED") {
        setRunNotice(null);
        void hydrateRunSnapshot("resync");
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        handleRealtimeUnavailable();
      }
    },
    [handleRealtimeUnavailable, hydrateRunSnapshot]
  );

  useExtractionRunsRealtime({
    enabled: shouldTrackRunStatus && Boolean(activeRunId),
    runId: activeRunId ?? undefined,
    channelKey: `${scope}-aip-detail-${aip.id}-${activeRunId ?? "none"}`,
    onRunEvent: handleRealtimeRunEvent,
    onSubscribeError: () => {
      handleRealtimeUnavailable();
    },
    onStatusChange: handleRealtimeStatusChange,
  });

  useEffect(() => {
    if (!isFinalizingAfterSuccess) return;

    if (hasSummaryText(aip.summaryText)) {
      setIsFinalizingAfterSuccess(false);
      setProcessingRun(null);
      setProcessingState("idle");
      setFinalizingNotice(null);
      return;
    }

    let cancelled = false;

    async function refreshUntilSummaryIsReady() {
      for (
        let attempt = 1;
        attempt <= FINALIZE_REFRESH_MAX_ATTEMPTS;
        attempt += 1
      ) {
        if (cancelled) return;
        router.refresh();
        await wait(FINALIZE_REFRESH_INTERVAL_MS);
      }

      if (cancelled) return;

      setIsFinalizingAfterSuccess(false);
      setProcessingRun(null);
      setProcessingState("idle");
      setFinalizingNotice(
        "Processing completed, but the updated summary is still syncing. Click refresh to load the latest output."
      );
    }

    void refreshUntilSummaryIsReady();

    return () => {
      cancelled = true;
    };
  }, [aip.summaryText, isFinalizingAfterSuccess, router]);

  useEffect(() => {
    if (!finalizingNotice) return;
    if (!hasSummaryText(aip.summaryText)) return;
    setFinalizingNotice(null);
  }, [aip.summaryText, finalizingNotice]);

  const handleManualRefresh = useCallback(() => {
    setIsManualRefreshing(true);
    router.refresh();
    window.setTimeout(() => {
      setIsManualRefreshing(false);
    }, 1200);
  }, [router]);

  const handleRetryEmbedding = useCallback(async () => {
    try {
      setIsRetryingEmbedding(true);
      setEmbeddingRetryError(null);
      setEmbeddingRetrySuccess(null);
      const runApiScope = isCityScope ? "city" : "barangay";
      const response = await fetch(
        `/api/${runApiScope}/aips/${encodeURIComponent(aip.id)}/embed/retry`,
        { method: "POST" }
      );
      const payload = (await response.json()) as {
        message?: string;
        reason?: "missing" | "failed" | "skipped";
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to dispatch embedding.");
      }
      const successMessage =
        payload.reason === "failed"
          ? "Embedding retry dispatched."
          : "Embedding job dispatched.";
      setEmbeddingRetrySuccess(successMessage);
      router.refresh();
    } catch (error) {
      setEmbeddingRetryError(
        error instanceof Error ? error.message : "Failed to dispatch embedding."
      );
    } finally {
      setIsRetryingEmbedding(false);
    }
  }, [aip.id, isCityScope, router]);

  const handleRetryFailedRun = useCallback(async (mode: RetryFailedRunMode) => {
    if (!failedRun) return;

    try {
      setRetryingMode(mode);
      setRetryError(null);
      setRunNotice(null);
      const runApiScope = isCityScope ? "city" : "barangay";

      const response = await fetch(
        `/api/${runApiScope}/aips/runs/${encodeURIComponent(failedRun.runId)}/retry`,
        withCsrfHeader({
          method: "POST",
          body: JSON.stringify({ retryMode: mode }),
        })
      );

      const payload = (await response.json()) as {
        message?: string;
        runId?: string;
      };

      if (!response.ok || !payload.runId) {
        throw new Error(payload.message ?? "Failed to retry extraction run.");
      }

      setFailedRun(null);
      setActiveRunId(payload.runId);
      setProcessingState("processing");
      setIsFinalizingAfterSuccess(false);
      setFinalizingNotice(null);
    } catch (error) {
      setRetryError(
        error instanceof Error ? error.message : "Failed to retry extraction run."
      );
    } finally {
      setRetryingMode(null);
    }
  }, [failedRun, isCityScope]);

  useEffect(() => {
    setWorkflowPendingAction(null);
    setWorkflowError(null);
    setWorkflowSuccess(null);
    setRevisionReplyDraft("");
    setCityPublishConfirmOpen(false);
    setDeleteDraftConfirmOpen(false);
    setEmbeddingRetryError(null);
    setEmbeddingRetrySuccess(null);
    setProjectsLoading(true);
    setProjectsError(null);
    setUnresolvedAiCount(0);
  }, [aip.id]);

  useEffect(() => {
    if (aip.status !== "for_revision") {
      setRevisionReplyDraft("");
    }
  }, [aip.status]);

  const isWorkflowBusy = workflowPendingAction !== null;
  const canManageBarangayWorkflow =
    !isBarangayScope || aip.workflowPermissions?.canManageBarangayWorkflow !== false;
  const barangayWorkflowLockReason =
    aip.workflowPermissions?.lockReason ??
    "Only the uploader of this AIP can modify this workflow.";
  const trimmedRevisionReply = revisionReplyDraft.trim();
  const currentRevisionCycle = aip.revisionFeedbackCycles?.[0];
  const hasSavedCurrentCycleReply =
    typeof aip.revisionFeedbackCycles !== "undefined"
      ? (currentRevisionCycle?.replies.length ?? 0) > 0
      : typeof aip.revisionReply?.body === "string" &&
        aip.revisionReply.body.trim().length > 0;
  const requiresRevisionReply =
    isBarangayScope && aip.status === "for_revision" && !hasSavedCurrentCycleReply;
  const canSubmitForReview =
    canManageBarangayWorkflow &&
    !projectsLoading &&
    !projectsError &&
    unresolvedAiCount === 0 &&
    (!requiresRevisionReply || trimmedRevisionReply.length > 0);
  const canSaveRevisionReply =
    isBarangayScope &&
    canManageBarangayWorkflow &&
    (isForRevision || isDraftWithRevisionHistory) &&
    trimmedRevisionReply.length > 0 &&
    !isWorkflowBusy;
  const revisionFeedbackCycles = aip.revisionFeedbackCycles ?? [];
  const shouldShowRevisionFeedbackHistory =
    aip.status !== "published" || revisionFeedbackCycles.length > 0;
  const submitBlockedReason = projectsLoading
    ? "Loading project review statuses before submission."
    : projectsError
      ? "Project review statuses are unavailable right now. Please refresh and try again."
      : unresolvedAiCount > 0
        ? `${unresolvedAiCount} AI-flagged project(s) still need an official response before submission.`
        : requiresRevisionReply && trimmedRevisionReply.length === 0
          ? "Reply to reviewer remarks is required before resubmission."
        : null;

  const handleProjectsStateChange = useCallback(
    (state: {
      loading: boolean;
      error: string | null;
      unresolvedAiCount: number;
    }) => {
      setProjectsLoading(state.loading);
      setProjectsError(state.error);
      setUnresolvedAiCount(state.unresolvedAiCount);
    },
    []
  );

  const submitForReview = useCallback(async () => {
    if (isWorkflowBusy || !canSubmitForReview) return;

    try {
      setWorkflowPendingAction(isCityScope ? "submit_publish" : "submit_review");
      setWorkflowError(null);
      setWorkflowSuccess(null);

      const result = isCityScope
        ? await submitCityAipForPublishAction({
            aipId: aip.id,
          })
        : await submitAipForReviewAction({
            aipId: aip.id,
            revisionReply:
              aip.status === "for_revision" && trimmedRevisionReply.length > 0
                ? trimmedRevisionReply
                : undefined,
          });
      if (!result.ok) {
        setWorkflowError(result.message);
        if (typeof result.unresolvedAiCount === "number") {
          setUnresolvedAiCount(result.unresolvedAiCount);
        }
        return;
      }

      setWorkflowSuccess(result.message);
      router.refresh();
    } catch (error) {
      setWorkflowError(
        error instanceof Error
          ? error.message
          : isCityScope
            ? "Failed to publish AIP."
            : "Failed to submit AIP for review."
      );
    } finally {
      setWorkflowPendingAction(null);
    }
  }, [
    aip.id,
    aip.status,
    canSubmitForReview,
    isCityScope,
    isWorkflowBusy,
    trimmedRevisionReply,
    router,
  ]);

  const saveRevisionReply = useCallback(async () => {
    if (
      !isBarangayScope ||
      !canManageBarangayWorkflow ||
      aip.status !== "for_revision" ||
      isWorkflowBusy
    ) {
      return;
    }
    if (!trimmedRevisionReply) return;

    try {
      setWorkflowPendingAction("save_reply");
      setWorkflowError(null);
      setWorkflowSuccess(null);

      const result = await saveAipRevisionReplyAction({
        aipId: aip.id,
        reply: trimmedRevisionReply,
      });
      if (!result.ok) {
        setWorkflowError(result.message);
        return;
      }

      setRevisionReplyDraft("");
      setWorkflowSuccess(result.message);
      router.refresh();
    } catch (error) {
      setWorkflowError(
        error instanceof Error ? error.message : "Failed to save revision reply."
      );
    } finally {
      setWorkflowPendingAction(null);
    }
  }, [
    aip.id,
    aip.status,
    canManageBarangayWorkflow,
    isBarangayScope,
    isWorkflowBusy,
    router,
    trimmedRevisionReply,
  ]);

  const deleteDraft = useCallback(async () => {
    if (isBarangayScope && !canManageBarangayWorkflow) {
      setWorkflowError(barangayWorkflowLockReason);
      return;
    }
    if (isWorkflowBusy) return;

    try {
      setWorkflowPendingAction("delete_draft");
      setWorkflowError(null);
      setWorkflowSuccess(null);

      const result = await deleteAipDraftAction({ aipId: aip.id });
      if (!result.ok) {
        setWorkflowError(result.message);
        return;
      }

      setWorkflowSuccess(result.message);
      router.push(`/${scope}/aips`);
    } catch (error) {
      setWorkflowError(
        error instanceof Error ? error.message : "Failed to delete draft AIP."
      );
    } finally {
      setWorkflowPendingAction(null);
    }
  }, [
    aip.id,
    barangayWorkflowLockReason,
    canManageBarangayWorkflow,
    isBarangayScope,
    isWorkflowBusy,
    router,
    scope,
  ]);

  const cancelSubmission = useCallback(async () => {
    if (!isBarangayScope) {
      (onCancelSubmission ?? onCancel)?.();
      return;
    }
    if (!canManageBarangayWorkflow) {
      setWorkflowError(barangayWorkflowLockReason);
      return;
    }
    if (isWorkflowBusy) return;

    const confirmed = window.confirm(
      "Cancel this submission?"
    );
    if (!confirmed) return;

    try {
      setWorkflowPendingAction("cancel_submission");
      setWorkflowError(null);
      setWorkflowSuccess(null);

      const result = await cancelAipSubmissionAction({ aipId: aip.id });
      if (!result.ok) {
        setWorkflowError(result.message);
        return;
      }

      setWorkflowSuccess(result.message);
      router.refresh();
    } catch (error) {
      setWorkflowError(
        error instanceof Error
          ? error.message
          : "Failed to cancel AIP submission."
      );
    } finally {
      setWorkflowPendingAction(null);
    }
  }, [
    aip.id,
    barangayWorkflowLockReason,
    canManageBarangayWorkflow,
    isBarangayScope,
    isWorkflowBusy,
    onCancel,
    onCancelSubmission,
    router,
  ]);

  const openCityPublishConfirm = useCallback(() => {
    if (!isCityScope || isWorkflowBusy || !canSubmitForReview) return;
    setCityPublishConfirmOpen(true);
  }, [canSubmitForReview, isCityScope, isWorkflowBusy]);

  const confirmCityPublish = useCallback(() => {
    setCityPublishConfirmOpen(false);
    void submitForReview();
  }, [submitForReview]);

  const openDeleteDraftConfirm = useCallback(() => {
    if (isBarangayScope && !canManageBarangayWorkflow) return;
    if (aip.status !== "draft" || isWorkflowBusy) return;
    setDeleteDraftConfirmOpen(true);
  }, [aip.status, canManageBarangayWorkflow, isBarangayScope, isWorkflowBusy]);

  const confirmDeleteDraft = useCallback(() => {
    setDeleteDraftConfirmOpen(false);
    void deleteDraft();
  }, [deleteDraft]);

  const effectiveResubmitHandler = isBarangayScope
    ? aip.status === "for_revision" && canSubmitForReview && !isWorkflowBusy
      ? () => {
          void submitForReview();
        }
      : undefined
    : isCityScope
      ? aip.status === "for_revision" && canSubmitForReview && !isWorkflowBusy
        ? openCityPublishConfirm
        : undefined
      : onResubmit;

  const effectiveCancelSubmissionHandler = isBarangayScope
    ? aip.status === "pending_review" && canManageBarangayWorkflow && !isWorkflowBusy
      ? () => {
          void cancelSubmission();
        }
      : undefined
    : onCancelSubmission ?? onCancel;

  const breadcrumb = [
    { label: "AIP Management", href: `/${scope}/aips` },
    { label: aip.title, href: "#" },
  ];

  const shouldBlockWithProcessingUi =
    shouldTrackRunStatus &&
    (isCheckingRun ||
      isFinalizingAfterSuccess ||
      (Boolean(activeRunId) && processingState === "processing"));

  const failedNoticeRun = failedRun;
  const shouldShowFailedRunOnly = !shouldBlockWithProcessingUi && Boolean(failedNoticeRun);
  const failedStageRetryLabel = failedNoticeRun
    ? `Restart from ${getPipelineStageLabel(failedNoticeRun.stage)} Stage`
    : "Restart from Failed Stage";

  return (
    <div className="space-y-6">
      <BreadcrumbNav items={breadcrumb} />

      {shouldBlockWithProcessingUi ? (
        isCheckingRun ? (
          <div className="mx-auto w-full max-w-[900px] rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 shadow-sm">
            Checking extraction status...
          </div>
        ) : (
          <AipProcessingInlineStatus run={processingRun} state="processing" />
        )
      ) : (
        <>
          {/* title bar */}
          <Card className="border-slate-200">
            <CardContent className="flex items-center justify-between px-6">
              <h1 className="text-2xl font-bold text-slate-900">{aip.title}</h1>

              <Badge
                variant="outline"
                className={`rounded-full ${getAipStatusBadgeClass(aip.status)}`}
              >
                {aip.status}
              </Badge>
            </CardContent>
          </Card>

          {shouldShowFailedRunOnly && failedNoticeRun ? (
            <Alert className="border-rose-200 bg-rose-50">
              <AlertTitle className="text-rose-900">Pipeline Failed</AlertTitle>
              <AlertDescription className="space-y-3 text-rose-800">
                <p>
                  <span className="font-semibold">Completed stages:</span>{" "}
                  {(() => {
                    const completedStages = getCompletedPipelineStageLabels(
                      failedNoticeRun.stage
                    );
                    return completedStages.length > 0
                      ? completedStages.join(" > ")
                      : "None";
                  })()}
                </p>
                <p>
                  <span className="font-semibold">Failed at:</span>{" "}
                  {getPipelineStageLabel(failedNoticeRun.stage)}
                </p>
                <p>
                  {failedNoticeRun.message ??
                    "We were unable to complete the AIP extraction pipeline."}
                </p>
                {retryError ? <p>{retryError}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="bg-rose-600 hover:bg-rose-700"
                    onClick={() => {
                      void handleRetryFailedRun("failed_stage");
                    }}
                    disabled={isRetrying}
                  >
                    {retryingMode === "failed_stage"
                      ? "Restarting..."
                      : failedStageRetryLabel}
                  </Button>
                  <Button
                    variant="outline"
                    className="border-rose-300 text-rose-900 hover:bg-rose-100"
                    onClick={() => {
                      void handleRetryFailedRun("scratch");
                    }}
                    disabled={isRetrying}
                  >
                    {retryingMode === "scratch"
                      ? "Restarting..."
                      : "Restart from Scratch"}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {runNotice ? (
                <Alert className="border-amber-200 bg-amber-50">
                  <AlertDescription className="text-amber-800">{runNotice}</AlertDescription>
                </Alert>
              ) : null}

              {workflowError ? (
                <Alert className="border-rose-200 bg-rose-50">
                  <AlertDescription className="text-rose-800">
                    {workflowError}
                  </AlertDescription>
                </Alert>
              ) : null}

              {workflowSuccess ? (
                <Alert className="border-emerald-200 bg-emerald-50">
                  <AlertDescription className="text-emerald-800">
                    {workflowSuccess}
                  </AlertDescription>
                </Alert>
              ) : null}

              {finalizingNotice ? (
                <Alert className="border-amber-200 bg-amber-50">
                  <AlertTitle className="text-amber-900">Processing Complete</AlertTitle>
                  <AlertDescription className="space-y-3 text-amber-800">
                    <p>{finalizingNotice}</p>
                    <div className="flex justify-start">
                      <Button
                        variant="outline"
                        className="border-amber-300 text-amber-900 hover:bg-amber-100"
                        onClick={handleManualRefresh}
                        disabled={isManualRefreshing}
                      >
                        {isManualRefreshing ? "Refreshing..." : "Refresh now"}
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : null}

              {(isBarangayScope || isCityScope) &&
              (aip.status === "draft" || aip.status === "for_revision") &&
              submitBlockedReason ? (
                <Alert className="border-amber-200 bg-amber-50">
                  <AlertDescription className="text-amber-800">
                    {submitBlockedReason}
                  </AlertDescription>
                </Alert>
              ) : null}

              {isBarangayScope &&
              !canManageBarangayWorkflow &&
              (aip.status === "draft" ||
                aip.status === "for_revision" ||
                aip.status === "pending_review") ? (
                <Alert className="border-amber-200 bg-amber-50">
                  <AlertDescription className="text-amber-800">
                    {barangayWorkflowLockReason}
                  </AlertDescription>
                </Alert>
              ) : null}

              <div
                className={
                  showRightSidebar
                    ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
                    : "space-y-6"
                }
              >

                <div className="space-y-6">
                  <AipPdfContainer aip={aip} />

              <div className="flex items-center">
                <Tabs
                  value={activeTab}
                  onValueChange={(value) => {
                    const params = new URLSearchParams(searchParams.toString());
                    if (value === "comments") {
                      params.set("tab", "comments");
                      params.delete("thread");
                      params.delete("comment");
                    } else {
                      params.delete("tab");
                      params.delete("thread");
                      params.delete("comment");
                      params.delete("focus");
                    }
                    const query = params.toString();
                    router.replace(query ? `${pathname}?${query}` : pathname, {
                      scroll: false,
                    });
                  }}
                >
                  <TabsList className="h-10 gap-2 bg-transparent p-0">
                    <TabsTrigger
                      value="summary"
                      className="h-9 rounded-lg px-4 text-sm font-medium text-slate-500 data-[state=active]:border data-[state=active]:border-slate-200 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
                    >
                      Summary
                    </TabsTrigger>
                    <TabsTrigger
                      value="comments"
                      className="h-9 rounded-lg px-4 text-sm font-medium text-slate-500 data-[state=active]:border data-[state=active]:border-slate-200 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
                      onClick={() => {
                        if (activeTab !== "comments") return;
                        const params = new URLSearchParams(searchParams.toString());
                        params.set("tab", "comments");
                        params.delete("thread");
                        params.delete("comment");
                        const query = params.toString();
                        router.replace(query ? `${pathname}?${query}` : pathname, {
                          scroll: false,
                        });
                      }}
                    >
                      Feedback
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {activeTab === "summary" ? (
                <>
                  <AipDetailsSummary aip={aip} />

                  <AipDetailsTableView
                    aipId={aip.id}
                    year={aip.year}
                    aipStatus={aip.status}
                    scope={scope}
                    focusedRowId={focusedRowId}
                    enablePagination
                    onProjectsStateChange={handleProjectsStateChange}
                  />

                </>
              ) : (
                <div className="space-y-3">
                  {revisionFeedbackCycles.length > 0 ? (
                    <RevisionFeedbackHistoryCard
                      cycles={revisionFeedbackCycles}
                      title="Workflow Feedback"
                      description="Official feedback history from AIP submission and revision cycles."
                      reviewerFallbackLabel="Reviewer"
                      replyAuthorFallbackLabel="Barangay Official"
                      emptyStateLabel="No workflow feedback history yet."
                      emptyRepliesLabel="No official reply saved for this cycle yet."
                    />
                  ) : (
                    <Card className="border-slate-200">
                      <CardContent className="px-5 text-sm text-slate-600">
                        No workflow feedback history yet.
                      </CardContent>
                    </Card>
                  )}

                  {aip.status === "published" ? (
                    <Card className="border-slate-200">
                      <CardContent className="space-y-3 px-5">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">
                            Citizen Feedback
                          </h3>
                          <p className="text-xs text-slate-500">
                            Citizen discussion threads for this published AIP.
                            Officials can reply.
                          </p>
                        </div>
                        <LguAipFeedbackThread
                          aipId={aip.id}
                          scope={scope}
                          selectedThreadId={threadId}
                          selectedFeedbackId={commentId}
                        />
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              )}

              {/* Bottom action */}
              <div className="flex justify-end gap-3">
                {aip.status === "draft" ? (
                  <>
                    {!isBarangayScope || canManageBarangayWorkflow ? (
                      <Button
                        variant="outline"
                        onClick={openDeleteDraftConfirm}
                        disabled={isWorkflowBusy}
                      >
                        <X className="h-4 w-4" />
                        {workflowPendingAction === "delete_draft"
                          ? "Deleting..."
                          : "Delete Draft"}
                      </Button>
                    ) : null}
                    {isBarangayScope && canManageBarangayWorkflow ? (
                      <Button
                        className="bg-[#022437] hover:bg-[#022437]/90"
                        onClick={() => {
                          void submitForReview();
                        }}
                        disabled={isWorkflowBusy || !canSubmitForReview}
                      >
                        <Send className="h-4 w-4" />
                        {workflowPendingAction === "submit_review"
                          ? "Submitting..."
                          : "Submit for Review"}
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {isCityScope &&
                (aip.status === "draft" || aip.status === "for_revision") ? (
                    <Button
                      className="bg-[#022437] hover:bg-[#022437]/90"
                      onClick={() => {
                        openCityPublishConfirm();
                      }}
                      disabled={isWorkflowBusy || !canSubmitForReview}
                    >
                      <Send className="h-4 w-4" />
                      {workflowPendingAction === "submit_publish"
                        ? "Publishing..."
                        : "Submit & Publish"}
                    </Button>
                ) : null}
              </div>
            </div>

                {showRightSidebar ? (
                  <div className="h-fit space-y-6 lg:sticky lg:top-4">
                {showRevisionWorkflowSidebar ? (
                  <>
                    <Card className="border-slate-200">
                      <CardContent className="space-y-4 px-5">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">
                            Official Comment / Justification
                          </h3>
                        </div>

                        {isForRevision ? (
                          <>
                            <div className="rounded border border-amber-200 bg-amber-50 px-3 text-xs text-amber-800">
                              Reviewer feedback is available. Save your response, then
                              resubmit this AIP when ready.
                            </div>
                            {canManageBarangayWorkflow ? (
                              <>
                                <p className="mt-1 text-xs text-slate-500">
                                  Provide your justification before saving.
                                </p>

                                <Textarea
                                  value={revisionReplyDraft}
                                  onChange={(event) => {
                                    setRevisionReplyDraft(event.target.value);
                                  }}
                                  placeholder="Explain what changed (or your response to reviewer remarks)."
                                  className="min-h-[130px]"
                                  disabled={isWorkflowBusy}
                                />

                                <Button
                                  className="w-full bg-[#022437] hover:bg-[#022437]/90"
                                  onClick={() => {
                                    void saveRevisionReply();
                                  }}
                                  disabled={!canSaveRevisionReply}
                                >
                                  {workflowPendingAction === "save_reply"
                                    ? "Saving..."
                                    : "Save Reply"}
                                </Button>

                                <Button
                                  className="w-full bg-teal-600 hover:bg-teal-700"
                                  onClick={effectiveResubmitHandler}
                                  disabled={!effectiveResubmitHandler}
                                >
                                  <RotateCw className="h-4 w-4" />
                                  {workflowPendingAction === "submit_review"
                                    ? "Submitting..."
                                    : "Resubmit"}
                                </Button>
                              </>
                            ) : (
                              <p className="text-xs text-slate-600">
                                {barangayWorkflowLockReason}
                              </p>
                            )}
                          </>
                        ) : null}

                        {isPendingReview ? (
                          <>
                            <div className="rounded border border-amber-200 bg-amber-50 px-3 text-xs text-amber-800">
                              Editing is not allowed while the AIP is pending review.
                              Please wait for the review process to complete.
                            </div>

                            {canManageBarangayWorkflow ? (
                              <Button
                                className="w-full bg-rose-600 hover:bg-rose-700"
                                onClick={effectiveCancelSubmissionHandler}
                                disabled={!effectiveCancelSubmissionHandler}
                              >
                                <X className="h-4 w-4" />
                                {workflowPendingAction === "cancel_submission"
                                  ? "Canceling..."
                                  : "Cancel Submission"}
                              </Button>
                            ) : (
                              <p className="text-xs text-slate-600">
                                {barangayWorkflowLockReason}
                              </p>
                            )}
                          </>
                        ) : null}

                        {isDraftWithRevisionHistory ? (
                          <>
                            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                              This AIP was previously returned for revision.
                              Feedback history remains available while you continue editing this draft.
                            </div>

                            {canManageBarangayWorkflow ? (
                              <>
                                <p className="mt-1 text-xs text-slate-500">
                                  Provide your justification before saving.
                                </p>

                                <Textarea
                                  value={revisionReplyDraft}
                                  onChange={(event) => {
                                    setRevisionReplyDraft(event.target.value);
                                  }}
                                  placeholder="Explain what changed (or your response to reviewer remarks)."
                                  className="min-h-[130px]"
                                  disabled={isWorkflowBusy}
                                />

                                <Button
                                  className="w-full bg-[#022437] hover:bg-[#022437]/90"
                                  onClick={() => {
                                    void saveRevisionReply();
                                  }}
                                  disabled={!canSaveRevisionReply}
                                >
                                  {workflowPendingAction === "save_reply"
                                    ? "Saving..."
                                    : "Save Reply"}
                                </Button>
                              </>
                            ) : (
                              <p className="text-xs text-slate-600">
                                {barangayWorkflowLockReason}
                              </p>
                            )}
                          </>
                        ) : null}
                      </CardContent>
                    </Card>
                  </>
                ) : null}

                {showStatusSidebar ? (
              <AipStatusInfoCard status={aip.status} reviewerMessage={aip.feedback} />
                ) : null}

                {aip.status === "published" && chatbotReadiness ? (
                  <Card className="border-slate-200">
                    <CardContent className="space-y-3 px-5">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span className={getChatbotStatusToneClass(chatbotReadiness.tone)}>
                          <ChatbotStatusIcon kind={chatbotReadiness.kind} />
                        </span>
                        {chatbotReadiness.title}
                      </div>
                      <div className="text-xs text-slate-600">
                        {chatbotReadiness.message}
                      </div>
                      {chatbotReadiness.kind === "embedding" &&
                      typeof chatbotReadiness.progressPct === "number" ? (
                        <div className="text-xs text-slate-500">
                          Progress: {chatbotReadiness.progressPct}%
                        </div>
                      ) : null}
                      {embeddingRetrySuccess ? (
                        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                          {embeddingRetrySuccess}
                        </div>
                      ) : null}
                      {embeddingRetryError ? (
                        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                          {embeddingRetryError}
                        </div>
                      ) : null}
                      {canManualEmbedDispatch ? (
                        <Button
                          className={embedActionButtonClass}
                          onClick={() => {
                            void handleRetryEmbedding();
                          }}
                          disabled={isRetryingEmbedding}
                        >
                          {isRetryingEmbedding ? "Dispatching..." : embedActionButtonLabel}
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                ) : null}

                {aip.status === "published" && aip.publishedBy ? (
                  <AipPublishedByCard publishedBy={aip.publishedBy} />
                ) : null}

                {shouldShowRevisionFeedbackHistory ? (
                  <RevisionFeedbackHistoryCard
                    cycles={revisionFeedbackCycles}
                    title="Reviewer Feedback History"
                    description="Reviewer remarks and official replies grouped by revision cycle."
                    reviewerFallbackLabel="Reviewer"
                    replyAuthorFallbackLabel="Barangay Official"
                    emptyStateLabel="No revision feedback history yet."
                    emptyRepliesLabel="No official reply saved for this cycle yet."
                  />
                ) : null}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </>
      )}
      <Dialog open={cityPublishConfirmOpen} onOpenChange={setCityPublishConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Publish AIP</DialogTitle>
            <DialogDescription>
              Confirm publishing this city AIP for immediate public viewing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-slate-600">
            <div>
              Are you sure you want to publish this Annual Investment Plan? Once
              published, it will be publicly available.
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">{aip.title}</div>
              <div className="text-xs text-slate-500">Fiscal Year {aip.year}</div>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setCityPublishConfirmOpen(false)}
                disabled={isWorkflowBusy}
              >
                Cancel
              </Button>
              <Button
                className="bg-teal-600 hover:bg-teal-700"
                onClick={confirmCityPublish}
                disabled={isWorkflowBusy || !canSubmitForReview}
              >
                {workflowPendingAction === "submit_publish"
                  ? "Publishing..."
                  : "Confirm & Publish"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteDraftConfirmOpen} onOpenChange={setDeleteDraftConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete Draft AIP</DialogTitle>
            <DialogDescription>
              Confirm deleting this draft AIP. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-slate-600">
            <div>
              Are you sure you want to permanently delete this draft Annual
              Investment Plan?
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">{aip.title}</div>
              <div className="text-xs text-slate-500">Fiscal Year {aip.year}</div>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setDeleteDraftConfirmOpen(false)}
                disabled={isWorkflowBusy}
              >
                Cancel
              </Button>
              <Button
                className="bg-rose-600 hover:bg-rose-700"
                onClick={confirmDeleteDraft}
                disabled={isWorkflowBusy}
              >
                {workflowPendingAction === "delete_draft"
                  ? "Deleting..."
                  : "Confirm Delete"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
