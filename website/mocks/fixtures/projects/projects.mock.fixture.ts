import { HEALTH_DETAILS_TABLE } from "@/mocks/fixtures/projects/health-details-table.fixture";
import { INFRA_DETAILS_TABLE } from "@/mocks/fixtures/projects/infrastructure-details-table.fixture";
import { PROJECTS_TABLE } from "@/mocks/fixtures/projects/projects-table.fixture";
import { AIP_IDS } from "@/mocks/fixtures/shared/id-contract.fixture";
import type { Json } from "@/lib/contracts/databasev2/primitives";

export type ProjectRowDTO = {
  id: string;
  aip_id: string;
  extraction_artifact_id: string | null;
  project_key: string;
  aip_ref_code: string | null;
  program_project_description: string;
  implementing_agency: string | null;
  start_date: string | null;
  completion_date: string | null;
  expected_output: string | null;
  source_of_funds: string | null;
  personal_services: number | null;
  maintenance_and_other_operating_expenses: number | null;
  capital_outlay: number | null;
  total: number | null;
  climate_change_adaptation: string | null;
  climate_change_mitigation: string | null;
  cc_topology_code: string | null;
  prm_ncr_lgu_rm_objective_results_indicator: string | null;
  errors: Json | null;
  category: "health" | "infrastructure" | "other";
  sector_code: string | null;
  is_human_edited: boolean;
  edited_by: string | null;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
  // Mock-only UI fields (not persisted in DBV2).
  status?: "proposed" | "ongoing" | "completed" | "on_hold" | null;
  image_url?: string | null;
};

export type HealthProjectDetailsRowDTO = {
  project_id: string;
  program_name: string;
  description: string | null;
  target_participants: string | null;
  total_target_participants: number | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
};

export type InfrastructureProjectDetailsRowDTO = {
  project_id: string;
  project_name: string;
  contractor_name: string | null;
  contract_cost: number | null;
  start_date: string | null;
  target_completion_date: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
};

const now = new Date().toISOString();

const healthByRef = new Map(
  HEALTH_DETAILS_TABLE.map((detail) => [detail.projectRefCode, detail])
);
const infraByRef = new Map(
  INFRA_DETAILS_TABLE.map((detail) => [detail.projectRefCode, detail])
);

const BARANGAY_AIP_IDS_2026 = [
  AIP_IDS.barangay_mamadid_2026,
  AIP_IDS.barangay_poblacion_2026,
  AIP_IDS.barangay_santamaria_2026,
  AIP_IDS.barangay_sanisidro_2026,
];

function resolveMockProjectAipId(projectYear: number, projectIndex: number): string {
  if (projectYear === 2025) return AIP_IDS.barangay_mamadid_2025;
  if (projectYear === 2024) return AIP_IDS.barangay_poblacion_2026;
  return BARANGAY_AIP_IDS_2026[projectIndex % BARANGAY_AIP_IDS_2026.length] ?? AIP_IDS.barangay_mamadid_2026;
}

export const MOCK_PROJECTS_ROWS: ProjectRowDTO[] = [
  ...PROJECTS_TABLE.map((project, index) => {
    const health = healthByRef.get(project.projectRefCode) ?? null;
    const infra = infraByRef.get(project.projectRefCode) ?? null;
    const startDate =
      project.kind === "infrastructure" && infra
        ? infra.startDate
        : `${project.year}-01-01`;
    const completionDate =
      project.kind === "infrastructure" && infra ? infra.targetCompletionDate : null;
    const implementingAgency =
      project.kind === "health"
        ? health?.implementingOffice ?? null
        : infra?.implementingOffice ?? null;
    const sourceOfFunds =
      project.kind === "infrastructure" ? infra?.fundingSource ?? null : null;
    const totalBudget =
      project.kind === "health"
        ? health?.budgetAllocated ?? null
        : infra?.contractCost ?? null;

    const expectedOutput = (() => {
      if (project.kind === "health") {
        return `Program overview: ${project.title}. This initiative is designed to improve community health outcomes through targeted services and outreach.`;
      }
      if (project.kind === "infrastructure") {
        return `Project overview: ${project.title}. This project focuses on improving public infrastructure to enhance safety, access, and community services.`;
      }
      return `Overview: ${project.title}.`;
    })();

    return {
      id: project.projectRefCode,
      aip_id: resolveMockProjectAipId(project.year, index),
      extraction_artifact_id: null,
      project_key: project.projectRefCode,
      aip_ref_code: project.projectRefCode,
      program_project_description: project.title,
      implementing_agency: implementingAgency,
      start_date: startDate,
      completion_date: completionDate,
      expected_output: expectedOutput,
      source_of_funds: sourceOfFunds,
      personal_services: null,
      maintenance_and_other_operating_expenses: null,
      capital_outlay: null,
      total: totalBudget,
      climate_change_adaptation: null,
      climate_change_mitigation: null,
      cc_topology_code: null,
      prm_ncr_lgu_rm_objective_results_indicator: null,
      errors: null,
      category: project.kind,
      sector_code: project.projectRefCode.slice(0, 4),
      is_human_edited: false,
      edited_by: null,
      edited_at: null,
      created_at: now,
      updated_at: now,
      status: project.status,
      image_url: project.imageUrl ?? null,
    };
  }),
  {
    id: "PROJ-O-2026-001",
    aip_id: AIP_IDS.barangay_santamaria_2026,
    extraction_artifact_id: null,
    project_key: "PROJ-O-2026-001",
    aip_ref_code: "PROJ-O-2026-001",
    program_project_description: "Other Community Initiative",
    implementing_agency: null,
    start_date: "2026-01-01",
    completion_date: null,
    expected_output: null,
    source_of_funds: null,
    personal_services: null,
    maintenance_and_other_operating_expenses: null,
    capital_outlay: null,
    total: 0,
    climate_change_adaptation: null,
    climate_change_mitigation: null,
    cc_topology_code: null,
    prm_ncr_lgu_rm_objective_results_indicator: null,
    errors: null,
    category: "other",
    sector_code: "PROJ",
    is_human_edited: false,
    edited_by: null,
    edited_at: null,
    created_at: now,
    updated_at: now,
    status: "proposed",
    image_url: null,
  },
];

export const MOCK_HEALTH_DETAILS_ROWS: HealthProjectDetailsRowDTO[] =
  HEALTH_DETAILS_TABLE.map((detail) => ({
    project_id: detail.projectRefCode,
    program_name: detail.month,
    description: `Detailed description for ${detail.projectRefCode}: This program outlines key activities, target coverage, and expected health benefits for the community.`,
    target_participants: detail.targetParticipants,
    total_target_participants: detail.totalTargetParticipants,
    updated_by: null,
    updated_at: now,
    created_at: now,
  }));

export const MOCK_INFRA_DETAILS_ROWS: InfrastructureProjectDetailsRowDTO[] =
  INFRA_DETAILS_TABLE.map((detail) => ({
    project_id: detail.projectRefCode,
    project_name: detail.projectRefCode,
    contractor_name: detail.contractorName,
    contract_cost: detail.contractCost,
    start_date: detail.startDate,
    target_completion_date: detail.targetCompletionDate,
    updated_by: null,
    updated_at: now,
    created_at: now,
  }));
