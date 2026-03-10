import type { ProjectCategory } from "../enums";
import type { ISODateTime, Json, UUID } from "../primitives";

export type ProjectRow = {
  id: UUID;
  aip_id: UUID;

  extraction_artifact_id: UUID | null;

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
  financial_expenses?: number | null;
  capital_outlay: number | null;
  total: number | null;

  climate_change_adaptation: string | null;
  climate_change_mitigation: string | null;
  cc_topology_code: string | null;
  prm_ncr_lgu_rm_objective_results_indicator: string | null;

  errors: Json | null;

  category: ProjectCategory;

  status?: "proposed" | "ongoing" | "completed" | "on_hold" | null;
  image_url?: string | null;

  sector_code: string | null;

  is_human_edited: boolean;
  edited_by: UUID | null;
  edited_at: ISODateTime | null;

  created_at: ISODateTime;
  updated_at: ISODateTime;
};

export type HealthProjectDetailsRow = {
  project_id: UUID;
  program_name: string;
  description: string | null;
  target_participants: string | null;
  total_target_participants: number | null;

  updated_by: UUID | null;
  updated_at: ISODateTime;
  created_at: ISODateTime;
};

export type InfrastructureProjectDetailsRow = {
  project_id: UUID;
  project_name: string;
  contractor_name: string | null;
  contract_cost: number | null;

  /**
   * Stored as DATE in DB, serialized as YYYY-MM-DD string.
   */
  start_date: string | null;
  target_completion_date: string | null;

  updated_by: UUID | null;
  updated_at: ISODateTime;
  created_at: ISODateTime;
};

