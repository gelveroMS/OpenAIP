import type { AipScopeRef, ISODateTime, Json, RoleType, UUID } from "@/lib/contracts/databasev2";

export type ActivityLogEntityType =
  | "aip"
  | "project"
  | "feedback"
  | "upload"
  | (string & {});

export type ActivityLogAction =
  | "aip_created"
  | "aip_updated"
  | "aip_deleted"
  | "project_record_created"
  | "project_record_updated"
  | "project_record_deleted"
  | "feedback_created"
  | "feedback_updated"
  | "feedback_deleted"
  | "draft_created"
  | "submission_created"
  | "revision_uploaded"
  | "cancelled"
  | "draft_deleted"
  | "project_updated"
  | "project_info_updated"
  | "comment_replied"
  | "aip_review_record_created"
  | "aip_review_record_updated"
  | "aip_review_record_deleted"
  | "approval_granted"
  | "revision_requested"
  | "published"
  | (string & {});

export type ActivityScopeSnapshot =
  | {
      scope_type: "none";
      barangay_id: null;
      city_id: null;
      municipality_id: null;
    }
  | AipScopeRef;

export type ActivityLogRow = {
  id: UUID;
  actorId: UUID;
  action: ActivityLogAction;
  entityType: ActivityLogEntityType;
  entityId: UUID;
  scope?: ActivityScopeSnapshot | null;
  metadata?: Json | null;
  actorRole?: RoleType | null;
  createdAt: ISODateTime;
};

export type AuditRoleFilter = "all" | "admin" | "citizen" | "lgu_officials";

export type AuditListInput = {
  page: number;
  pageSize: number;
  role: AuditRoleFilter;
  year: "all" | number;
  event: "all" | string;
  q: string;
};

export type AuditListResult = {
  rows: ActivityLogRow[];
  total: number;
  page: number;
  pageSize: number;
};

