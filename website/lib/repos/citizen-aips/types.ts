import type { ProjectCategory, RoleType } from "@/lib/contracts/databasev2";

export type CitizenAipScopeType = "city" | "barangay";

export type CitizenAipAccountabilityPerson = {
  id: string | null;
  name: string;
  role: RoleType | null;
  roleLabel: string;
};

export type CitizenAipAccountability = {
  uploadedBy: CitizenAipAccountabilityPerson | null;
  reviewedBy: CitizenAipAccountabilityPerson | null;
  approvedBy: CitizenAipAccountabilityPerson | null;
  uploadDate: string | null;
  approvalDate: string | null;
};

export type CitizenAipListRecord = {
  id: string;
  scopeType: CitizenAipScopeType;
  scopeId: string;
  lguLabel: string;
  cityScopeId?: string | null;
  cityScopeLabel?: string | null;
  barangayScopeId?: string | null;
  barangayScopeLabel?: string | null;
  title: string;
  description: string;
  fiscalYear: number;
  publishedAt: string | null;
  budgetTotal: number;
  projectsCount: number;
};

export type CitizenAipProjectSector =
  | "General Sector"
  | "Social Sector"
  | "Economic Sector"
  | "Other Services"
  | "Unknown";

export type CitizenAipDetailProjectRow = {
  id: string;
  aipId: string;
  category: ProjectCategory;
  sector: CitizenAipProjectSector;
  projectRefCode: string;
  programDescription: string;
  totalAmount: number;
  hasLguNote: boolean;
};

export type CitizenAipDetailRecord = CitizenAipListRecord & {
  fileName: string;
  pdfUrl: string | null;
  summaryText: string;
  detailedBullets: string[];
  projectRows: CitizenAipDetailProjectRow[];
  accountability: CitizenAipAccountability;
  feedbackCount: number;
};

export type CitizenAipProjectDetailRecord = {
  aipId: string;
  projectId: string;
  category: ProjectCategory;
  sector: CitizenAipProjectSector;
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

export type CitizenAipRepo = {
  listPublishedAips(): Promise<CitizenAipListRecord[]>;
  getPublishedAipDetail(aipId: string): Promise<CitizenAipDetailRecord | null>;
  getPublishedAipProjectDetail(input: {
    aipId: string;
    projectId: string;
  }): Promise<CitizenAipProjectDetailRecord | null>;
};

