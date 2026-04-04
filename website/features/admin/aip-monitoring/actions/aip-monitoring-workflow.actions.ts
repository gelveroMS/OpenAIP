"use server";

import { revalidatePath } from "next/cache";
import type { AipStatus } from "@/lib/contracts/databasev2";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { buildNotificationDedupeKey } from "@/lib/notifications/dedupe";
import { notifySafely } from "@/lib/notifications";
import { getAipSubmissionsReviewRepo } from "@/lib/repos/submissions/repo.server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

type AdminAipMonitoringActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

type AipWorkflowContextRow = {
  id: string;
  status: AipStatus;
  barangay_id: string | null;
  created_by: string | null;
};

function success(message: string): AdminAipMonitoringActionResult {
  return { ok: true, message };
}

function failure(message: string): AdminAipMonitoringActionResult {
  return { ok: false, message };
}

function toManilaDateKey(input: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(input);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

async function loadAipWorkflowContext(aipId: string): Promise<AipWorkflowContextRow | null> {
  const client = await supabaseServer();
  const { data, error } = await client
    .from("aips")
    .select("id,status,barangay_id,created_by")
    .eq("id", aipId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return (data ?? null) as AipWorkflowContextRow | null;
}

async function loadCurrentUploaderUserId(input: {
  aipId: string;
  fallbackCreatedBy: string | null;
}): Promise<string | null> {
  const client = await supabaseServer();
  const { data, error } = await client
    .from("uploaded_files")
    .select("uploaded_by")
    .eq("aip_id", input.aipId)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  const uploadedBy = data?.[0]?.uploaded_by;
  if (typeof uploadedBy === "string" && uploadedBy.trim().length > 0) {
    return uploadedBy;
  }
  return input.fallbackCreatedBy;
}

async function hasNotificationForDedupeKey(dedupeKey: string): Promise<boolean> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("notifications")
    .select("id")
    .eq("dedupe_key", dedupeKey)
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data) && data.length > 0;
}

async function assertAdminActor() {
  const actor = await getActorContext();
  if (!actor || actor.role !== "admin") {
    throw new Error("Unauthorized.");
  }
  return actor;
}

export async function forceUnclaimReviewAction(input: {
  aipId: string;
  message: string;
}): Promise<AdminAipMonitoringActionResult> {
  const aipId = input.aipId.trim();
  const message = input.message.trim();

  if (!aipId) return failure("AIP not found.");
  if (!message) return failure("Admin message is required.");

  try {
    const actor = await assertAdminActor();
    const aip = await loadAipWorkflowContext(aipId);
    if (!aip) return failure("AIP not found.");
    if (!aip.barangay_id) {
      return failure("Only barangay AIPs support force unclaim.");
    }
    if (aip.status !== "under_review") {
      return failure("Force unclaim is only allowed when the AIP is under review.");
    }

    const repo = getAipSubmissionsReviewRepo();
    const forceUnclaimResult = await repo.forceUnclaimReview({
      aipId,
      note: message,
      actor,
    });

    const uploaderUserId = await loadCurrentUploaderUserId({
      aipId,
      fallbackCreatedBy: aip.created_by,
    });

    const recipientUserIds = Array.from(
      new Set(
        [forceUnclaimResult.previousReviewerId, uploaderUserId].filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0
        )
      )
    );

    await notifySafely({
      eventType: "AIP_FORCE_UNCLAIMED",
      scopeType: "barangay",
      entityType: "aip",
      entityId: aipId,
      aipId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      note: message,
      transition: "under_review->pending_review",
      recipientUserIds,
    });

    revalidatePath("/admin/aip-monitoring");
    revalidatePath(`/admin/aip-monitoring/${aipId}`);
    revalidatePath(`/city/submissions/aip/${aipId}`);
    revalidatePath(`/barangay/aips/${aipId}`);
    return success("AIP was force-unclaimed and moved back to Pending Review.");
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Failed to force unclaim this AIP."
    );
  }
}

export async function remindCityOfficialsReviewAction(input: {
  aipId: string;
}): Promise<AdminAipMonitoringActionResult> {
  const aipId = input.aipId.trim();
  if (!aipId) return failure("AIP not found.");

  try {
    const actor = await assertAdminActor();
    const aip = await loadAipWorkflowContext(aipId);
    if (!aip) return failure("AIP not found.");
    if (!aip.barangay_id) {
      return failure("Only barangay AIPs support review reminders.");
    }
    if (aip.status !== "pending_review") {
      return failure("Reminders can only be sent while the AIP is Pending Review.");
    }

    const manilaDate = toManilaDateKey();
    const dedupeBucket = `manila-day-${manilaDate}`;
    const dedupeKey = buildNotificationDedupeKey({
      eventType: "AIP_REVIEW_REMINDER",
      entityType: "aip",
      entityId: aipId,
      bucket: dedupeBucket,
    });

    if (await hasNotificationForDedupeKey(dedupeKey)) {
      return failure(
        "A reminder was already sent today (Asia/Manila). You can send another tomorrow."
      );
    }

    await notifySafely({
      eventType: "AIP_REVIEW_REMINDER",
      scopeType: "city",
      entityType: "aip",
      entityId: aipId,
      aipId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      dedupeBucket,
    });

    revalidatePath("/admin/aip-monitoring");
    revalidatePath(`/admin/aip-monitoring/${aipId}`);
    revalidatePath(`/city/submissions/aip/${aipId}`);
    return success("Review reminder sent to city officials.");
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Failed to send review reminder."
    );
  }
}
