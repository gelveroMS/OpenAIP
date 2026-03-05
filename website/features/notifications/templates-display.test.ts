import { describe, expect, it } from "vitest";
import {
  buildDisplay,
  formatContextLine,
  formatEntityLabel,
  safeTruncate,
} from "@/lib/notifications/templates";

describe("notification display templates", () => {
  it("formats entity labels consistently", () => {
    expect(formatEntityLabel({ entity_type: "aip", fiscal_year: 2026 })).toBe("AIP FY 2026");
    expect(formatEntityLabel({ entity_type: "project", project_name: "Farm-to-Market Road" })).toBe(
      "Project: Farm-to-Market Road"
    );
    expect(formatEntityLabel({ entity_type: "project_update", update_title: "40% completed" })).toBe(
      "Update: 40% completed"
    );
    expect(formatEntityLabel({ entity_type: "feedback", target_label: "AIP FY 2026" })).toBe(
      "Feedback on AIP FY 2026"
    );
  });

  it("formats context lines for dropdown and full page", () => {
    const metadata = {
      entity_type: "aip",
      fiscal_year: 2026,
      lgu_name: "Barangay Uno",
    };
    expect(formatContextLine(metadata, "dropdown")).toBe("Barangay Uno • AIP FY 2026");
    expect(formatContextLine(metadata, "page")).toBe("Barangay Uno • AIP FY 2026");
  });

  it("distinguishes top-level feedback and reply notifications", () => {
    const topLevel = buildDisplay(
      {
        event_type: "FEEDBACK_CREATED",
        metadata: {
          entity_type: "feedback",
          target_label: "AIP FY 2026",
          lgu_name: "Barangay Uno",
          excerpt: "This is a new top-level feedback post.",
        },
        action_url: "/aips/aip-1?tab=feedback",
      },
      "dropdown"
    );

    const reply = buildDisplay(
      {
        event_type: "FEEDBACK_CREATED",
        metadata: {
          entity_type: "feedback",
          target_label: "AIP FY 2026",
          lgu_name: "Barangay Uno",
          is_reply: true,
          actor_role: "barangay_official",
          excerpt: "Thanks for the feedback, we will coordinate this update.",
        },
        action_url: "/aips/aip-1?tab=feedback&thread=fb-1&comment=fb-2",
      },
      "dropdown"
    );

    expect(topLevel.title).toBe("New feedback was posted.");
    expect(reply.title).toBe("An LGU replied to your feedback.");
    expect(reply.iconKey).toBe("corner-down-right");
  });

  it("never shows transition tokens for project update status in display copy", () => {
    const posted = buildDisplay(
      {
        event_type: "PROJECT_UPDATE_STATUS_CHANGED",
        metadata: {
          entity_type: "project_update",
          project_name: "Road Widening",
          old_status_label: "Draft",
          new_status_label: "Published",
        },
      },
      "dropdown"
    );

    expect(posted.title).toBe("A project update has been posted.");
    expect(posted.title.toLowerCase()).not.toContain("draft->published");
  });

  it("renders alert pills and excerpts for outbox and pipeline failures", () => {
    const outbox = buildDisplay(
      {
        event_type: "OUTBOX_FAILURE_THRESHOLD_REACHED",
        metadata: {
          failed_count: 24,
          threshold: 20,
          window: "Last 60 minutes",
          last_error_sample: "SMTP timeout while sending to recipient.",
        },
      },
      "page"
    );

    const pipeline = buildDisplay(
      {
        event_type: "PIPELINE_JOB_FAILED",
        metadata: {
          stage: "Embedding",
          aip_id: "12345678-1234-1234-1234-123456789abc",
          error_message: "embedding failed\nstack line 2",
        },
      },
      "page"
    );

    expect(outbox.pill).toBe("Alert");
    expect(outbox.excerpt).toContain("threshold 20");
    expect(pipeline.pill).toBe("Alert");
    expect(pipeline.excerpt).toBe("embedding failed");
  });

  it("renders extraction success and failure notifications for uploader flows", () => {
    const success = buildDisplay(
      {
        event_type: "AIP_EXTRACTION_SUCCEEDED",
        metadata: {
          entity_type: "aip",
          fiscal_year: 2026,
          lgu_name: "Barangay Uno",
          run_id: "run-success-1",
        },
      },
      "dropdown"
    );

    const failed = buildDisplay(
      {
        event_type: "AIP_EXTRACTION_FAILED",
        metadata: {
          entity_type: "aip",
          fiscal_year: 2026,
          lgu_name: "Barangay Uno",
          stage: "validate",
          error_message: "Validation timeout\nTrace details...",
        },
      },
      "page"
    );

    expect(success.title).toBe("Your AIP upload was processed successfully.");
    expect(success.iconKey).toBe("clipboard-check");
    expect(success.context).toContain("AIP FY 2026");

    expect(failed.title).toBe("AIP processing failed");
    expect(failed.iconKey).toBe("x-circle");
    expect(failed.pill).toBe("Alert");
    expect(failed.excerpt).toBe("Validation timeout");
    expect(failed.context).toContain("Barangay Uno");
  });

  it("sanitizes and truncates excerpts safely", () => {
    const value = safeTruncate("<script>alert(1)</script>" + "x".repeat(200), 40);
    expect(value).not.toContain("<script>");
    expect(value.endsWith("...")).toBe(true);
    expect(value.length).toBeLessThanOrEqual(40);
  });
});
