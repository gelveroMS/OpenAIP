import type { AipRow, AipReviewRow, ActivityLogRow, AipStatus } from "@/lib/contracts/databasev2";
import type { AipMonitoringRow, AipMonitoringStatus, CaseRow, CaseType } from "@/lib/types/viewmodels/aip-monitoring.vm";
import type { AipMonitoringDetail } from "@/mocks/fixtures/admin/aip-monitoring/aipMonitoring.mock";

type ReviewDirectory = Record<string, { name: string }>;

function mapAipStatusToMonitoringStatus(status: AipStatus | string): AipMonitoringStatus {
  if (status === "for_revision") return "For Revision";
  if (status === "under_review") return "In Review";
  if (status === "published") return "Approved";
  if (status === "draft" || status === "pending_review") return "Pending";
  return "Pending";
}

function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function computeDurationDays(reference: string | null | undefined): number {
  if (!reference) return 0;
  const start = new Date(reference);
  if (Number.isNaN(start.getTime())) return 0;
  const today = new Date();
  const diffMs = today.getTime() - start.getTime();
  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function getLatestReview(reviews: AipReviewRow[], aipId: string): AipReviewRow | null {
  const rows = reviews
    .filter((review) => review.aip_id === aipId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return rows[0] ?? null;
}

function getCaseType(value: unknown): CaseType {
  if (value === "Stuck" || value === "Duplicate" || value === "Locked" || value === "Archived") {
    return value;
  }
  return "Locked";
}

export function mapAipRowsToMonitoringRows({
  aips,
  reviews,
  activity,
  details,
  budgetTotalByAipId,
  lguNameByAipId,
  reviewerDirectory,
}: {
  aips: AipRow[];
  reviews: AipReviewRow[];
  activity: ActivityLogRow[];
  details: Record<string, AipMonitoringDetail>;
  budgetTotalByAipId: Record<string, number>;
  lguNameByAipId: Record<string, string>;
  reviewerDirectory: ReviewDirectory;
}): AipMonitoringRow[] {
  const lockedAipIds = new Set(
    activity
      .filter((log) => log.action === "workflow_case")
      .filter((log) => {
        const metadata = log.metadata as Record<string, unknown> | null;
        return getCaseType(metadata?.case_type) === "Locked";
      })
      .map((log) => log.entity_id)
      .filter(Boolean) as string[]
  );

  return aips.map((row) => {
    const detail = details[row.id];
    const latestReview = getLatestReview(reviews, row.id);
    const reviewerName = latestReview
      ? reviewerDirectory[latestReview.reviewer_id]?.name ?? latestReview.reviewer_id
      : null;

    const baseStatus = mapAipStatusToMonitoringStatus(row.status);
    const status = lockedAipIds.has(row.id) ? "Locked" : baseStatus;

    return {
      id: row.id,
      year: row.fiscal_year,
      lguName: lguNameByAipId[row.id] ?? "Unknown LGU",
      budgetTotal:
        typeof budgetTotalByAipId[row.id] === "number" &&
        Number.isFinite(budgetTotalByAipId[row.id])
          ? budgetTotalByAipId[row.id]
          : 0,
      aipStatus: row.status,
      status,
      submittedDate: formatIsoDate(row.submitted_at ?? row.created_at),
      currentStatusSince: formatIsoDate(row.status_updated_at),
      durationDays: detail?.durationDays ?? computeDurationDays(row.status_updated_at),
      claimedBy: reviewerName,
      lastUpdated: formatIsoDate(row.updated_at),
      fileName: detail?.fileName ?? "AIP_Document.pdf",
      pdfUrl: detail?.pdfUrl ?? "",
      summaryText: detail?.summaryText ?? "Summary pending.",
      detailedBullets: detail?.detailedBullets ?? [],
      submissionHistory: detail?.submissionHistory ?? [],
      archivedSubmissions: detail?.archivedSubmissions ?? [],
      timeline: detail?.timeline ?? [],
    };
  });
}

export function mapActivityToCaseRows({
  activity,
  aips,
  lguNameByAipId,
}: {
  activity: ActivityLogRow[];
  aips: AipRow[];
  lguNameByAipId: Record<string, string>;
}): CaseRow[] {
  const aipById = new Map(aips.map((row) => [row.id, row]));

  return activity
    .filter((log) => log.action === "workflow_case")
    .map((log) => {
      const metadata = (log.metadata as Record<string, unknown>) ?? {};
      const caseType = getCaseType(metadata.case_type);
      const aip = log.entity_id ? aipById.get(log.entity_id) : undefined;
      const lguName = log.entity_id
        ? lguNameByAipId[log.entity_id] ?? "Unknown LGU"
        : "Unknown LGU";

      const durationDays =
        typeof metadata.duration_days === "number"
          ? metadata.duration_days
          : computeDurationDays(log.created_at);

      const claimedBy =
        typeof metadata.claimed_by === "string" ? metadata.claimed_by : null;

      const lastUpdated =
        typeof metadata.last_updated_at === "string"
          ? metadata.last_updated_at
          : formatIsoDate(log.created_at);

      const previousCaseType =
        typeof metadata.previous_case_type === "string"
          ? getCaseType(metadata.previous_case_type)
          : undefined;

      return {
        id: log.id,
        year: aip?.fiscal_year ?? new Date(log.created_at).getFullYear(),
        lguName,
        caseType,
        durationDays,
        claimedBy,
        lastUpdated,
        isArchived: caseType === "Archived",
        previousCaseType:
          caseType === "Archived" && previousCaseType !== "Archived"
            ? previousCaseType
            : undefined,
      };
    });
}
