import type { ISODateTime, UUID } from "../primitives";

export type NotificationPreferenceRow = {
  user_id: UUID;
  event_type: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
};
