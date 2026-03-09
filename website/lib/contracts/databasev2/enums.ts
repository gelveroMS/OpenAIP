/**
 * Mirrors: public.role_type enum
 */
export type RoleType =
  | "citizen"
  | "barangay_official"
  | "city_official"
  | "municipal_official"
  | "admin";

/**
 * Mirrors: public.aip_status enum
 */
export type AipStatus =
  | "draft"
  | "pending_review"
  | "under_review"
  | "for_revision"
  | "published";

/**
 * Mirrors: public.review_action enum
 */
export type ReviewAction = "approve" | "request_revision" | "claim_review";

/**
 * Mirrors: public.feedback_target_type enum
 */
export type FeedbackTargetType = "aip" | "project";

/**
 * Mirrors: public.feedback_source enum
 */
export type FeedbackSource = "human" | "ai";

/**
 * Mirrors: public.feedback_kind enum
 */
export type FeedbackKind =
  | "question"
  | "suggestion"
  | "concern"
  | "lgu_note"
  | "ai_finding"
  | "commend";

/**
 * chat_messages.role is constrained by a check:
 * role in ('user','assistant','system')
 */
export type ChatMessageRole = "user" | "assistant" | "system";

/**
 * Mirrors: public.project_category enum
 */
export type ProjectCategory = "health" | "infrastructure" | "other";

/**
 * Mirrors: public.pipeline_stage enum
 */
export type PipelineStage =
  | "extract"
  | "validate"
  | "scale_amounts"
  | "summarize"
  | "categorize"
  | "embed";

/**
 * Mirrors: public.pipeline_status enum
 */
export type PipelineStatus = "queued" | "running" | "succeeded" | "failed";
