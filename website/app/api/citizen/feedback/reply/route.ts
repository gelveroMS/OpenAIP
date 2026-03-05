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
  assertPublishedProjectAip,
  CitizenFeedbackApiError,
  hydrateProjectFeedbackItems,
  loadProjectFeedbackRowById,
  requireCitizenActor,
  resolveProjectByIdOrRef,
  sanitizeCitizenFeedbackKind,
  sanitizeFeedbackBody,
  toErrorResponse,
} from "../_shared";

type ReplyFeedbackRequestBody = {
  projectId?: string;
  parentFeedbackId?: string;
  kind?: unknown;
  body?: unknown;
};

const FEEDBACK_SELECT_COLUMNS =
  "id,target_type,project_id,parent_feedback_id,kind,body,author_id,is_public,created_at";

export async function POST(request: Request) {
  try {
    const csrf = enforceCsrfProtection(request);
    if (!csrf.ok) {
      return csrf.response;
    }

    const payload = (await request.json().catch(() => null)) as
      | ReplyFeedbackRequestBody
      | null;

    const projectId = payload?.projectId?.trim();
    if (!projectId) {
      throw new CitizenFeedbackApiError(400, "Project ID is required.");
    }

    const parentFeedbackId = payload?.parentFeedbackId?.trim();
    if (!parentFeedbackId) {
      throw new CitizenFeedbackApiError(400, "Parent feedback ID is required.");
    }

    const kind = sanitizeCitizenFeedbackKind(payload?.kind);
    const body = sanitizeFeedbackBody(payload?.body);

    const client = await supabaseServer();
    const { userId } = await requireCitizenActor(client);
    await assertFeedbackUsageAllowed({
      client: client as unknown as FeedbackQueryClient,
      userId,
    });
    const project = await resolveProjectByIdOrRef(client, projectId);
    assertPublishedProjectAip(project.aipStatus);

    const parent = await loadProjectFeedbackRowById(client, parentFeedbackId);
    if (!parent) {
      throw new CitizenFeedbackApiError(404, "Parent feedback not found.");
    }

    if (parent.target_type !== "project" || !parent.project_id) {
      throw new CitizenFeedbackApiError(400, "Parent feedback target must be a project.");
    }

    if (parent.project_id !== project.id) {
      throw new CitizenFeedbackApiError(
        400,
        "Parent feedback does not belong to the selected project."
      );
    }

    const rootFeedbackId = parent.parent_feedback_id ?? parent.id;
    const root =
      rootFeedbackId === parent.id
        ? parent
        : await loadProjectFeedbackRowById(client, rootFeedbackId);

    if (!root) {
      throw new CitizenFeedbackApiError(404, "Feedback thread root not found.");
    }

    if (root.parent_feedback_id !== null) {
      throw new CitizenFeedbackApiError(400, "Feedback thread root is invalid.");
    }

    if (root.target_type !== "project" || root.project_id !== project.id) {
      throw new CitizenFeedbackApiError(
        400,
        "Feedback thread root does not belong to the selected project."
      );
    }

    const [rootItem] = await hydrateProjectFeedbackItems([root]);
    if (!rootItem || rootItem.author.role !== "citizen") {
      throw new CitizenFeedbackApiError(
        403,
        "Citizens can only reply to citizen-initiated project feedback threads."
      );
    }

    const { data, error } = await client
      .from("feedback")
      .insert({
        target_type: "project",
        aip_id: null,
        project_id: project.id,
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
      throw new CitizenFeedbackApiError(500, error?.message ?? "Failed to create feedback reply.");
    }
    await notifySafely({
      eventType: "FEEDBACK_CREATED",
      scopeType: "citizen",
      entityType: "feedback",
      entityId: data.id,
      feedbackId: data.id,
      projectId: project.id,
      aipId: project.aipId,
      actorUserId: userId,
      actorRole: "citizen",
    });

    const [item] = await hydrateProjectFeedbackItems([data]);
    if (!item) {
      throw new CitizenFeedbackApiError(500, "Failed to load created feedback reply.");
    }

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (isFeedbackUsageError(error)) {
      return toErrorResponse(
        new CitizenFeedbackApiError(error.status, error.message),
        "Failed to create project feedback reply."
      );
    }
    return toErrorResponse(error, "Failed to create project feedback reply.");
  }
}
