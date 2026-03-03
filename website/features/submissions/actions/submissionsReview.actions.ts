"use server";

import { revalidatePath } from "next/cache";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { notifySafely } from "@/lib/notifications";
import { getAipSubmissionsReviewRepo } from "@/lib/repos/submissions/repo.server";

// [DATAFLOW] UI → server action → repo adapter (mock now; Supabase later).
// [SECURITY] This is the orchestration boundary for reviewer-only actions (request revision / publish).
// [DBV2] Writes should translate to:
//   - insert into `public.aip_reviews` (action + note, reviewer_id = actor.userId)
//   - update `public.aips.status` (under_review → for_revision | published)
// [SUPABASE-SWAP] Keep these checks even after Supabase: RLS enforces, but server-side validation gives clearer UX errors.
export async function requestRevisionAction(input: {
  aipId: string;
  note: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const trimmed = input.note.trim();
  if (!trimmed) {
    return { ok: false, message: "Revision comments are required." };
  }

  const actor = await getActorContext();
  if (!actor) {
    return { ok: false, message: "Unauthorized." };
  }

  if (actor.role !== "admin" && actor.role !== "city_official") {
    return { ok: false, message: "Unauthorized." };
  }

  try {
    const repo = getAipSubmissionsReviewRepo();
    await repo.requestRevision({ aipId: input.aipId, note: trimmed, actor });
    await notifySafely({
      eventType: "AIP_REVISION_REQUESTED",
      scopeType: "barangay",
      entityType: "aip",
      entityId: input.aipId,
      aipId: input.aipId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      note: trimmed,
      transition: "under_review->for_revision",
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to request revision.",
    };
  }
}

export async function claimReviewAction(input: {
  aipId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const actor = await getActorContext();
  if (!actor) {
    return { ok: false, message: "Unauthorized." };
  }

  if (actor.role !== "admin" && actor.role !== "city_official") {
    return { ok: false, message: "Unauthorized." };
  }

  try {
    const repo = getAipSubmissionsReviewRepo();
    await repo.claimReview({ aipId: input.aipId, actor });
    await notifySafely({
      eventType: "AIP_CLAIMED",
      scopeType: "barangay",
      entityType: "aip",
      entityId: input.aipId,
      aipId: input.aipId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      transition: "pending_review->under_review",
    });
    revalidatePath("/city/submissions");
    revalidatePath(`/city/submissions/aip/${input.aipId}`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to claim review.",
    };
  }
}

export async function publishAipAction(input: {
  aipId: string;
  note?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const trimmed = typeof input.note === "string" ? input.note.trim() : "";

  const actor = await getActorContext();
  if (!actor) {
    return { ok: false, message: "Unauthorized." };
  }

  if (actor.role !== "admin" && actor.role !== "city_official") {
    return { ok: false, message: "Unauthorized." };
  }

  try {
    const repo = getAipSubmissionsReviewRepo();
    await repo.publishAip({
      aipId: input.aipId,
      note: trimmed ? trimmed : undefined,
      actor,
    });
    await notifySafely({
      eventType: "AIP_PUBLISHED",
      scopeType: "barangay",
      entityType: "aip",
      entityId: input.aipId,
      aipId: input.aipId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      note: trimmed || null,
      transition: "under_review->published",
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to publish AIP.",
    };
  }
}
