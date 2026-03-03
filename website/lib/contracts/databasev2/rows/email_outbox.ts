import type { Json, ISODateTime, UUID } from "../primitives";

export type EmailOutboxStatus = "queued" | "sent" | "failed";

export type EmailOutboxRow = {
  id: UUID;
  recipient_user_id: UUID | null;
  to_email: string;
  template_key: string;
  subject: string;
  payload: Json;
  status: EmailOutboxStatus;
  attempt_count: number;
  last_error: string | null;
  created_at: ISODateTime;
  sent_at: ISODateTime | null;
  dedupe_key: string;
};
