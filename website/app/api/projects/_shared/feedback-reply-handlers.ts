import { NextResponse } from "next/server";
import { getActorContext } from "@/lib/domain/get-actor-context";
import {
  assertFeedbackUsageAllowed,
  isFeedbackUsageError,
} from "@/lib/feedback/usage-guards";
import { notifySafely } from "@/lib/notifications";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import { supabaseServer } from "@/lib/supabase/server";
import {
  CITIZEN_PROJECT_FEEDBACK_KINDS,
  CitizenFeedbackApiError,
  hydrateProjectFeedbackItems,
  isUuid,
  loadProjectFeedbackRowById,
  sanitizeFeedbackBody,
  toErrorResponse,
} from "@/app/api/citizen/feedback/_shared";

type RouteScope = "barangay" | "city";

type ReplyFeedbackRequestBody = {
  parentFeedbackId?: unknown;
  body?: unknown;
};

type AipScopeRow = {
  id: string;
  status: "draft" | "pending_review" | "under_review" | "for_revision" | "published";
};

type ProjectLookupRow = {
  id: string;
  aip_id: string;
  aip_ref_code: string;
  category: "health" | "infrastructure" | "other";
  created_at: string;
};

const FEEDBACK_SELECT_COLUMNS =
  "id,target_type,project_id,parent_feedback_id,kind,body,author_id,is_public,created_at";

function assertScopedActor(
  input: Awaited<ReturnType<typeof getActorContext>>,
  scope: RouteScope
): asserts input is NonNullable<Awaited<ReturnType<typeof getActorContext>>> {
  if (!input) {
    throw new CitizenFeedbackApiError(401, "Unauthorized.");
  }

  if (
    scope === "barangay" &&
    (input.role !== "barangay_official" ||
      input.scope.kind !== "barangay" ||
      !input.scope.id)
  ) {
    throw new CitizenFeedbackApiError(401, "Unauthorized.");
  }

  if (
    scope === "city" &&
    (input.role !== "city_official" || input.scope.kind !== "city" || !input.scope.id)
  ) {
    throw new CitizenFeedbackApiError(401, "Unauthorized.");
  }
}

async function resolveScopedProject(input: {
  client: Awaited<ReturnType<typeof supabaseServer>>;
  scope: RouteScope;
  scopeId: string;
  projectIdOrRef: string;
}) {
  const scopeColumn = input.scope === "barangay" ? "barangay_id" : "city_id";
  const { data: aipRows, error: aipError } = await input.client
    .from("aips")
    .select("id,status")
    .eq(scopeColumn, input.scopeId);

  if (aipError) {
    throw new CitizenFeedbackApiError(500, aipError.message);
  }

  const aipStatusById = new Map(
    ((aipRows ?? []) as AipScopeRow[]).map((row) => [row.id, row.status])
  );
  const scopedAipIds = Array.from(aipStatusById.keys());
  if (scopedAipIds.length === 0) {
    throw new CitizenFeedbackApiError(404, "Project not found.");
  }

  let rows: ProjectLookupRow[] = [];
  if (isUuid(input.projectIdOrRef)) {
    const { data, error } = await input.client
      .from("projects")
      .select("id,aip_id,aip_ref_code,category,created_at")
      .eq("id", input.projectIdOrRef)
      .in("aip_id", scopedAipIds)
      .limit(2);

    if (error) {
      throw new CitizenFeedbackApiError(500, error.message);
    }

    rows = (data ?? []) as ProjectLookupRow[];
  } else {
    const { data, error } = await input.client
      .from("projects")
      .select("id,aip_id,aip_ref_code,category,created_at")
      .eq("aip_ref_code", input.projectIdOrRef)
      .in("aip_id", scopedAipIds)
      .order("created_at", { ascending: false })
      .limit(2);

    if (error) {
      throw new CitizenFeedbackApiError(500, error.message);
    }

    rows = (data ?? []) as ProjectLookupRow[];
  }

  if (rows.length === 0) {
    throw new CitizenFeedbackApiError(404, "Project not found.");
  }

  if (rows.length > 1) {
    throw new CitizenFeedbackApiError(409, "Project reference is ambiguous in your scope.");
  }

  const row = rows[0];
  const aipStatus = aipStatusById.get(row.aip_id);
  if (!aipStatus) {
    throw new CitizenFeedbackApiError(404, "Project not found.");
  }

  if (aipStatus !== "published") {
    throw new CitizenFeedbackApiError(
      403,
      "Feedback replies are only available for projects under published AIPs."
    );
  }

  return {
    id: row.id,
    aipId: row.aip_id,
    aipRefCode: row.aip_ref_code,
    aipStatus,
  };
}

function sanitizeParentFeedbackId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CitizenFeedbackApiError(400, "Parent feedback ID is required.");
  }
  return value.trim();
}

export async function handleProjectFeedbackReplyRequest(input: {
  request: Request;
  scope: RouteScope;
  projectIdOrRef: string;
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

    const actor = await getActorContext();
    assertScopedActor(actor, input.scope);

    const projectIdOrRef = input.projectIdOrRef.trim();
    if (!projectIdOrRef) {
      throw new CitizenFeedbackApiError(400, "Project ID is required.");
    }

    const client = await supabaseServer();
    await assertFeedbackUsageAllowed({ client: client as any, userId: actor.userId });
    const project = await resolveScopedProject({
      client,
      scope: input.scope,
      scopeId: actor.scope.id!,
      projectIdOrRef,
    });

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

    if (
      root.target_type !== "project" ||
      root.project_id !== project.id ||
      !(CITIZEN_PROJECT_FEEDBACK_KINDS as readonly string[]).includes(root.kind)
    ) {
      throw new CitizenFeedbackApiError(
        403,
        "Officials can only reply to citizen-initiated project feedback threads."
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
      throw new CitizenFeedbackApiError(500, error?.message ?? "Failed to create feedback reply.");
    }
    await notifySafely({
      eventType: "FEEDBACK_CREATED",
      scopeType: input.scope,
      entityType: "feedback",
      entityId: data.id,
      feedbackId: data.id,
      projectId: project.id,
      aipId: project.aipId,
      actorUserId: actor.userId,
      actorRole: actor.role,
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
