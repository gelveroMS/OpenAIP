import { describe, expect, it } from "vitest";
import { getAuditActionLabel } from "./audit";
import { getAuditActionLabel as getMappedAuditActionLabel } from "@/lib/mappers/audit/mapAuditToVM";

describe("getAuditActionLabel", () => {
  it("maps newly supported visible actions", () => {
    const cases: Array<[string, string]> = [
      ["feedback_hidden", "Feedback Hidden"],
      ["feedback_unhidden", "Feedback Unhidden"],
      ["project_update_hidden", "Project Update Hidden"],
      ["project_update_unhidden", "Project Update Unhidden"],
      ["comment_rate_limit_updated", "Comment Rate Limit Updated"],
      ["chatbot_rate_limit_updated", "Chatbot Rate Limit Updated"],
      ["chatbot_policy_updated", "Chatbot Policy Updated"],
      ["user_blocked", "User Blocked"],
      ["user_unblocked", "User Unblocked"],
      ["security_settings_updated", "Security Settings Updated"],
      ["notification_settings_updated", "Notification Settings Updated"],
      ["system_banner_published", "System Banner Published"],
      ["system_banner_unpublished", "System Banner Unpublished"],
      ["account_created", "Account Created"],
      ["account_updated", "Account Updated"],
      ["account_status_changed", "Account Status Changed"],
      ["account_deleted", "Account Deleted"],
      ["account_password_reset_email_sent", "Account Password Reset Email Sent"],
      ["account_invite_resent", "Account Invite Resent"],
    ];

    cases.forEach(([action, expected]) => {
      expect(getAuditActionLabel(action)).toBe(expected);
    });
  });

  it("keeps legacy mapped labels unchanged", () => {
    expect(getAuditActionLabel("draft_created")).toBe("Draft Creation");
    expect(getAuditActionLabel("project_info_updated")).toBe("Project Information Update");
    expect(getAuditActionLabel("aip_review_record_created")).toBe(
      "AIP Review Record Created"
    );
    expect(getAuditActionLabel("published")).toBe("Publish");
  });

  it("humanizes unknown actions and preserves acronym tokens", () => {
    expect(getAuditActionLabel("feedback_flagged_for_api_review")).toBe(
      "Feedback Flagged For API Review"
    );
    expect(getAuditActionLabel("sync-lgu-aip-id")).toBe("Sync LGU AIP ID");
  });

  it("stays in sync with mapAuditToVM action labels", () => {
    const actions = [
      "draft_created",
      "feedback_hidden",
      "project_update_hidden",
      "comment_rate_limit_updated",
      "account_password_reset_email_sent",
      "sync-lgu-aip-id",
      "feedback_flagged_for_api_review",
    ];

    actions.forEach((action) => {
      expect(getMappedAuditActionLabel(action)).toBe(getAuditActionLabel(action));
    });
  });
});
