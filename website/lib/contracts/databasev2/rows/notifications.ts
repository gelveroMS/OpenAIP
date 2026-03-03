import type { Json, ISODateTime, UUID } from "../primitives";

export type NotificationScopeType = "barangay" | "city" | "citizen" | "admin";
export type NotificationEntityType = "aip" | "project" | "feedback" | "project_update" | "system";

export type NotificationRow = {
  id: UUID;
  recipient_user_id: UUID;
  recipient_role: string;
  scope_type: NotificationScopeType;
  event_type: string;
  entity_type: NotificationEntityType;
  entity_id: UUID | null;
  title: string;
  message: string;
  action_url: string | null;
  metadata: Json;
  created_at: ISODateTime;
  read_at: ISODateTime | null;
  dedupe_key: string;
};
