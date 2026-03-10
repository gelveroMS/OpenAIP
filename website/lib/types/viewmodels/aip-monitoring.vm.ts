import type { AipStatus } from "@/lib/contracts/databasev2";

export type AipMonitoringStatus =
  | "Pending"
  | "In Review"
  | "Approved"
  | "For Revision"
  | "Locked";

export type AipMonitoringRow = {
  id: string;
  year: number;
  lguName: string;
  budgetTotal: number;
  aipStatus: AipStatus;
  status: AipMonitoringStatus;
  submittedDate: string;
  currentStatusSince: string;
  durationDays: number;
  claimedBy: string | null;
  lastUpdated: string;
  fileName: string;
  pdfUrl?: string;
  summaryText: string;
  detailedBullets: string[];
  submissionHistory: { year: number; submittedDate: string; status: string }[];
  archivedSubmissions: {
    year: number;
    submittedDate: string;
    archivedDate: string;
    reason: string;
  }[];
  timeline: { label: string; date: string; note?: string }[];
};

export type CaseType = "Stuck" | "Duplicate" | "Locked" | "Archived";

export type CaseRow = {
  id: string;
  year: number;
  lguName: string;
  caseType: CaseType;
  durationDays: number;
  claimedBy: string | null;
  lastUpdated: string;
  isArchived?: boolean;
  previousCaseType?: Exclude<CaseType, "Archived">;
};
