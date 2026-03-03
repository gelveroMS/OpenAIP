import type { ISODateTime, UUID } from "../primitives";

export type ChatRateEventStatus =
  | "accepted"
  | "rejected_minute"
  | "rejected_hour"
  | "rejected_day";

export type ChatRateEventRow = {
  id: UUID;
  user_id: UUID;
  route: string;
  event_status: ChatRateEventStatus;
  created_at: ISODateTime;
};
