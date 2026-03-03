import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.90.1";

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_FAILURE_THRESHOLD = 20;
const DEFAULT_BACKOFF_MINUTES = [0, 5, 15, 30, 60] as const;
const RESEND_EMAILS_URL = "https://api.resend.com/emails";

type OutboxStatus = "queued" | "sent" | "failed";

export type OutboxRow = {
  id: string;
  recipient_user_id: string | null;
  to_email: string;
  template_key: string;
  subject: string;
  payload: unknown;
  status: OutboxStatus;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  dedupe_key: string;
};

type OutboxPatch = {
  id: string;
  status: OutboxStatus;
  attempt_count: number;
  last_error: string | null;
  sent_at: string | null;
};

type ProcessBatchSummary = {
  fetched: number;
  eligible: number;
  sent: number;
  failed: number;
  queuedForRetry: number;
  skippedBackoff: number;
  patches: OutboxPatch[];
};

type SendEmailArgs = {
  toEmail: string;
  subject: string;
  html: string;
  resendApiKey: string;
  fromEmail: string;
};

type SendEmailResult = {
  ok: boolean;
  error: string | null;
};

type AdminRecipient = {
  id: string;
  role: string;
};

type OutboxThresholdNotificationRow = {
  recipient_user_id: string;
  recipient_role: string;
  scope_type: "admin";
  event_type: "OUTBOX_FAILURE_THRESHOLD_REACHED";
  entity_type: "system";
  entity_id: null;
  title: string;
  message: string;
  action_url: string;
  metadata: Record<string, unknown>;
  dedupe_key: string;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function nowIso(input: Date = new Date()): string {
  return input.toISOString();
}

export function toHourBucket(input: Date = new Date()): string {
  return input.toISOString().slice(0, 13);
}

function readPositiveInt(value: string | null, fallback: number, max?: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  if (typeof max === "number") return Math.min(max, parsed);
  return parsed;
}

function readPositiveIntEnv(name: string, fallback: number, max?: number): number {
  return readPositiveInt(Deno.env.get(name) ?? null, fallback, max);
}

function parseBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.trim().split(/\s+/, 2);
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const payloadPart = parts[1];
  if (!payloadPart) return null;

  const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);

  try {
    const decoded = atob(padded);
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isAuthorizedRequest(request: Request): boolean {
  const token = parseBearerToken(request);
  if (!token) return false;

  const payload = decodeJwtPayload(token);
  if (!payload) return false;

  return payload.role === "service_role";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveActionUrl(payload: Record<string, unknown>, appBaseUrl: string): string | null {
  const actionUrl = readString(payload.action_url) ?? readString(payload.actionUrl);
  if (!actionUrl) return null;
  if (actionUrl.startsWith("http://") || actionUrl.startsWith("https://")) {
    return actionUrl;
  }
  const normalizedBase = appBaseUrl.replace(/\/+$/, "");
  const normalizedPath = actionUrl.startsWith("/") ? actionUrl : `/${actionUrl}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function renderTemplateHtml(
  templateKey: string,
  subject: string,
  payload: Record<string, unknown>,
  appBaseUrl: string
): string {
  const title = readString(payload.title) ?? subject;
  const message = readString(payload.message) ?? "You have a new OpenAIP notification.";
  const actionUrl = resolveActionUrl(payload, appBaseUrl);

  const intro =
    templateKey === "AIP_PUBLISHED"
      ? "An AIP has been published."
      : templateKey === "PROJECT_UPDATE_STATUS_CHANGED"
        ? "A project update visibility change was recorded."
        : templateKey === "FEEDBACK_VISIBILITY_CHANGED"
          ? "A feedback moderation update was recorded."
          : "A new OpenAIP notification is available.";

  return [
    "<!doctype html>",
    "<html><body style=\"font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5;\">",
    `<h2 style="margin:0 0 12px 0;color:#022437;">${escapeHtml(title)}</h2>`,
    `<p style="margin:0 0 10px 0;">${escapeHtml(intro)}</p>`,
    `<p style="margin:0 0 16px 0;">${escapeHtml(message)}</p>`,
    actionUrl
      ? `<p style="margin:0 0 16px 0;"><a href="${escapeHtml(
          actionUrl
        )}" style="display:inline-block;padding:10px 14px;background:#022437;color:#fff;text-decoration:none;border-radius:6px;">Open in OpenAIP</a></p>`
      : "",
    `<p style="margin:12px 0 0 0;font-size:12px;color:#64748b;">This message was sent by OpenAIP.</p>`,
    "</body></html>",
  ].join("");
}

