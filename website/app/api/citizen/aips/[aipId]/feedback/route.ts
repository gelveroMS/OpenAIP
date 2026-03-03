import { NextResponse } from "next/server";
import {
  assertFeedbackUsageAllowed,
  isFeedbackUsageError,
} from "@/lib/feedback/usage-guards";
import { notifySafely } from "@/lib/notifications";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import { supabaseServer } from "@/lib/supabase/server";
import {
  assertPublishedAipStatus,
  CitizenAipFeedbackApiError,
  hydrateAipFeedbackItems,
  listPublicAipFeedback,
  resolveViewerUserId,
  requireCitizenActor,
  resolveAipById,
  sanitizeCitizenFeedbackKind,
  sanitizeFeedbackBody,
  toErrorResponse,
} from "../../_feedback-shared";

type CreateFeedbackRequestBody = {
  kind?: unknown;
  body?: unknown;
};

const FEEDBACK_SELECT_COLUMNS =
  "id,target_type,aip_id,parent_feedback_id,kind,body,author_id,is_public,created_at";

export async function GET(
  _request: Request,
  context: { params: Promise<{ aipId: string }> }
) {
  try {
    const { aipId } = await context.params;
    const client = await supabaseServer();
    const aip = await resolveAipById(client, aipId);
    assertPublishedAipStatus(aip.status);
    const viewerUserId = await resolveViewerUserId(client);

    const items = await listPublicAipFeedback(client, aip.id, { viewerUserId });
    return NextResponse.json({ items }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error, "Failed to load AIP feedback.");
  }
}

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
      | CreateFeedbackRequestBody
      | null;

    const kind = sanitizeCitizenFeedbackKind(payload?.kind);
    const body = sanitizeFeedbackBody(payload?.body);

    const { aipId } = await context.params;
    const client = await supabaseServer();
    const { userId } = await requireCitizenActor(client);
    await assertFeedbackUsageAllowed({ client: client as any, userId });
    const aip = await resolveAipById(client, aipId);
    assertPublishedAipStatus(aip.status);

    const { data, error } = await client
      .from("feedback")
      .insert({
        target_type: "aip",
        aip_id: aip.id,
        project_id: null,
        parent_feedback_id: null,
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
      throw new CitizenAipFeedbackApiError(500, error?.message ?? "Failed to create feedback.");
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
      throw new CitizenAipFeedbackApiError(500, "Failed to load created feedback.");
    }

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (isFeedbackUsageError(error)) {
      return toErrorResponse(
        new CitizenAipFeedbackApiError(error.status, error.message),
        "Failed to create AIP feedback."
      );
    }
    return toErrorResponse(error, "Failed to create AIP feedback.");
  }
}
