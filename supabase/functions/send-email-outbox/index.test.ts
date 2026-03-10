import { assertEquals } from "jsr:@std/assert@1";
import {
  buildOutboxFailureThresholdNotifications,
  handleRequest,
  isAuthorizedRequest,
  processOutboxBatch,
  renderTemplateHtml,
  renderTemplateText,
  type OutboxRow,
} from "./index.ts";

function encodeBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = encodeBase64Url(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

function makeQueuedRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: "row-1",
    recipient_user_id: "user-1",
    to_email: "citizen@example.com",
    template_key: "AIP_PUBLISHED",
    subject: "OpenAIP update",
    payload: {
      title: "AIP Published",
      message: "AIP has been published.",
      action_url: "/notifications",
    },
    status: "queued",
    attempt_count: 0,
    last_error: null,
    created_at: "2026-03-03T00:00:00.000Z",
    sent_at: null,
    dedupe_key: "AIP_PUBLISHED:aip:123:draft->published",
    ...overrides,
  };
}

Deno.test("isAuthorizedRequest accepts bearer jwt with service_role claim", () => {
  const serviceToken = makeJwt({ role: "service_role", sub: "svc" });
  const request = new Request("http://localhost/functions/v1/send-email-outbox", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceToken}`,
    },
  });

  assertEquals(isAuthorizedRequest(request), true);
});

Deno.test("isAuthorizedRequest rejects jwt without service_role claim", () => {
  const anonToken = makeJwt({ role: "authenticated", sub: "user-1" });
  const request = new Request("http://localhost/functions/v1/send-email-outbox", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${anonToken}`,
    },
  });

  assertEquals(isAuthorizedRequest(request), false);
});

