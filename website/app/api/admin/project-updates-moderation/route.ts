import { NextResponse } from "next/server";
import { writeActivityLog } from "@/lib/audit/activity-log";
import type { RoleType } from "@/lib/contracts/databasev2";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { notifySafely } from "@/lib/notifications";
import { enforceCsrfProtection } from "@/lib/security/csrf";
import { supabaseServer } from "@/lib/supabase/server";
import type {
  FeedbackModerationProjectUpdatesSeed,
  ProjectUpdateModerationInput,
} from "@/lib/repos/feedback-moderation-project-updates/repo";

type ProjectUpdateStatus = "active" | "hidden";

type ProjectUpdateScopeRow = {
  id: string;
  project_id: string;
  aip_id: string;
  status: ProjectUpdateStatus;
};

type AipScopeRow = {
  id: string;
  barangay_id: string | null;
  city_id: string | null;
};

type ModerationAction = "hide" | "unhide";

type ProjectUpdatesModerationActionBody = {
  action?: ModerationAction;
  input?: Partial<ProjectUpdateModerationInput>;
};

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
}

function badRequest(message: string) {
  return NextResponse.json({ message }, { status: 400 });
}

async function loadSeedData(): Promise<FeedbackModerationProjectUpdatesSeed> {
  const client = await supabaseServer();
  const [
    updatesResult,
    updateMediaResult,
    actionsResult,
    projectsResult,
    aipsResult,
    profilesResult,
    citiesResult,
    barangaysResult,
    municipalitiesResult,
  ] = await Promise.all([
    client
      .from("project_updates")
      .select(
        "id,project_id,aip_id,title,description,progress_percent,attendance_count,posted_by,status,hidden_reason,hidden_violation_category,hidden_at,hidden_by,created_at,updated_at"
      )
      .order("created_at", { ascending: false }),
    client
      .from("project_update_media")
      .select("id,update_id,project_id,bucket_id,object_name,mime_type,size_bytes,created_at")
      .order("created_at", { ascending: true }),
    client
      .from("activity_log")
      .select(
        "id,actor_id,actor_role,action,entity_table,entity_id,region_id,province_id,city_id,municipality_id,barangay_id,metadata,created_at"
      )
      .in("action", ["project_update_hidden", "project_update_unhidden"])
      .eq("entity_table", "project_updates")
      .order("created_at", { ascending: false }),
    client
      .from("projects")
      .select(
        "id,aip_id,extraction_artifact_id,aip_ref_code,program_project_description,implementing_agency,start_date,completion_date,expected_output,source_of_funds,personal_services,maintenance_and_other_operating_expenses,financial_expenses,capital_outlay,total,climate_change_adaptation,climate_change_mitigation,cc_topology_code,prm_ncr_lgu_rm_objective_results_indicator,errors,category,sector_code,is_human_edited,edited_by,edited_at,created_at,updated_at"
      ),
    client
      .from("aips")
      .select(
        "id,fiscal_year,barangay_id,city_id,municipality_id,status,status_updated_at,submitted_at,published_at,created_by,created_at,updated_at"
      ),
    client
      .from("profiles")
      .select(
        "id,role,full_name,email,barangay_id,city_id,municipality_id,is_active,created_at,updated_at"
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
    updatesResult,
    updateMediaResult,
    actionsResult,
    projectsResult,
    aipsResult,
    profilesResult,
    citiesResult,
    barangaysResult,
    municipalitiesResult,
  ].find((result) => result.error)?.error;
  if (firstError) {
    throw new Error(firstError.message);
  }

  return {
    updates: updatesResult.data ?? [],
    media: updateMediaResult.data ?? [],
    actions: actionsResult.data ?? [],
    lguMap: {
      projects: projectsResult.data ?? [],
      aips: aipsResult.data ?? [],
      profiles: profilesResult.data ?? [],
      cities: citiesResult.data ?? [],
      barangays: barangaysResult.data ?? [],
      municipalities: municipalitiesResult.data ?? [],
    },
  } as FeedbackModerationProjectUpdatesSeed;
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

  const aip = data as AipScopeRow;
  let cityId = aip.city_id;
  if (!cityId && aip.barangay_id) {
    const { data: barangay, error: barangayError } = await client
      .from("barangays")
      .select("city_id")
      .eq("id", aip.barangay_id)
      .maybeSingle();
    if (barangayError) {
      throw new Error(barangayError.message);
    }
    cityId = ((barangay ?? null) as { city_id: string | null } | null)?.city_id ?? null;
  }

  return {
    aipId: aip.id,
    barangayId: aip.barangay_id,
    cityId,
    scopeType: aip.barangay_id ? "barangay" : "city",
  };
}

async function resolveUpdateScope(updateId: string): Promise<{
  updateId: string;
  projectId: string;
  aipId: string;
  status: ProjectUpdateStatus;
  scopeType: "barangay" | "city";
  barangayId: string | null;
  cityId: string | null;
}> {
  const client = await supabaseServer();
  const { data, error } = await client
    .from("project_updates")
    .select("id,project_id,aip_id,status")
    .eq("id", updateId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Project update not found.");
  }

  const update = data as ProjectUpdateScopeRow;
  const aipScope = await resolveAipScope(update.aip_id);
  return {
    updateId: update.id,
    projectId: update.project_id,
    aipId: update.aip_id,
    status: update.status,
    scopeType: aipScope.scopeType,
    barangayId: aipScope.barangayId,
    cityId: aipScope.cityId,
  };
}

async function setProjectUpdateVisibility(input: {
  updateId: string;
  hidden: boolean;
  reason: string;
  violationCategory: string | null;
  actorUserId: string;
}): Promise<void> {
  const client = await supabaseServer();
  const payload = input.hidden
    ? {
        status: "hidden",
        hidden_reason: input.reason,
        hidden_violation_category: input.violationCategory,
        hidden_at: new Date().toISOString(),
        hidden_by: input.actorUserId,
      }
    : {
        status: "active",
        hidden_reason: null,
        hidden_violation_category: null,
        hidden_at: null,
        hidden_by: null,
      };

  const { error } = await client.from("project_updates").update(payload).eq("id", input.updateId);
  if (error) {
    throw new Error(error.message);
  }
}

function toPublishedTransition(status: ProjectUpdateStatus): "published" | "hidden" {
  return status === "active" ? "published" : "hidden";
}

async function emitModerationNotifications(input: {
  actorUserId: string;
  actorRole: RoleType;
  updateId: string;
  projectId: string;
  aipId: string;
  scopeType: "barangay" | "city";
  barangayId: string | null;
  cityId: string | null;
  reason: string;
  violationCategory: string | null;
  transition: string;
}) {
  await notifySafely({
    eventType: "PROJECT_UPDATE_STATUS_CHANGED",
    scopeType: input.scopeType,
    entityType: "project_update",
    entityId: input.updateId,
    projectUpdateId: input.updateId,
    projectId: input.projectId,
    aipId: input.aipId,
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
    entityType: "project_update",
    entityId: input.updateId,
    projectUpdateId: input.updateId,
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
    const seed = await loadSeedData();
    return NextResponse.json(seed, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load project update moderation dataset.";
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
    const body = (await request.json().catch(() => null)) as ProjectUpdatesModerationActionBody | null;
    const action = body?.action;
    const updateId = body?.input?.updateId?.trim();
    const reason = body?.input?.reason?.trim();
    const violationCategory = body?.input?.violationCategory?.trim() || null;

    if (action !== "hide" && action !== "unhide") {
      return badRequest("Invalid moderation action.");
    }
    if (!updateId) {
      return badRequest("Project update ID is required.");
    }
    if (!reason) {
      return badRequest("Reason is required.");
    }

    const context = await resolveUpdateScope(updateId);
    const nextStatus: ProjectUpdateStatus = action === "hide" ? "hidden" : "active";
    if (context.status !== nextStatus) {
      await setProjectUpdateVisibility({
        updateId,
        hidden: action === "hide",
        reason,
        violationCategory,
        actorUserId: actor.userId,
      });

      await writeActivityLog({
        action: action === "hide" ? "project_update_hidden" : "project_update_unhidden",
        entityTable: "project_updates",
        entityId: updateId,
        scope: {
          cityId: context.cityId,
          barangayId: context.barangayId,
        },
        metadata: {
          reason,
          violation_category: violationCategory,
        },
      });

      const transition = `${toPublishedTransition(context.status)}->${toPublishedTransition(nextStatus)}`;
      await emitModerationNotifications({
        actorUserId: actor.userId,
        actorRole: actor.role,
        updateId,
        projectId: context.projectId,
        aipId: context.aipId,
        scopeType: context.scopeType,
        barangayId: context.barangayId,
        cityId: context.cityId,
        reason,
        violationCategory,
        transition,
      });
    }

    const seed = await loadSeedData();
    return NextResponse.json(seed, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to process project update moderation action.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
