import "server-only";

import { AIP_ACCOUNTABILITY_BY_ID } from "@/mocks/fixtures/aip/aip-accountability.fixture";
import { CITIZEN_AIP_COMMENTS } from "@/mocks/fixtures/aip/aip-comments.fixture";
import { AIP_PROJECT_ROWS_TABLE } from "@/mocks/fixtures/aip/aip-project-rows.table.fixture";
import { AIPS_TABLE } from "@/mocks/fixtures/aip/aips.table.fixture";
import type {
  CitizenAipAccountability,
  CitizenAipDetailRecord,
  CitizenAipListRecord,
  CitizenAipProjectDetailRecord,
  CitizenAipProjectSector,
  CitizenAipRepo,
} from "./types";

type FixtureAip = (typeof AIPS_TABLE)[number];
type FixtureProject = (typeof AIP_PROJECT_ROWS_TABLE)[number];

const MOCK_CITY_SCOPE_ID = "city-cabuyao";
const MOCK_CITY_SCOPE_LABEL = "City of Cabuyao";

function normalizeBarangayName(name: string): string {
  return name.replace(/^(brgy\.?|barangay)\s+/i, "").trim();
}

function toLguLabel(aip: FixtureAip): string {
  if (aip.scope === "barangay") {
    const baseName = normalizeBarangayName(aip.barangayName ?? "");
    return baseName ? `Brgy. ${baseName}` : "Brgy. Unknown";
  }
  return "City of Cabuyao";
}

function toScopeType(aip: FixtureAip): "city" | "barangay" {
  return aip.scope === "barangay" ? "barangay" : "city";
}

function toScopeId(aip: FixtureAip): string {
  return aip.id;
}

function toBarangayScopeId(aip: FixtureAip): string | null {
  if (aip.scope !== "barangay") return null;
  const normalized = normalizeBarangayName(aip.barangayName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized ? `brgy-${normalized}` : `brgy-${aip.id}`;
}

function toSectorLabel(value: FixtureProject["sector"]): CitizenAipProjectSector {
  if (value === "General Sector") return "General Sector";
  if (value === "Social Sector") return "Social Sector";
  if (value === "Economic Sector") return "Economic Sector";
  if (value === "Other Services") return "Other Services";
  return "Unknown";
}

function toCategory(
  kind: FixtureProject["kind"]
): CitizenAipProjectDetailRecord["category"] {
  if (kind === "health") return "health";
  if (kind === "infrastructure") return "infrastructure";
  return "other";
}

function sumBudget(projects: FixtureProject[]): number {
  return projects.reduce((sum, row) => sum + row.amount, 0);
}

function toListRecord(aip: FixtureAip): CitizenAipListRecord {
  const projects = AIP_PROJECT_ROWS_TABLE.filter((row) => row.aipId === aip.id);
  const lguLabel = toLguLabel(aip);

  return {
    id: aip.id,
    scopeType: toScopeType(aip),
    scopeId: toScopeId(aip),
    lguLabel,
    cityScopeId: MOCK_CITY_SCOPE_ID,
    cityScopeLabel: MOCK_CITY_SCOPE_LABEL,
    barangayScopeId: toBarangayScopeId(aip),
    barangayScopeLabel: aip.scope === "barangay" ? lguLabel : null,
    title: `${lguLabel} - Annual Investment Plan (AIP) ${aip.year}`,
    description:
      aip.summaryText?.slice(0, 280) ??
      `Annual Investment Plan for ${lguLabel} covering fiscal year ${aip.year}.`,
    fiscalYear: aip.year,
    publishedAt: aip.publishedAt ?? null,
    budgetTotal: projects.length ? sumBudget(projects) : aip.budget,
    projectsCount: projects.length,
  };
}

function toAccountability(aip: FixtureAip): CitizenAipAccountability {
  const fixture = AIP_ACCOUNTABILITY_BY_ID[aip.id as keyof typeof AIP_ACCOUNTABILITY_BY_ID];

  return {
    uploadedBy:
      fixture?.uploadedBy
        ? {
            id: null,
            name: fixture.uploadedBy.name,
            role: null,
            roleLabel: fixture.uploadedBy.role ?? "Official",
          }
        : aip.uploader
          ? {
              id: null,
              name: aip.uploader.name,
              role: null,
              roleLabel: aip.uploader.role,
            }
          : null,
    reviewedBy: null,
    approvedBy: fixture?.approvedBy
      ? {
          id: null,
          name: fixture.approvedBy.name,
          role: null,
          roleLabel: fixture.approvedBy.role ?? "Official",
        }
      : null,
    uploadDate: fixture?.uploadDate ?? aip.uploadedAt ?? null,
    approvalDate: fixture?.approvalDate ?? aip.publishedAt ?? null,
  };
}

function toDetailRecord(aip: FixtureAip): CitizenAipDetailRecord {
  const list = toListRecord(aip);
  const projects = AIP_PROJECT_ROWS_TABLE.filter((row) => row.aipId === aip.id);

  return {
    ...list,
    fileName: aip.fileName || `AIP_${aip.year}.pdf`,
    pdfUrl: aip.pdfUrl || null,
    summaryText: aip.summaryText || list.description,
    detailedBullets: aip.detailedBullets ?? [],
    projectRows: projects.map((row) => ({
      id: row.id,
      aipId: row.aipId,
      category: toCategory(row.kind),
      sector: toSectorLabel(row.sector),
      projectRefCode: row.projectRefCode,
      programDescription: row.aipDescription,
      totalAmount: row.amount,
      hasLguNote: Boolean(row.officialComment?.trim()),
    })),
    accountability: toAccountability(aip),
    feedbackCount: CITIZEN_AIP_COMMENTS.length,
  };
}

export function createMockCitizenAipRepo(): CitizenAipRepo {
  return {
    async listPublishedAips() {
      return [...AIPS_TABLE]
        .filter((aip) => aip.status === "published")
        .sort((left, right) => right.year - left.year)
        .map(toListRecord);
    },

    async getPublishedAipDetail(aipId) {
      const aip = AIPS_TABLE.find((row) => row.id === aipId && row.status === "published");
      if (!aip) return null;
      return toDetailRecord(aip);
    },

    async getPublishedAipProjectDetail(input) {
      const aip = AIPS_TABLE.find((row) => row.id === input.aipId && row.status === "published");
      if (!aip) return null;

      const project = AIP_PROJECT_ROWS_TABLE.find(
        (row) => row.id === input.projectId && row.aipId === input.aipId
      );
      if (!project) return null;

      return {
        aipId: input.aipId,
        projectId: project.id,
        category: toCategory(project.kind),
        sector: toSectorLabel(project.sector),
        projectRefCode: project.projectRefCode,
        title: project.aipDescription,
        description: project.aipDescription,
        implementingAgency: null,
        sourceOfFunds: null,
        expectedOutput: null,
        startDate: null,
        completionDate: null,
        totalAmount: project.amount,
        aiIssues: project.aiIssues ?? [],
      };
    },
  };
}

