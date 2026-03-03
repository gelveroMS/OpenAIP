export const CITIZEN_PROJECT_FEEDBACK_KINDS = [
  "commend",
  "suggestion",
  "concern",
  "question",
] as const;

export const PROJECT_FEEDBACK_DISPLAY_KINDS = [
  ...CITIZEN_PROJECT_FEEDBACK_KINDS,
  "lgu_note",
] as const;

export const PROJECT_FEEDBACK_MAX_LENGTH = 1000;

export type CitizenProjectFeedbackKind =
  (typeof CITIZEN_PROJECT_FEEDBACK_KINDS)[number];
export type ProjectFeedbackDisplayKind =
  (typeof PROJECT_FEEDBACK_DISPLAY_KINDS)[number];

export type ProjectFeedbackAuthorRole =
  | "citizen"
  | "barangay_official"
  | "city_official"
  | "admin";

export type ProjectFeedbackAuthor = {
  id: string | null;
  fullName: string;
  role: ProjectFeedbackAuthorRole;
  roleLabel: string;
  lguLabel: string;
};

export type ProjectFeedbackItem = {
  id: string;
  projectId: string;
  parentFeedbackId: string | null;
  kind: ProjectFeedbackDisplayKind;
  isHidden?: boolean;
  body: string;
  hiddenReason?: string | null;
  violationCategory?: string | null;
  createdAt: string;
  author: ProjectFeedbackAuthor;
};

export type ProjectFeedbackThread = {
  root: ProjectFeedbackItem;
  replies: ProjectFeedbackItem[];
};

export type ListProjectFeedbackResponse = {
  items: ProjectFeedbackItem[];
};

export type CreateProjectFeedbackPayload = {
  projectId: string;
  kind: CitizenProjectFeedbackKind;
  body: string;
};

export type CreateProjectFeedbackReplyPayload = {
  projectId: string;
  parentFeedbackId: string;
  kind: CitizenProjectFeedbackKind;
  body: string;
};

export type CreateProjectLguFeedbackReplyPayload = {
  scope: "barangay" | "city";
  projectId: string;
  parentFeedbackId: string;
  body: string;
};

export type CreateProjectFeedbackResponse = {
  item: ProjectFeedbackItem;
};

export type ProjectFeedbackApiErrorPayload = {
  error?: string;
  message?: string;
};