Deno.test("handleRequest rejects non-service-role authorization", async () => {
  const badToken = makeJwt({ role: "authenticated", sub: "user-1" });
  const request = new Request("http://localhost/functions/v1/send-email-outbox", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${badToken}`,
    },
    body: JSON.stringify({}),
  });

  const response = await handleRequest(request);
  assertEquals(response.status, 401);
});

Deno.test("processOutboxBatch marks successful sends as sent", async () => {
  const now = new Date("2026-03-03T01:00:00.000Z");
  const rows = [makeQueuedRow()];
  let sentText: string | null = null;
  let sentHtml: string | null = null;

  const summary = await processOutboxBatch({
    rows,
    now,
    maxAttempts: 5,
    resendApiKey: "resend-key",
    fromEmail: "OpenAIP <noreply@example.com>",
    appBaseUrl: "https://openaip.example.com",
    sendEmailFn: async (args) => {
      sentHtml = args.html;
      sentText = args.text;
      return { ok: true, error: null };
    },
  });

  assertEquals(summary.fetched, 1);
  assertEquals(summary.eligible, 1);
  assertEquals(summary.sent, 1);
  assertEquals(summary.failed, 0);
  assertEquals(summary.patches.length, 1);
  assertEquals(summary.patches[0].status, "sent");
  assertEquals(summary.patches[0].attempt_count, 1);
  assertEquals(summary.patches[0].last_error, null);
  assertEquals(typeof sentHtml === "string" && sentHtml.length > 0, true);
  assertEquals(typeof sentText === "string" && sentText.length > 0, true);
});

Deno.test("processOutboxBatch increments attempts and marks failed at max attempts", async () => {
  const now = new Date("2026-03-03T01:00:00.000Z");
  const rows = [
    makeQueuedRow({ id: "row-retry", attempt_count: 1, created_at: "2026-03-03T00:00:00.000Z" }),
    makeQueuedRow({ id: "row-fail", attempt_count: 4, created_at: "2026-03-03T00:00:00.000Z" }),
  ];

  const summary = await processOutboxBatch({
    rows,
    now,
    maxAttempts: 5,
    resendApiKey: "resend-key",
    fromEmail: "OpenAIP <noreply@example.com>",
    appBaseUrl: "https://openaip.example.com",
    sendEmailFn: async () => ({ ok: false, error: "SMTP timeout" }),
  });

  assertEquals(summary.sent, 0);
  assertEquals(summary.failed, 2);
  assertEquals(summary.queuedForRetry, 1);
  assertEquals(summary.patches.find((patch) => patch.id === "row-retry")?.status, "queued");
  assertEquals(summary.patches.find((patch) => patch.id === "row-retry")?.attempt_count, 2);
  assertEquals(summary.patches.find((patch) => patch.id === "row-fail")?.status, "failed");
  assertEquals(summary.patches.find((patch) => patch.id === "row-fail")?.attempt_count, 5);
});

Deno.test("buildOutboxFailureThresholdNotifications builds deduped hourly admin alerts", () => {
  const now = new Date("2026-03-03T05:10:00.000Z");
  const notifications = buildOutboxFailureThresholdNotifications({
    adminRecipients: [
      { id: "admin-1", role: "admin" },
      { id: "admin-2", role: "admin" },
    ],
    failedCountLastHour: 31,
    threshold: 20,
    now,
  });

  assertEquals(notifications.length, 2);
  assertEquals(
    notifications[0].dedupe_key,
    "OUTBOX_FAILURE_THRESHOLD_REACHED:system:outbox_failures:2026-03-03T05"
  );
  assertEquals(notifications[0].event_type, "OUTBOX_FAILURE_THRESHOLD_REACHED");
  assertEquals(notifications[1].dedupe_key, notifications[0].dedupe_key);
});

Deno.test("renderTemplateHtml wraps internal action links with tracked-open route", () => {
  const html = renderTemplateHtml(
    "AIP_PUBLISHED",
    "AIP Published",
    {
      title: "AIP Published",
      message: "AIP has been published.",
      action_url: "/aips/aip-1",
      notification_ref: "AIP_PUBLISHED:aip:aip-1:draft->published",
    },
    "https://openaip.example.com"
  );

  assertEquals(
    html.includes(
      "/api/notifications/open?dedupe=AIP_PUBLISHED%3Aaip%3Aaip-1%3Adraft-%3Epublished&next=%2Faips%2Faip-1"
    ),
    true
  );
});

Deno.test("renderTemplateHtml uses OTP-inspired structure and event/context sections", () => {
  const html = renderTemplateHtml(
    "feedback_visibility_changed",
    "Feedback visibility changed",
    {
      title: "Feedback moderation update",
      message: "A moderation update was recorded.",
      event_type: "FEEDBACK_VISIBILITY_CHANGED",
      scope_type: "city",
      entity_type: "feedback",
      visibility_action: "hidden",
      moderation_reason: "Policy violation",
      action_url: "/city/feedback?comment=fb-1",
    },
    "https://openaip.example.com"
  );

  assertEquals(html.includes("Moderation Update"), true);
  assertEquals(html.includes("Feedback moderation update"), true);
  assertEquals(html.includes("DETAILS"), true);
  assertEquals(html.includes("Status: <strong>Hidden</strong>"), true);
  assertEquals(html.includes("Reason: <strong>Policy violation</strong>"), true);
  assertEquals(html.includes("View feedback"), true);
  assertEquals(html.includes("This is an automated message from OpenAIP."), true);
});

Deno.test("renderTemplateHtml omits transition and reason rows when not present", () => {
  const html = renderTemplateHtml(
    "AIP_PUBLISHED",
    "AIP Published",
    {
      title: "AIP Published",
      message: "An AIP was published.",
      event_type: "AIP_PUBLISHED",
      scope_type: "barangay",
      entity_type: "aip",
    },
    "https://openaip.example.com"
  );

  assertEquals(html.includes("DETAILS"), true);
  assertEquals(html.includes("Old status"), false);
  assertEquals(html.includes("Reason"), false);
});

Deno.test("renderTemplateText returns deterministic plain text fallback", () => {
  const text = renderTemplateText(
    "AIP_PUBLISHED",
    "AIP Published",
    {
      title: "AIP Published",
      message: "An AIP was published.",
      event_type: "AIP_PUBLISHED",
      scope_type: "citizen",
      entity_type: "aip",
      action_url: "/aips/aip-1",
      notification_ref: "AIP_PUBLISHED:aip:aip-1:draft->published",
    },
    "https://openaip.example.com"
  );

  assertEquals(text.includes("OpenAIP - Publication Notice"), true);
  assertEquals(text.includes("AIP Published"), true);
  assertEquals(text.includes("DETAILS"), true);
  assertEquals(text.includes("View Published AIP: https://openaip.example.com/api/notifications/open?"), true);
  assertEquals(text.includes("<div"), false);
});

Deno.test("renderTemplateHtml supports event-specific headings", () => {
  const events: Array<{ key: string; expectedHeading: string; expectedSubtitle: string }> = [
    { key: "AIP_CLAIMED", expectedHeading: "AIP Claimed for Review", expectedSubtitle: "AIP Review Update" },
    { key: "AIP_REVISION_REQUESTED", expectedHeading: "Revision Requested", expectedSubtitle: "AIP Revision Request" },
    { key: "AIP_PUBLISHED", expectedHeading: "AIP Published", expectedSubtitle: "Publication Notice" },
    { key: "AIP_SUBMITTED", expectedHeading: "AIP Submitted for Review", expectedSubtitle: "City Review Queue" },
    { key: "AIP_RESUBMITTED", expectedHeading: "AIP Resubmitted", expectedSubtitle: "City Review Queue" },
    {
      key: "aip_extraction_succeeded",
      expectedHeading: "AIP processing completed",
      expectedSubtitle: "AIP Processing",
    },
    {
      key: "aip_extraction_failed",
      expectedHeading: "AIP processing failed",
      expectedSubtitle: "AIP Processing",
    },
    {
      key: "aip_embed_succeeded",
      expectedHeading: "AIP embedding completed",
      expectedSubtitle: "AIP Search Indexing",
    },
    {
      key: "aip_embed_failed",
      expectedHeading: "AIP embedding failed",
      expectedSubtitle: "AIP Search Indexing",
    },
    { key: "FEEDBACK_CREATED", expectedHeading: "New feedback posted", expectedSubtitle: "Citizen Engagement" },
    { key: "feedback_reply", expectedHeading: "New reply in feedback thread", expectedSubtitle: "Citizen Engagement" },
    {
      key: "FEEDBACK_VISIBILITY_CHANGED",
      expectedHeading: "Feedback moderation update",
      expectedSubtitle: "Moderation Update",
    },
    {
      key: "PROJECT_UPDATE_STATUS_CHANGED",
      expectedHeading: "A project update has been posted",
      expectedSubtitle: "Project Updates",
    },
    {
      key: "OUTBOX_FAILURE_THRESHOLD_REACHED",
      expectedHeading: "Email Outbox Failure Threshold Reached",
      expectedSubtitle: "System Alert",
    },
    { key: "MODERATION_ACTION_AUDIT", expectedHeading: "Moderation Action Audit", expectedSubtitle: "Audit Log" },
    { key: "PIPELINE_JOB_FAILED", expectedHeading: "Pipeline Job Failed", expectedSubtitle: "Pipeline Alert" },
  ];

  for (const entry of events) {
    const html = renderTemplateHtml(
      entry.key,
      "OpenAIP update",
      {
        title: "OpenAIP update",
        message: "Message",
        event_type: entry.key,
        action_url: "/notifications",
      },
      "https://openaip.example.com"
    );

    assertEquals(html.includes(entry.expectedHeading), true);
    assertEquals(html.includes(entry.expectedSubtitle), true);
  }
});

Deno.test("renderTemplateHtml resolves FEEDBACK_CREATED reply variant from is_reply metadata", () => {
  const html = renderTemplateHtml(
    "FEEDBACK_CREATED",
    "Feedback update",
    {
      event_type: "FEEDBACK_CREATED",
      metadata: {
        is_reply: true,
      },
      reply_excerpt: "We have noted your concern and will update the timeline.",
      target_label: "Project: Street Lighting",
      action_url: "/projects/infrastructure/proj-1?tab=feedback&thread=fb-1&comment=fb-2",
    },
    "https://openaip.example.com"
  );

  assertEquals(html.includes("New reply in feedback thread"), true);
  assertEquals(html.includes("Open reply"), true);
  assertEquals(html.includes("New feedback posted"), false);
});

Deno.test("renderTemplateHtml renders project update removed and restored variants", () => {
  const removedHtml = renderTemplateHtml(
    "project_update_posted",
    "Project update status",
    {
      event_type: "PROJECT_UPDATE_STATUS_CHANGED",
      visibility_action: "hidden",
      project_name: "Street Lighting",
      action_url: "/projects/infrastructure/proj-1?tab=updates",
    },
    "https://openaip.example.com"
  );

  const restoredHtml = renderTemplateHtml(
    "project_update_posted",
    "Project update status",
    {
      event_type: "PROJECT_UPDATE_STATUS_CHANGED",
      visibility_action: "unhidden",
      project_name: "Street Lighting",
      action_url: "/projects/infrastructure/proj-1?tab=updates",
    },
    "https://openaip.example.com"
  );

  assertEquals(removedHtml.includes("A project update was removed from public view"), true);
  assertEquals(restoredHtml.includes("A project update is visible again"), true);
});

Deno.test("renderTemplateHtml project update templates never render draft wording", () => {
  const html = renderTemplateHtml(
    "project_update_posted",
    "Project update posted",
    {
      event_type: "PROJECT_UPDATE_STATUS_CHANGED",
      transition: "draft->published",
      project_name: "Street Lighting",
      update_title: "Streetlight poles installed",
      action_url: "/projects/infrastructure/proj-1?tab=updates",
    },
    "https://openaip.example.com"
  );

  assertEquals(html.toLowerCase().includes("draft"), false);
});

Deno.test("renderTemplateHtml renders uploader extraction success and failure templates", () => {
  const successHtml = renderTemplateHtml(
    "aip_extraction_succeeded",
    "AIP processing completed",
    {
      event_type: "AIP_EXTRACTION_SUCCEEDED",
      entity_label: "AIP FY 2026",
      lgu_name: "Barangay Uno",
      run_id: "run-001",
      stage: "categorize",
      occurred_at: "2026-03-06T01:00:00.000Z",
      action_url: "/barangay/aips/aip-1?run=run-001",
      notification_ref: "AIP_EXTRACTION_SUCCEEDED:aip:aip-1:run:run-001:status->succeeded",
    },
    "https://openaip.example.com"
  );

  const failedHtml = renderTemplateHtml(
    "aip_extraction_failed",
    "AIP processing failed",
    {
      event_type: "AIP_EXTRACTION_FAILED",
      entity_label: "AIP FY 2026",
      lgu_name: "Barangay Uno",
      run_id: "run-002",
      stage: "validate",
      error_code: "PARSE_TIMEOUT",
      error_message: "Validation timed out while parsing totals.",
      occurred_at: "2026-03-06T01:10:00.000Z",
      action_url: "/barangay/aips/aip-1?run=run-002",
      notification_ref: "AIP_EXTRACTION_FAILED:aip:aip-1:run:run-002:status->failed",
    },
    "https://openaip.example.com"
  );

  assertEquals(successHtml.includes("AIP processing completed"), true);
  assertEquals(successHtml.includes("Open AIP"), true);
  assertEquals(successHtml.includes("Run ID: <strong>run-001</strong>"), false);
  assertEquals(successHtml.includes("Stage: <strong>categorize</strong>"), false);
  assertEquals(successHtml.includes("/api/notifications/open?dedupe="), true);

  assertEquals(failedHtml.includes("AIP processing failed"), true);
  assertEquals(failedHtml.includes("Review failed run"), true);
  assertEquals(failedHtml.includes("Error code: <strong>PARSE_TIMEOUT</strong>"), true);
  assertEquals(
    failedHtml.includes("Error message: <strong>Validation timed out while parsing totals.</strong>"),
    true
  );
});

Deno.test("renderTemplateHtml renders uploader embed success and failure templates", () => {
  const successHtml = renderTemplateHtml(
    "aip_embed_succeeded",
    "AIP embedding completed",
    {
      event_type: "AIP_EMBED_SUCCEEDED",
      entity_label: "AIP FY 2026",
      lgu_name: "Barangay Uno",
      run_id: "run-embed-001",
      stage: "embed",
      occurred_at: "2026-03-10T01:00:00.000Z",
      action_url: "/barangay/aips/aip-1",
      notification_ref: "AIP_EMBED_SUCCEEDED:aip:aip-1:run:run-embed-001:status->succeeded",
    },
    "https://openaip.example.com"
  );

  const failedHtml = renderTemplateHtml(
    "aip_embed_failed",
    "AIP embedding failed",
    {
      event_type: "AIP_EMBED_FAILED",
      entity_label: "AIP FY 2026",
      lgu_name: "Barangay Uno",
      run_id: "run-embed-002",
      stage: "embed",
      error_code: "EMBED_TIMEOUT",
      error_message: "Embedding provider timeout while indexing chunks.",
      occurred_at: "2026-03-10T01:10:00.000Z",
      action_url: "/barangay/aips/aip-1",
      notification_ref: "AIP_EMBED_FAILED:aip:aip-1:run:run-embed-002:status->failed",
    },
    "https://openaip.example.com"
  );

  assertEquals(successHtml.includes("AIP embedding completed"), true);
  assertEquals(successHtml.includes("Open AIP"), true);
  assertEquals(successHtml.includes("Run ID: <strong>run-embed-001</strong>"), false);
  assertEquals(successHtml.includes("Stage: <strong>embed</strong>"), false);
  assertEquals(successHtml.includes("/api/notifications/open?dedupe="), true);

  assertEquals(failedHtml.includes("AIP embedding failed"), true);
  assertEquals(failedHtml.includes("Review failed indexing run"), true);
  assertEquals(failedHtml.includes("Run ID: <strong>run-embed-002</strong>"), false);
  assertEquals(failedHtml.includes("Failed stage: <strong>embed</strong>"), false);
  assertEquals(failedHtml.includes("Error code: <strong>EMBED_TIMEOUT</strong>"), true);
  assertEquals(
    failedHtml.includes("Error message: <strong>Embedding provider timeout while indexing chunks.</strong>"),
    true
  );
});

Deno.test("renderTemplateHtml resolves uppercase extraction template keys", () => {
  const successHtml = renderTemplateHtml(
    "AIP_EXTRACTION_SUCCEEDED",
    "AIP processing completed",
    {
      event_type: "AIP_EXTRACTION_SUCCEEDED",
      entity_label: "AIP FY 2026",
      lgu_name: "City of Sample",
      run_id: "run-010",
      action_url: "/city/aips/aip-10?run=run-010",
    },
    "https://openaip.example.com"
  );

  const failedHtml = renderTemplateHtml(
    "AIP_EXTRACTION_FAILED",
    "AIP processing failed",
    {
      event_type: "AIP_EXTRACTION_FAILED",
      entity_label: "AIP FY 2026",
      run_id: "run-011",
      error_message: "Failed to parse document",
      action_url: "/city/aips/aip-10?run=run-011",
    },
    "https://openaip.example.com"
  );

  assertEquals(successHtml.includes("AIP processing completed"), true);
  assertEquals(failedHtml.includes("AIP processing failed"), true);
});

Deno.test("renderTemplateHtml resolves uppercase embed template keys", () => {
  const successHtml = renderTemplateHtml(
    "AIP_EMBED_SUCCEEDED",
    "AIP embedding completed",
    {
      event_type: "AIP_EMBED_SUCCEEDED",
      entity_label: "AIP FY 2026",
      lgu_name: "City of Sample",
      run_id: "run-embed-010",
      action_url: "/city/aips/aip-10",
    },
    "https://openaip.example.com"
  );

  const failedHtml = renderTemplateHtml(
    "AIP_EMBED_FAILED",
    "AIP embedding failed",
    {
      event_type: "AIP_EMBED_FAILED",
      entity_label: "AIP FY 2026",
      run_id: "run-embed-011",
      error_message: "Embedding request failed",
      action_url: "/city/aips/aip-10",
    },
    "https://openaip.example.com"
  );

  assertEquals(successHtml.includes("AIP embedding completed"), true);
  assertEquals(failedHtml.includes("AIP embedding failed"), true);
});
