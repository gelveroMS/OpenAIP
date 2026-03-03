import { NextResponse } from "next/server";
import { getActorContext } from "@/lib/domain/get-actor-context";
import {
  assertFeedbackUsageAllowed,
  type FeedbackQueryClient,
  isFeedbackUsageError,
} from "@/lib/feedback/usage-guards";
import { notifySafely } from "@/lib/notifications";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import { supabaseServer } from "@/lib/supabase/server";
import {
  CitizenAipFeedbackApiError,
  hydrateAipFeedbackItems,
  loadAipFeedbackRowById,
  sanitizeFeedbackBody,
  toErrorResponse,
} from "@/app/api/citizen/aips/_feedback-shared";

type RouteScope = "barangay" | "city";

type ReplyFeedbackRequestBody = {
  parentFeedbackId?: unknown;
  body?: unknown;
};

type ScopedAipLookupRow = {
  id: string;
  status: "draft" | "pending_review" | "under_review" | "for_revision" | "published";
};

const FEEDBACK_SELECT_COLUMNS =
  "id,target_type,aip_id,parent_feedback_id,kind,body,author_id,is_public,created_at";

function assertScopedActor(
  input: Awaited<ReturnType<typeof getActorContext>>,
  scope: RouteScope
): asserts input is NonNullable<Awaited<ReturnType<typeof getActorContext>>> {
  if (!input) {
    throw new CitizenAipFeedbackApiError(401, "Unauthorized.");
  }

  if (
    scope === "barangay" &&
    (input.role !== "barangay_official" ||
      input.scope.kind !== "barangay" ||
      !input.scope.id)
  ) {
    throw new CitizenAipFeedbackApiError(401, "Unauthorized.");
  }

  if (
    scope === "city" &&
    (input.role !== "city_official" || input.scope.kind !== "city" || !input.scope.id)
  ) {
    throw new CitizenAipFeedbackApiError(401, "Unauthorized.");
  }
}

function sanitizeParentFeedbackId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CitizenAipFeedbackApiError(400, "Parent feedback ID is required.");
  }
  return value.trim();
}

async function resolveScopedAip(input: {
  client: Awaited<ReturnType<typeof supabaseServer>>;
  scope: RouteScope;
  scopeId: string;
  aipId: string;
}) {
  const scopeColumn = input.scope === "barangay" ? "barangay_id" : "city_id";
  const { data, error } = await input.client
    .from("aips")
    .select("id,status")
    .eq("id", input.aipId)
    .eq(scopeColumn, input.scopeId)
    .maybeSingle();

  if (error) {
    throw new CitizenAipFeedbackApiError(500, error.message);
  }

  if (!data) {
    throw new CitizenAipFeedbackApiError(404, "AIP not found.");
  }

  const aip = data as ScopedAipLookupRow;
  if (aip.status !== "published") {
    throw new CitizenAipFeedbackApiError(
      403,
      "Feedback replies are only available for published AIPs."
    );
  }

  return {
    id: aip.id,
    status: aip.status,
  };
}

export async function handleScopedAipFeedbackReplyRequest(input: {
  request: Request;
  scope: RouteScope;
  aipId: string;
}) {
  try {
    const csrf = enforceCsrfProtection(input.request);
    if (!csrf.ok) {
      return csrf.response;
    }

    const payload = (await input.request.json().catch(() => null)) as
      | ReplyFeedbackRequestBody
      | null;

    const parentFeedbackId = sanitizeParentFeedbackId(payload?.parentFeedbackId);
    const body = sanitizeFeedbackBody(payload?.body);

    const aipId = input.aipId.trim();
    if (!aipId) {
      throw new CitizenAipFeedbackApiError(400, "AIP ID is required.");
    }

    const actor = await getActorContext();
    assertScopedActor(actor, input.scope);

    const client = await supabaseServer();
    await assertFeedbackUsageAllowed({
      client: client as unknown as FeedbackQueryClient,
      userId: actor.userId,
    });
    const aip = await resolveScopedAip({
      client,
      scope: input.scope,
      scopeId: actor.scope.id!,
      aipId,
    });

    const parent = await loadAipFeedbackRowById(client, parentFeedbackId);
    if (!parent) {
      throw new CitizenAipFeedbackApiError(404, "Parent feedback not found.");
    }

    if (parent.target_type !== "aip" || !parent.aip_id) {
      throw new CitizenAipFeedbackApiError(400, "Parent feedback target must be an AIP.");
    }

    if (parent.aip_id !== aip.id) {
      throw new CitizenAipFeedbackApiError(
        400,
        "Parent feedback does not belong to the selected AIP."
      );
    }

    const rootFeedbackId = parent.parent_feedback_id ?? parent.id;
    const root =
      rootFeedbackId === parent.id
        ? parent
        : await loadAipFeedbackRowById(client, rootFeedbackId);

    if (!root) {
      throw new CitizenAipFeedbackApiError(404, "Feedback thread root not found.");
    }

    if (root.parent_feedback_id !== null) {
      throw new CitizenAipFeedbackApiError(400, "Feedback thread root is invalid.");
    }

    if (root.target_type !== "aip" || root.aip_id !== aip.id) {
      throw new CitizenAipFeedbackApiError(
        400,
        "Feedback thread root does not belong to the selected AIP."
      );
    }

    const [rootItem] = await hydrateAipFeedbackItems([root]);
    if (!rootItem || rootItem.author.role !== "citizen") {
      throw new CitizenAipFeedbackApiError(
        403,
        "Officials can only reply to citizen-initiated AIP feedback threads."
      );
    }

    const { data, error } = await client
      .from("feedback")
      .insert({
        target_type: "aip",
        aip_id: aip.id,
        project_id: null,
        parent_feedback_id: rootFeedbackId,
        source: "human",
        kind: "lgu_note",
        extraction_run_id: null,
        extraction_artifact_id: null,
        field_key: null,
        severity: null,
        body,
        is_public: true,
        author_id: actor.userId,
      })
      .select(FEEDBACK_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new CitizenAipFeedbackApiError(
        500,
        error?.message ?? "Failed to create feedback reply."
      );
    }
    await notifySafely({
      eventType: "FEEDBACK_CREATED",
      scopeType: input.scope,
      entityType: "feedback",
      entityId: data.id,
      feedbackId: data.id,
      aipId: aip.id,
      actorUserId: actor.userId,
      actorRole: actor.role,
    });

    const [item] = await hydrateAipFeedbackItems([data]);
    if (!item) {
      throw new CitizenAipFeedbackApiError(500, "Failed to load created feedback reply.");
    }

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (isFeedbackUsageError(error)) {
      return toErrorResponse(
        new CitizenAipFeedbackApiError(error.status, error.message),
        "Failed to create AIP feedback reply."
      );
    }
    return toErrorResponse(error, "Failed to create AIP feedback reply.");
  }
}
