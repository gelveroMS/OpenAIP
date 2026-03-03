import type { ISODateTime, UUID } from "../primitives";

export type ProjectUpdateStatus = "active" | "hidden";

export type ProjectUpdateRow = {
  id: UUID;
  project_id: UUID;
  aip_id: UUID;

  title: string;
  description: string;
  progress_percent: number;
  attendance_count: number | null;
  posted_by: UUID;
  status: ProjectUpdateStatus;
  hidden_reason: string | null;
  hidden_violation_category: string | null;
  hidden_at: ISODateTime | null;
  hidden_by: UUID | null;

  created_at: ISODateTime;
  updated_at: ISODateTime;
};

export type ProjectUpdateMediaRow = {
  id: UUID;
  update_id: UUID;
  project_id: UUID;

  bucket_id: string;
  object_name: string;
  mime_type: string;
  size_bytes: number | null;

  created_at: ISODateTime;
};
