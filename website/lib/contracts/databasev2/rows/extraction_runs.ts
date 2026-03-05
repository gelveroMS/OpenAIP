import type { PipelineStage, PipelineStatus } from "../enums";
import type { ISODateTime, UUID } from "../primitives";

export type ExtractionRunRow = {
  id: UUID;
  aip_id: UUID;
  uploaded_file_id: UUID | null;
  retry_of_run_id: UUID | null;
  stage: PipelineStage;
  resume_from_stage: PipelineStage | null;
  status: PipelineStatus;
  model_name: string | null;
  model_version: string | null;
  temperature: number | null;
  prompt_version: string | null;
  started_at: ISODateTime | null;
  finished_at: ISODateTime | null;
  error_code: string | null;
  error_message: string | null;
  created_by: UUID | null;
  created_at: ISODateTime;
};
