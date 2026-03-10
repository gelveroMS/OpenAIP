import type {
  CitizenAipDetailRecord,
  CitizenAipListRecord,
  CitizenAipProjectDetailRecord,
} from "@/lib/repos/citizen-aips";
import type {
  AipDetails,
  AipListItem,
  AipProjectDetails,
} from "@/features/citizen/aips/types";

const DEFAULT_DETAILED_BULLETS = [
  "Road concreting and rehabilitation for key access roads",
  "Drainage and flood mitigation improvements",
  "Multi-purpose community facility upgrades",
  "Public safety equipment and lighting enhancement",
  "Community health and youth development programs",
];

const DEFAULT_DETAILED_INTRO =
  "This comprehensive plan addresses critical development needs through the following priority programs:";

const DEFAULT_DETAILED_CLOSING =
  "These programs are intended to improve quality of life, strengthen service delivery, and ensure inclusive local development.";

export function formatCurrency(amount: number): string {
  return `PHP ${amount.toLocaleString("en-US")}`;
}

export function formatPublishedDate(value: string | null): string {
  if (!value) return "TBD";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

export function toAipListItem(record: CitizenAipListRecord): AipListItem {
  return {
    id: record.id,
    scopeType: record.scopeType,
    scopeId: record.scopeId,
    lguLabel: record.lguLabel,
    cityScopeId: record.cityScopeId ?? null,
    cityScopeLabel: record.cityScopeLabel ?? null,
    barangayScopeId: record.barangayScopeId ?? null,
    barangayScopeLabel: record.barangayScopeLabel ?? null,
    title: record.title,
    fiscalYear: record.fiscalYear,
    publishedAt: record.publishedAt,
    budgetTotal: record.budgetTotal,
    projectsCount: record.projectsCount,
    description: record.description,
  };
}

export function toAipListItems(records: CitizenAipListRecord[]): AipListItem[] {
  return records.map(toAipListItem);
}

export function toAipDetails(record: CitizenAipDetailRecord): AipDetails {
  return {
    ...toAipListItem(record),
    subtitle: `Annual Investment Plan for Fiscal Year ${record.fiscalYear}`,
    fileName: record.fileName,
    pdfUrl: record.pdfUrl,
    summaryText: record.summaryText,
    detailedDescriptionIntro: DEFAULT_DETAILED_INTRO,
    detailedBullets: record.detailedBullets.length
      ? record.detailedBullets
      : DEFAULT_DETAILED_BULLETS,
    detailedClosing: DEFAULT_DETAILED_CLOSING,
    projectRows: record.projectRows.map((row) => ({
      id: row.id,
      category: row.category,
      sector: row.sector,
      projectRefCode: row.projectRefCode,
      programDescription: row.programDescription,
      totalAmount: row.totalAmount,
      hasAiIssues: row.hasAiIssues,
      hasLguNote: row.hasLguNote,
    })),
    accountability: record.accountability,
    feedbackCount: record.feedbackCount,
  };
}

export function toAipProjectDetails(
  record: CitizenAipProjectDetailRecord
): AipProjectDetails {
  return {
    aipId: record.aipId,
    projectId: record.projectId,
    category: record.category,
    sector: record.sector,
    projectRefCode: record.projectRefCode,
    title: record.title,
    description: record.description,
    implementingAgency: record.implementingAgency,
    sourceOfFunds: record.sourceOfFunds,
    expectedOutput: record.expectedOutput,
    startDate: record.startDate,
    completionDate: record.completionDate,
    totalAmount: record.totalAmount,
    aiIssues: record.aiIssues,
    hasLguNote: record.hasLguNote,
  };
}
