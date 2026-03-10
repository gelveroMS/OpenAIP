import KpiCard, { type KpiCardAccent } from "@/components/kpi-card";
import type { DashboardAip } from "@/features/dashboard/types/dashboard-types";
import { AlertCircle, Clock3, FileText, FolderOpen, MessageSquare, UserCheck, Wallet, Zap } from "lucide-react";

function formatStatusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDateTime(value: string | null): string {
  if (!value) return "N/A";
  return new Date(value).toLocaleString("en-PH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function daysSince(dateValue: string | null): number {
  if (!dateValue) {
    return 0;
  }

  const now = Date.now();
  const then = new Date(dateValue).getTime();
  if (!Number.isFinite(then)) {
    return 0;
  }

  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

function statusAccent(status: string): KpiCardAccent {
  switch (status) {
    case "published":
      return "green";
    case "under_review":
      return "blue";
    case "for_revision":
      return "orange";
    case "pending_review":
      return "yellow";
    default:
      return "orange";
  }
}

export function KpiRow({
  selectedAip,
  totalProjects,
  totalBudget,
  citizenFeedbackCount,
  awaitingReplyCount,
  hiddenCount,
  pendingReviewCount,
  underReviewCount,
  forRevisionCount,
  oldestPendingDays,
  fiscalYear,
  projectBreakdownText,
  scope,
}: {
  selectedAip: DashboardAip | null;
  totalProjects: number;
  totalBudget: string;
  citizenFeedbackCount: number;
  awaitingReplyCount: number;
  hiddenCount: number;
  pendingReviewCount: number;
  underReviewCount: number;
  forRevisionCount: number;
  oldestPendingDays: number | null;
  fiscalYear: number;
  projectBreakdownText?: string;
  scope?: "city" | "barangay";
}) {
  if (scope === "city") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          variant="split"
          label="Pending Review"
          value={pendingReviewCount}
          subtext="As of today"
          icon={<AlertCircle className="h-5 w-5" strokeWidth={2.2} />}
          accent="orange"
          accentMode="value"
        />
        <KpiCard
          variant="split"
          label="Under Review"
          value={underReviewCount}
          subtext="As of today"
          icon={<Clock3 className="h-5 w-5" strokeWidth={2.2} />}
          accent="blue"
          accentMode="value"
        />
        <KpiCard
          variant="split"
          label="For Revision"
          value={forRevisionCount}
          subtext="As of today"
          icon={<FileText className="h-5 w-5" strokeWidth={2.2} />}
          accent="orange"
          accentMode="value"
        />
        <KpiCard
          variant="split"
          label="Available to Claim"
          value={pendingReviewCount}
          subtext="Ready for review"
          icon={<UserCheck className="h-5 w-5" strokeWidth={2.2} />}
          accent="green"
          accentMode="value"
        />
        <KpiCard
          variant="split"
          label="Oldest Pending"
          value={oldestPendingDays ?? 0}
          subtext="days in queue"
          icon={<Zap className="h-5 w-5" strokeWidth={2.2} />}
          accent="slate"
          accentMode="value"
        />
      </div>
    );
  }

  const daysInCurrentStatus = daysSince(selectedAip?.statusUpdatedAt ?? null);
  const feedbackValueLabel = `${citizenFeedbackCount} ${citizenFeedbackCount === 1 ? "Comment" : "Comments"}`;
  const aipStatusValue = selectedAip ? formatStatusLabel(selectedAip.status) : "No AIP";
  const aipStatusSubtext = selectedAip
    ? `${daysInCurrentStatus} days in current status`
    : `No AIP uploaded for FY ${fiscalYear}`;
  const aipStatusMeta = selectedAip ? `Last updated: ${formatDateTime(selectedAip.statusUpdatedAt)}` : undefined;
  const aipStatusAccent = selectedAip ? statusAccent(selectedAip.status) : "slate";

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        variant="status"
        label="AIP Status"
        value={aipStatusValue}
        subtext={aipStatusSubtext}
        meta={aipStatusMeta}
        icon={<FileText className="h-4 w-4" strokeWidth={2.2} />}
        accent={aipStatusAccent}
        accentMode="border"
      />
      <KpiCard
        variant="status"
        label="Total Projects"
        value={totalProjects}
        subtext={projectBreakdownText ?? "As of today"}
        icon={<FolderOpen className="h-5 w-5" strokeWidth={2.2} />}
        accent="blue"
        accentMode="border"
      />
      <KpiCard
        variant="status"
        label="Total Budget"
        value={totalBudget}
        subtext={`File total (fallback: project totals) for FY ${fiscalYear}`}
        icon={<Wallet className="h-5 w-5" strokeWidth={2.2} />}
        accent="green"
        accentMode="border"
      />
      <KpiCard
        variant="status"
        label="Citizen Feedback"
        value={feedbackValueLabel}
        subtext={`Unreplied: ${awaitingReplyCount} | Hidden: ${hiddenCount}`}
        icon={<MessageSquare className="h-5 w-5" strokeWidth={2.2} />}
        accent="orange"
        accentMode="border"
        badge={
          awaitingReplyCount > 0 || hiddenCount > 0
            ? { text: "Action Required", accent: "orange" }
            : undefined
        }
      />
    </div>
  );
}

export function PulseKpis({
  newThisWeek,
  awaitingReply,
  lguNotesPosted,
}: {
  newThisWeek: number;
  awaitingReply: number;
  lguNotesPosted: number;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard variant="compact" label="New This Week" value={newThisWeek} />
      <KpiCard
        variant="compact"
        label="Awaiting Reply"
        value={awaitingReply}
        accent="orange"
        accentMode="value"
      />
      <KpiCard
        variant="compact"
        label="Hidden"
        value={lguNotesPosted}
        accent="slate"
        accentMode="value"
      />
    </div>
  );
}


