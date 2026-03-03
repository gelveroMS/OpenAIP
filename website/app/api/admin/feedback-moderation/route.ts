import { NextResponse } from "next/server";
import { writeActivityLog } from "@/lib/audit/activity-log";
import type { RoleType } from "@/lib/contracts/databasev2";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { notifySafely } from "@/lib/notifications";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import { supabaseServer } from "@/lib/supabase/server";
import type {
  FeedbackModerationActionInput,
  FeedbackModerationDataset,
} from "@/lib/repos/feedback-moderation/types";

type FeedbackVisibilityRow = {
  id: string;
  target_type: "aip" | "project";
  aip_id: string | null;
  project_id: string | null;
  is_public: boolean;
};

type AipScopeRow = {
  id: string;
  barangay_id: string | null;
  city_id: string | null;
};

type ProjectAipRow = {
  id: string;
  aip_id: string;
};

type FeedbackModerationAction = "hide" | "unhide";

type FeedbackModerationActionBody = {
  action?: FeedbackModerationAction;
  input?: Partial<FeedbackModerationActionInput>;
};

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
}

function badRequest(message: string) {
  return NextResponse.json({ message }, { status: 400 });
}

async function loadFeedbackDataset(): Promise<FeedbackModerationDataset> {
  const client = await supabaseServer();
  const [
    feedbackResult,
    activityResult,
    profilesResult,
    aipsResult,
    projectsResult,
    citiesResult,
    barangaysResult,
    municipalitiesResult,
  ] = await Promise.all([
    client
      .from("feedback")
      .select(
        "id,target_type,aip_id,project_id,parent_feedback_id,source,kind,extraction_run_id,extraction_artifact_id,field_key,severity,body,is_public,author_id,created_at,updated_at"
      ),
    client
      .from("activity_log")
      .select(
        "id,actor_id,actor_role,action,entity_table,entity_id,region_id,province_id,city_id,municipality_id,barangay_id,metadata,created_at"
      )
      .order("created_at", { ascending: false }),
    client
      .from("profiles")
      .select(
        "id,role,full_name,email,barangay_id,city_id,municipality_id,is_active,created_at,updated_at"
      ),
    client
      .from("aips")
      .select(
        "id,fiscal_year,barangay_id,city_id,municipality_id,status,status_updated_at,submitted_at,published_at,created_by,created_at,updated_at"
      ),
    client
      .from("projects")
      .select(
        "id,aip_id,extraction_artifact_id,aip_ref_code,program_project_description,implementing_agency,start_date,completion_date,expected_output,source_of_funds,personal_services,maintenance_and_other_operating_expenses,financial_expenses,capital_outlay,total,climate_change_adaptation,climate_change_mitigation,cc_topology_code,prm_ncr_lgu_rm_objective_results_indicator,errors,category,sector_code,is_human_edited,edited_by,edited_at,created_at,updated_at"
      ),
    client
      .from("cities")
      .select("id,region_id,province_id,psgc_code,name,is_independent,is_active,created_at"),
    client
      .from("barangays")
      .select("id,city_id,municipality_id,psgc_code,name,is_active,created_at"),
    client
      .from("municipalities")
      .select("id,province_id,psgc_code,name,is_active,created_at"),
  ]);

  const firstError = [
    feedbackResult,
    activityResult,
    profilesResult,
    aipsResult,
    projectsResult,
    citiesResult,
    barangaysResult,
    municipalitiesResult,
  ].find((result) => result.error)?.error;

  if (firstError) {
    throw new Error(firstError.message);
  }

  return {
    feedback: feedbackResult.data ?? [],
    activity: activityResult.data ?? [],
    profiles: profilesResult.data ?? [],
    aips: aipsResult.data ?? [],
    projects: projectsResult.data ?? [],
    cities: citiesResult.data ?? [],
    barangays: barangaysResult.data ?? [],
    municipalities: municipalitiesResult.data ?? [],
  } as FeedbackModerationDataset;
}

async function resolveAipScope(aipId: string): Promise<{
  aipId: string;
  barangayId: string | null;
  cityId: string | null;
  scopeType: "barangay" | "city";
}> {
  const client = await supabaseServer();
  const { data, error } = await client
    .from("aips")
    .select("id,barangay_id,city_id")
    .eq("id", aipId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Related AIP not found.");
  }

  const row = data as AipScopeRow;
  let cityId = row.city_id;
  if (!cityId && row.barangay_id) {
    const { data: barangay, error: barangayError } = await client
      .from("barangays")
      .select("city_id")
      .eq("id", row.barangay_id)
      .maybeSingle();
    if (barangayError) {
      throw new Error(barangayError.message);
    }
    cityId = ((barangay ?? null) as { city_id: string | null } | null)?.city_id ?? null;
  }

  return {
    aipId: row.id,
    barangayId: row.barangay_id,
    cityId,
    scopeType: row.barangay_id ? "barangay" : "city",
  };
}