export function canAttemptRow(
  row: Pick<OutboxRow, "created_at" | "attempt_count">,
  now: Date,
  backoffMinutesByAttempt: readonly number[] = DEFAULT_BACKOFF_MINUTES
): boolean {
  const createdAtMs = new Date(row.created_at).getTime();
  if (!Number.isFinite(createdAtMs)) return true;
  const attemptIndex = Math.max(
    0,
    Math.min(Math.floor(row.attempt_count), backoffMinutesByAttempt.length - 1)
  );
  const minDelayMs = backoffMinutesByAttempt[attemptIndex] * 60_000;
  return now.getTime() - createdAtMs >= minDelayMs;
}

async function sendViaResend(args: SendEmailArgs): Promise<SendEmailResult> {
  try {
    const response = await fetch(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.resendApiKey}`,
      },
      body: JSON.stringify({
        from: args.fromEmail,
        to: [args.toEmail],
        subject: args.subject,
        html: args.html,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        error: detail || `Resend request failed with status ${response.status}.`,
      };
    }

    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown resend transport error.",
    };
  }
}

export async function processOutboxBatch(args: {
  rows: OutboxRow[];
  now: Date;
  maxAttempts: number;
  resendApiKey: string;
  fromEmail: string;
  appBaseUrl: string;
  sendEmailFn?: (args: SendEmailArgs) => Promise<SendEmailResult>;
}): Promise<ProcessBatchSummary> {
  const sendEmail = args.sendEmailFn ?? sendViaResend;
  const eligibleRows = args.rows.filter((row) => canAttemptRow(row, args.now));
  const patches: OutboxPatch[] = [];
  let sent = 0;
  let failed = 0;
  let queuedForRetry = 0;

  for (const row of eligibleRows) {
    const payload = asRecord(row.payload);
    const html = renderTemplateHtml(row.template_key, row.subject, payload, args.appBaseUrl);
    const result = await sendEmail({
      toEmail: row.to_email,
      subject: row.subject,
      html,
      resendApiKey: args.resendApiKey,
      fromEmail: args.fromEmail,
    });

    const nextAttemptCount = row.attempt_count + 1;
    if (result.ok) {
      sent += 1;
      patches.push({
        id: row.id,
        status: "sent",
        attempt_count: nextAttemptCount,
        last_error: null,
        sent_at: nowIso(args.now),
      });
      continue;
    }

    failed += 1;
    const exhausted = nextAttemptCount >= args.maxAttempts;
    if (!exhausted) {
      queuedForRetry += 1;
    }
    patches.push({
      id: row.id,
      status: exhausted ? "failed" : "queued",
      attempt_count: nextAttemptCount,
      last_error: (result.error ?? "Unknown email send failure.").slice(0, 2000),
      sent_at: null,
    });
  }

  return {
    fetched: args.rows.length,
    eligible: eligibleRows.length,
    sent,
    failed,
    queuedForRetry,
    skippedBackoff: args.rows.length - eligibleRows.length,
    patches,
  };
}

async function applyOutboxPatches(
  supabase: SupabaseClient,
  patches: OutboxPatch[]
): Promise<void> {
  for (const patch of patches) {
    const { error } = await supabase
      .from("email_outbox")
      .update({
        status: patch.status,
        attempt_count: patch.attempt_count,
        last_error: patch.last_error,
        sent_at: patch.sent_at,
      })
      .eq("id", patch.id);
    if (error) {
      console.error("[OUTBOX][PATCH_FAILED]", {
        outbox_id: patch.id,
        message: error.message,
      });
    }
  }
}

export function buildOutboxFailureThresholdNotifications(args: {
  adminRecipients: AdminRecipient[];
  failedCountLastHour: number;
  threshold: number;
  now: Date;
}): OutboxThresholdNotificationRow[] {
  if (args.failedCountLastHour <= args.threshold) return [];
  const bucket = toHourBucket(args.now);
  const dedupeKey = `OUTBOX_FAILURE_THRESHOLD_REACHED:system:outbox_failures:${bucket}`;
  return args.adminRecipients.map((recipient) => ({
    recipient_user_id: recipient.id,
    recipient_role: recipient.role,
    scope_type: "admin",
    event_type: "OUTBOX_FAILURE_THRESHOLD_REACHED",
    entity_type: "system",
    entity_id: null,
    title: "Email outbox failure threshold reached",
    message: `${args.failedCountLastHour} outbox rows failed in the last hour (threshold: ${args.threshold}).`,
    action_url: "/admin/usage-controls",
    metadata: {
      failed_count_last_hour: args.failedCountLastHour,
      threshold: args.threshold,
      window_minutes: 60,
      bucket,
    },
    dedupe_key: dedupeKey,
  }));
}

async function maybeEmitOutboxFailureThresholdAlert(args: {
  supabase: SupabaseClient;
  threshold: number;
  now: Date;
}): Promise<{ failedCountLastHour: number; alertsInserted: number }> {
  const oneHourAgoIso = new Date(args.now.getTime() - 60 * 60 * 1000).toISOString();

  const { count, error: countError } = await args.supabase
    .from("email_outbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("created_at", oneHourAgoIso);
  if (countError) {
    throw new Error(countError.message);
  }

  const failedCountLastHour = count ?? 0;
  if (failedCountLastHour <= args.threshold) {
    return { failedCountLastHour, alertsInserted: 0 };
  }

  const { data: admins, error: adminsError } = await args.supabase
    .from("profiles")
    .select("id,role")
    .eq("role", "admin")
    .eq("is_active", true);
  if (adminsError) {
    throw new Error(adminsError.message);
  }

  const adminRecipients = ((admins ?? []) as Array<{ id: string; role: string }>).map(
    (row) => ({ id: row.id, role: row.role })
  );
  const rows = buildOutboxFailureThresholdNotifications({
    adminRecipients,
    failedCountLastHour,
    threshold: args.threshold,
    now: args.now,
  });

  if (rows.length === 0) {
    return { failedCountLastHour, alertsInserted: 0 };
  }

  const { error: insertError } = await args.supabase.from("notifications").upsert(rows, {
    onConflict: "recipient_user_id,dedupe_key",
    ignoreDuplicates: true,
  });
  if (insertError) {
    throw new Error(insertError.message);
  }

  return { failedCountLastHour, alertsInserted: rows.length };
}

async function loadQueuedRows(
  supabase: SupabaseClient,
  batchSize: number,
  maxAttempts: number
): Promise<OutboxRow[]> {
  const { data, error } = await supabase
    .from("email_outbox")
    .select(
      "id,recipient_user_id,to_email,template_key,subject,payload,status,attempt_count,last_error,created_at,sent_at,dedupe_key"
    )
    .eq("status", "queued")
    .lt("attempt_count", maxAttempts)
    .order("created_at", { ascending: true })
    .limit(batchSize);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as OutboxRow[];
}

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed. Use POST." });
  }

  if (!isAuthorizedRequest(request)) {
    return json(401, { error: "Unauthorized." });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const fromEmail = Deno.env.get("FROM_EMAIL") ?? "";
    const appBaseUrl = Deno.env.get("APP_BASE_URL") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    }
    if (!resendApiKey || !fromEmail || !appBaseUrl) {
      throw new Error("Missing RESEND_API_KEY, FROM_EMAIL, or APP_BASE_URL.");
    }

    const payload = (await request.json().catch(() => ({}))) as {
      batchSize?: number;
      failureThreshold?: number;
    };

    const batchSize =
      Number.isFinite(payload.batchSize) && (payload.batchSize ?? 0) > 0
        ? Math.min(Math.floor(payload.batchSize as number), 100)
        : readPositiveIntEnv("EMAIL_OUTBOX_BATCH_SIZE", DEFAULT_BATCH_SIZE, 100);
    const maxAttempts = readPositiveIntEnv("EMAIL_OUTBOX_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS, 10);
    const failureThreshold =
      Number.isFinite(payload.failureThreshold) && (payload.failureThreshold ?? 0) > 0
        ? Math.floor(payload.failureThreshold as number)
        : readPositiveIntEnv(
            "EMAIL_OUTBOX_FAILURE_THRESHOLD_PER_HOUR",
            DEFAULT_FAILURE_THRESHOLD,
            10_000
          );

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    const now = new Date();

    const rows = await loadQueuedRows(supabase, batchSize, maxAttempts);
    const batchSummary = await processOutboxBatch({
      rows,
      now,
      maxAttempts,
      resendApiKey,
      fromEmail,
      appBaseUrl,
    });
    await applyOutboxPatches(supabase, batchSummary.patches);

    const thresholdSummary = await maybeEmitOutboxFailureThresholdAlert({
      supabase,
      threshold: failureThreshold,
      now,
    });

    return json(200, {
      ok: true,
      batch_size: batchSize,
      max_attempts: maxAttempts,
      processed: {
        fetched: batchSummary.fetched,
        eligible: batchSummary.eligible,
        sent: batchSummary.sent,
        failed: batchSummary.failed,
        queued_for_retry: batchSummary.queuedForRetry,
        skipped_backoff: batchSummary.skippedBackoff,
      },
      outbox_failures_last_hour: thresholdSummary.failedCountLastHour,
      threshold_notifications_inserted: thresholdSummary.alertsInserted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown outbox processing failure.";
    console.error("[OUTBOX][PROCESS_FAILED]", { message });
    return json(500, { error: message });
  }
}

if (import.meta.main) {
  Deno.serve((request) => handleRequest(request));
}
