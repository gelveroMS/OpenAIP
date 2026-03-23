const ACTION_TOKEN_ACRONYMS: Record<string, string> = {
  aip: "AIP",
  lgu: "LGU",
  api: "API",
  id: "ID",
};

function toHumanActionToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return "";
  if (ACTION_TOKEN_ACRONYMS[normalized]) {
    return ACTION_TOKEN_ACRONYMS[normalized];
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function humanizeAuditAction(action: string): string {
  const normalized = action.trim();
  if (!normalized) return "";
  const parts = normalized.split(/[_-]+/).filter((part) => part.length > 0);
  if (parts.length === 0) return "";
  return parts.map(toHumanActionToken).join(" ");
}

export function getAuditActionLabel(action: string): string {
  switch (action) {
    case "aip_created":
      return "AIP Record Created";
    case "aip_updated":
      return "AIP Record Updated";
    case "aip_deleted":
      return "AIP Record Deleted";
    case "project_record_created":
      return "Project Record Created";
    case "project_record_updated":
      return "Project Record Updated";
    case "project_record_deleted":
      return "Project Record Deleted";
    case "feedback_created":
      return "Feedback Created";
    case "feedback_updated":
      return "Feedback Updated";
    case "feedback_deleted":
      return "Feedback Deleted";
    case "draft_created":
      return "Draft Creation";
    case "submission_created":
      return "Submission";
    case "revision_uploaded":
      return "Revision Upload";
    case "cancelled":
      return "Cancellation";
    case "draft_deleted":
      return "Draft Deletion";
    case "project_updated":
      return "Project Update";
    case "project_info_updated":
      return "Project Information Update";
    case "comment_replied":
      return "Comment Reply";
    case "aip_review_record_created":
      return "AIP Review Record Created";
    case "aip_review_record_updated":
      return "AIP Review Record Updated";
    case "aip_review_record_deleted":
      return "AIP Review Record Deleted";
    case "approval_granted":
      return "Approval";
    case "revision_requested":
      return "Revision Requested";
    case "published":
      return "Publish";
    case "feedback_hidden":
      return "Feedback Hidden";
    case "feedback_unhidden":
      return "Feedback Unhidden";
    case "project_update_hidden":
      return "Project Update Hidden";
    case "project_update_unhidden":
      return "Project Update Unhidden";
    case "comment_rate_limit_updated":
      return "Comment Rate Limit Updated";
    case "chatbot_rate_limit_updated":
      return "Chatbot Rate Limit Updated";
    case "chatbot_policy_updated":
      return "Chatbot Policy Updated";
    case "user_blocked":
      return "User Blocked";
    case "user_unblocked":
      return "User Unblocked";
    case "security_settings_updated":
      return "Security Settings Updated";
    case "notification_settings_updated":
      return "Notification Settings Updated";
    case "system_banner_published":
      return "System Banner Published";
    case "system_banner_unpublished":
      return "System Banner Unpublished";
    case "account_created":
      return "Account Created";
    case "account_updated":
      return "Account Updated";
    case "account_status_changed":
      return "Account Status Changed";
    case "account_deleted":
      return "Account Deleted";
    case "account_password_reset_email_sent":
      return "Account Password Reset Email Sent";
    case "account_invite_resent":
      return "Account Invite Resent";
    default:
      return humanizeAuditAction(action);
  }
}

export function getAuditEntityLabel(entityType: string): string {
  switch (entityType) {
    case "aip":
    case "aips":
      return "AIP";
    case "project":
    case "projects":
      return "Project";
    case "feedback":
      return "Feedback";
    case "upload":
      return "Upload";
    default:
      return entityType;
  }
}

export function getAuditRoleLabel(role: string | null | undefined): string {
  switch (role) {
    case "admin":
      return "Administrator";
    case "city_official":
      return "City Official";
    case "municipal_official":
      return "Municipal Official";
    case "barangay_official":
      return "Barangay Official";
    case "citizen":
      return "Citizen";
    default:
      return "Unknown";
  }
}