async function resolveFeedbackScope(feedbackId: string): Promise<{
  feedbackId: string;
  isPublic: boolean;
  aipId: string | null;
  projectId: string | null;
  scopeType: "barangay" | "city";
  barangayId: string | null;
  cityId: string | null;
}> {
  const client = await supabaseServer();
  const { data, error } = await client
    .from("feedback")
    .select("id,target_type,aip_id,project_id,is_public")
    .eq("id", feedbackId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Feedback not found.");
  }

  const feedback = data as FeedbackVisibilityRow;
  if (feedback.target_type === "aip" && feedback.aip_id) {
    const aipScope = await resolveAipScope(feedback.aip_id);
    return {
      feedbackId: feedback.id,
      isPublic: feedback.is_public,
      aipId: aipScope.aipId,
      projectId: null,
      scopeType: aipScope.scopeType,
      barangayId: aipScope.barangayId,
      cityId: aipScope.cityId,
    };
  }

  if (feedback.target_type === "project" && feedback.project_id) {
    const { data: project, error: projectError } = await client
      .from("projects")
      .select("id,aip_id")
      .eq("id", feedback.project_id)
      .maybeSingle();
    if (projectError) {
      throw new Error(projectError.message);
    }
    if (!project) {
      throw new Error("Related project not found.");
    }

    const projectRow = project as ProjectAipRow;
    const aipScope = await resolveAipScope(projectRow.aip_id);
    return {
      feedbackId: feedback.id,
      isPublic: feedback.is_public,
      aipId: aipScope.aipId,
      projectId: projectRow.id,
      scopeType: aipScope.scopeType,
      barangayId: aipScope.barangayId,
      cityId: aipScope.cityId,
    };
  }

  throw new Error("Feedback scope could not be resolved.");
}

async function updateFeedbackVisibility(feedbackId: string, isPublic: boolean): Promise<void> {
  const client = await supabaseServer();
  const { error } = await client.from("feedback").update({ is_public: isPublic }).eq("id", feedbackId);
  if (error) {
    throw new Error(error.message);
  }
}

function resolveTransition(input: {
  currentVisible: boolean;
  action: FeedbackModerationAction;
}): string {
  const currentState = input.currentVisible ? "visible" : "hidden";
  const nextState = input.action === "hide" ? "hidden" : "visible";
  return `${currentState}->${nextState}`;
}

async function emitModerationNotifications(input: {
  action: FeedbackModerationAction;
  actorUserId: string;
  actorRole: RoleType;
  feedbackId: string;
  aipId: string | null;
  projectId: string | null;
  scopeType: "barangay" | "city";
  barangayId: string | null;
  cityId: string | null;
  reason: string;
  violationCategory: string | null;
  transition: string;
}) {
  await notifySafely({
    eventType: "FEEDBACK_VISIBILITY_CHANGED",
    scopeType: input.scopeType,
    entityType: "feedback",
    entityId: input.feedbackId,
    feedbackId: input.feedbackId,
    aipId: input.aipId,
    projectId: input.projectId,
    barangayId: input.barangayId,
    cityId: input.cityId,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    reason: input.reason,
    transition: input.transition,
    metadata: {
      violation_category: input.violationCategory,
    },
  });

  await notifySafely({
    eventType: "MODERATION_ACTION_AUDIT",
    scopeType: "admin",
    entityType: "feedback",
    entityId: input.feedbackId,
    feedbackId: input.feedbackId,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    reason: input.reason,
    transition: input.transition,
    sendEmail: false,
    metadata: {
      moderated_scope_type: input.scopeType,
      moderated_barangay_id: input.barangayId,
      moderated_city_id: input.cityId,
      violation_category: input.violationCategory,
    },
  });
}

export async function GET() {
  const actor = await getActorContext();
  if (!actor || actor.role !== "admin") {
    return unauthorized();
  }

  try {
    const dataset = await loadFeedbackDataset();
    return NextResponse.json(dataset, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load feedback moderation dataset.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const csrf = enforceCsrfProtection(request);
  if (!csrf.ok) {
    return csrf.response;
  }

  const actor = await getActorContext();
  if (!actor || actor.role !== "admin") {
    return unauthorized();
  }

  try {
    const body = (await request.json().catch(() => null)) as FeedbackModerationActionBody | null;
    const action = body?.action;
    const feedbackId = body?.input?.feedbackId?.trim();
    const reason = body?.input?.reason?.trim();
    const violationCategory = body?.input?.violationCategory?.trim() || null;

    if (action !== "hide" && action !== "unhide") {
      return badRequest("Invalid moderation action.");
    }
    if (!feedbackId) {
      return badRequest("Feedback ID is required.");
    }
    if (!reason) {
      return badRequest("Reason is required.");
    }

    const context = await resolveFeedbackScope(feedbackId);
    const nextVisibility = action === "unhide";
    if (context.isPublic !== nextVisibility) {
      await updateFeedbackVisibility(feedbackId, nextVisibility);
      await writeActivityLog({
        action: action === "hide" ? "feedback_hidden" : "feedback_unhidden",
        entityTable: "feedback",
        entityId: feedbackId,
        scope: {
          cityId: context.cityId,
          barangayId: context.barangayId,
        },
        metadata: {
          reason,
          violation_category: violationCategory,
        },
      });

      const transition = resolveTransition({
        currentVisible: context.isPublic,
        action,
      });
      await emitModerationNotifications({
        action,
        actorUserId: actor.userId,
        actorRole: actor.role,
        feedbackId,
        aipId: context.aipId,
        projectId: context.projectId,
        scopeType: context.scopeType,
        barangayId: context.barangayId,
        cityId: context.cityId,
        reason,
        violationCategory,
        transition,
      });
    }

    const dataset = await loadFeedbackDataset();
    return NextResponse.json(dataset, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process feedback moderation action.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
