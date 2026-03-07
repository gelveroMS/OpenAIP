import type { ProjectCategory } from "@/lib/contracts/databasev2";
import type {
  CitizenAipAccountability,
  CitizenAipProjectSector,
  CitizenAipScopeType,
} from "@/lib/repos/citizen-aips";

export type AipAccountability = CitizenAipAccountability;

export type AipListItem = {
  id: string;
  scopeType: CitizenAipScopeType;
  scopeId: string;
  lguLabel: string;
  cityScopeId?: string | null;
  cityScopeLabel?: string | null;
  barangayScopeId?: string | null;
  barangayScopeLabel?: string | null;
  title: string;
  fiscalYear: number;
  publishedAt: string | null;
  budgetTotal: number;
  projectsCount: number;
  description: string;
};

export type AipProjectSector = CitizenAipProjectSector;

export type AipProjectRow = {
  id: string;
  category: ProjectCategory;
  sector: AipProjectSector;
  projectRefCode: string;
  programDescription: string;
  totalAmount: number;
  hasLguNote: boolean;
};

export type AipDetails = AipListItem & {
  subtitle: string;
  fileName: string;
  pdfUrl: string | null;
  summaryText: string;
  detailedDescriptionIntro: string;
  detailedBullets: string[];
  detailedClosing: string;
  projectRows: AipProjectRow[];
  accountability: CitizenAipAccountability;
  feedbackCount: number;
};

export type AipProjectDetails = {
  aipId: string;
  projectId: string;
  category: ProjectCategory;
  sector: AipProjectSector;
  projectRefCode: string;
  title: string;
  description: string;
  implementingAgency: string | null;
  sourceOfFunds: string | null;
  expectedOutput: string | null;
  startDate: string | null;
  completionDate: string | null;
  totalAmount: number;
  aiIssues: string[];
};

export type AipFilterLguOption = {
  key: string;
  scopeType: CitizenAipScopeType;
  scopeId: string;
  label: string;
};
