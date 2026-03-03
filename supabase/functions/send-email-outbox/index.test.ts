import { assertEquals } from "jsr:@std/assert@1";
import {
  buildOutboxFailureThresholdNotifications,
  handleRequest,
  isAuthorizedRequest,
  processOutboxBatch,
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

  const summary = await processOutboxBatch({
    rows,
    now,
    maxAttempts: 5,
    resendApiKey: "resend-key",
    fromEmail: "OpenAIP <noreply@example.com>",
    appBaseUrl: "https://openaip.example.com",
    sendEmailFn: async () => ({ ok: true, error: null }),
  });

  assertEquals(summary.fetched, 1);
  assertEquals(summary.eligible, 1);
  assertEquals(summary.sent, 1);
  assertEquals(summary.failed, 0);
  assertEquals(summary.patches.length, 1);
  assertEquals(summary.patches[0].status, "sent");
  assertEquals(summary.patches[0].attempt_count, 1);
  assertEquals(summary.patches[0].last_error, null);
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
