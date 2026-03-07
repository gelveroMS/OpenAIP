import { NextResponse } from "next/server";
import {
  assertFeedbackUsageAllowed,
  type FeedbackQueryClient,
  isFeedbackUsageError,
} from "@/lib/feedback/usage-guards";
import { notifySafely } from "@/lib/notifications";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import { supabaseServer } from "@/lib/supabase/server";
import {
  assertPublishedAipStatus,
  CitizenAipFeedbackApiError,
  hydrateAipFeedbackItems,
  loadAipFeedbackRowById,
  requireCitizenActor,
  resolveAipById,
  sanitizeCitizenFeedbackKind,
  sanitizeFeedbackBody,
  toErrorResponse,
} from "../../../_feedback-shared";

type ReplyFeedbackRequestBody = {
  parentFeedbackId?: string;
  kind?: unknown;
  body?: unknown;
};

const FEEDBACK_SELECT_COLUMNS =
  "id,target_type,aip_id,parent_feedback_id,kind,body,author_id,is_public,created_at";

export async function POST(
  request: Request,
  context: { params: Promise<{ aipId: string }> }
) {
  try {
    const csrf = enforceCsrfProtection(request);
    if (!csrf.ok) {
      return csrf.response;
    }

    const payload = (await request.json().catch(() => null)) as
      | ReplyFeedbackRequestBody
      | null;

    const parentFeedbackId = payload?.parentFeedbackId?.trim();
    if (!parentFeedbackId) {
      throw new CitizenAipFeedbackApiError(400, "Parent feedback ID is required.");
    }

    const kind = sanitizeCitizenFeedbackKind(payload?.kind);
    const body = sanitizeFeedbackBody(payload?.body);

    const { aipId } = await context.params;
    const client = await supabaseServer();
    const { userId } = await requireCitizenActor(client);
    await assertFeedbackUsageAllowed({
      client: client as unknown as FeedbackQueryClient,
      userId,
    });
    const aip = await resolveAipById(client, aipId);
    assertPublishedAipStatus(aip.status);

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
        "Citizens can only reply to citizen-initiated AIP feedback threads."
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
        kind,
        extraction_run_id: null,
        extraction_artifact_id: null,
        field_key: null,
        severity: null,
        body,
        is_public: true,
        author_id: userId,
      })
      .select(FEEDBACK_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new CitizenAipFeedbackApiError(500, error?.message ?? "Failed to create feedback reply.");
    }
    await notifySafely({
      eventType: "FEEDBACK_CREATED",
      scopeType: "citizen",
      entityType: "feedback",
      entityId: data.id,
      feedbackId: data.id,
      aipId: aip.id,
      actorUserId: userId,
      actorRole: "citizen",
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
