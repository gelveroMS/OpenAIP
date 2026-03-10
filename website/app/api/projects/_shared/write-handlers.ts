import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { withWorkflowActivityMetadata } from "@/lib/audit/workflow-metadata";
import { getActorContext } from "@/lib/domain/get-actor-context";
import type { ActorContext } from "@/lib/domain/actor-context";
import { notifySafely } from "@/lib/notifications";
import { normalizeDateForStorage } from "@/features/projects/shared/add-information/date-normalization";
import {
  getProjectMediaBucketName,
  toProjectUpdateMediaProxyUrl,
} from "@/lib/projects/media";
import {
  removeProjectMediaObjects,
  toPrivilegedActorContext,
  uploadProjectMediaObject,
} from "@/lib/supabase/privileged-ops";
import { supabaseServer } from "@/lib/supabase/server";
import {
  getCurrentProgressBaseline,
  isStrictlyIncreasingProgress,
} from "./progress-guardrails";
import { normalizeAttendanceForProjectCategory } from "./attendance-normalization";

type RouteScope = "barangay" | "city";
type ProjectKind = "health" | "infrastructure";
type ProjectStatus = "proposed" | "ongoing" | "completed" | "on_hold";

type AipScopeRow = {
  id: string;
  status: "draft" | "pending_review" | "under_review" | "for_revision" | "published";
  barangay_id: string | null;
  city_id: string | null;
};

type ProjectLookupRow = {
  id: string;
  aip_id: string;
  aip_ref_code: string | null;
  category: "health" | "infrastructure" | "other";
};

type ResolvedScopedProject = {
  id: string;
  aipId: string;
  aipRefCode: string;
  category: "health" | "infrastructure";
  aipStatus: AipScopeRow["status"];
  barangayId: string | null;
  cityId: string | null;
};

type UploadedObjectRef = {
  bucketId: string;
  objectName: string;
  mimeType: string;
  sizeBytes: number;
};

type ProfileRow = {
  full_name: string | null;
  email: string | null;
  role:
    | "citizen"
    | "barangay_official"
    | "city_official"
    | "municipal_official"
    | "admin";
};

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_UPDATE_PHOTOS = 5;
const UNSPECIFIED_REF_CODE = "Unspecified";
const PROJECT_STATUS_VALUES: readonly ProjectStatus[] = [
  "proposed",
  "ongoing",
  "completed",
  "on_hold",
];

function toDisplayRefCode(value: string | null | undefined): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : UNSPECIFIED_REF_CODE;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function toDateLabel(value: string): string {
  return new Date(value).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function toErrorResponse(error: unknown, fallbackMessage: string): Response {
  if (error instanceof ApiError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : fallbackMessage;
  return NextResponse.json({ message }, { status: 500 });
}

function readStringField(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRequiredStringField(form: FormData, key: string, label: string): string {
  const value = readStringField(form, key);
  if (!value) {
    throw new ApiError(400, `${label} is required.`);
  }
  return value;
}

function parseProjectStatus(value: string): ProjectStatus {
  if ((PROJECT_STATUS_VALUES as readonly string[]).includes(value)) {
    return value as ProjectStatus;
  }
  throw new ApiError(400, "Invalid project status.");
}

function parseMoneyLike(value: string, label: string): number {
  const normalized = value.replace(/[^0-9.\-]/g, "").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ApiError(400, `${label} must be a non-negative number.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ApiError(400, `${label} must be a non-negative integer.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ApiError(400, `${label} must be a non-negative integer.`);
  }
  return parsed;
}

function normalizeDateInput(value: string, label: string): string {
  try {
    return normalizeDateForStorage(value, label);
  } catch {
    throw new ApiError(400, `${label} must be a valid date.`);
  }
}

function toFileExtension(file: File): string {
  const mime = file.type.toLowerCase();
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  const name = file.name.toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpg";
  if (name.endsWith(".png")) return "png";
  return "bin";
}

function isSupportedImageFile(file: File): boolean {
  const mime = file.type.toLowerCase();
  if (mime === "image/jpeg" || mime === "image/png") {
    return true;
  }
  const name = file.name.toLowerCase();
  return name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png");
}

function assertImageFile(file: File, label: string): void {
  if (!isSupportedImageFile(file)) {
    throw new ApiError(400, `${label} must be a JPG or PNG image.`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ApiError(400, `${label} must be 5MB or below.`);
  }
}

function getSingleImageFile(form: FormData, key: string): File | null {
  const value = form.get(key);
  if (!(value instanceof File)) return null;
  if (value.size <= 0) return null;
  return value;
}

function getMultiImageFiles(form: FormData, key: string): File[] {
  return form
    .getAll(key)
    .filter((value): value is File => value instanceof File && value.size > 0);
}

function assertScopedActor(
  actor: ActorContext | null,
  scope: RouteScope
): asserts actor is ActorContext {
  if (!actor) {
    throw new ApiError(401, "Unauthorized.");
  }

  if (
    scope === "barangay" &&
    (actor.role !== "barangay_official" ||
      actor.scope.kind !== "barangay" ||
      !actor.scope.id)
  ) {
    throw new ApiError(401, "Unauthorized.");
  }

  if (
    scope === "city" &&
    (actor.role !== "city_official" || actor.scope.kind !== "city" || !actor.scope.id)
  ) {
    throw new ApiError(401, "Unauthorized.");
  }
}

async function uploadImageToStorage(params: {
  actor: ActorContext;
  aipId: string;
  projectId: string;
  updateId?: string;
  file: File;
  index?: number;
}): Promise<UploadedObjectRef> {
  const bucketId = getProjectMediaBucketName();
  const extension = toFileExtension(params.file);
  const fileBuffer = Buffer.from(await params.file.arrayBuffer());
  const objectName = params.updateId
    ? `${params.aipId}/projects/${params.projectId}/updates/${params.updateId}/${String(
        params.index ?? 0
      ).padStart(2, "0")}-${randomUUID()}.${extension}`
    : `${params.aipId}/projects/${params.projectId}/cover-${randomUUID()}.${extension}`;

  try {
    return await uploadProjectMediaObject({
      actor: toPrivilegedActorContext(params.actor),
      aipId: params.aipId,
      projectId: params.projectId,
      updateId: params.updateId,
      bucketId,
      objectName,
      fileBuffer,
      contentType: params.file.type || "application/octet-stream",
      sizeBytes: params.file.size,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload image.";
    throw new ApiError(400, `Failed to upload image: ${message}`);
  }
}

async function removeUploadedStorageRefs(
  refs: UploadedObjectRef[],
  actor: ActorContext
): Promise<void> {
  if (!refs.length) return;
  const byBucket = new Map<string, string[]>();

  for (const ref of refs) {
    const bucketRefs = byBucket.get(ref.bucketId) ?? [];
    bucketRefs.push(ref.objectName);
    byBucket.set(ref.bucketId, bucketRefs);
  }

  for (const [bucketId, objectNames] of byBucket.entries()) {
    try {
      await removeProjectMediaObjects({
        actor: toPrivilegedActorContext(actor),
        aipId: null,
        projectId: null,
        bucketId,
        objectNames,
      });
    } catch (error) {
      console.error("[PROJECT_WRITE] failed cleanup of uploaded storage refs", {
        bucketId,
        objectNames,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function resolveScopedProject(params: {
  client: Awaited<ReturnType<typeof supabaseServer>>;
  scope: RouteScope;
  scopeId: string;
  projectIdOrRef: string;
}): Promise<{ project: ResolvedScopedProject | null; conflict: boolean }> {
  const scopeColumn = params.scope === "barangay" ? "barangay_id" : "city_id";
  const { data: aipRows, error: aipError } = await params.client
    .from("aips")
    .select("id,status,barangay_id,city_id")
    .eq(scopeColumn, params.scopeId);
  if (aipError) {
    throw new ApiError(400, aipError.message);
  }

  const byAipId = new Map<string, AipScopeRow>();
  for (const row of (aipRows ?? []) as AipScopeRow[]) {
    byAipId.set(row.id, row);
  }
  if (byAipId.size === 0) {
    return { project: null, conflict: false };
  }

  const projectSelect = "id,aip_id,aip_ref_code,category";
  let projectRows: ProjectLookupRow[] = [];
  if (isUuid(params.projectIdOrRef)) {
    const { data, error } = await params.client
      .from("projects")
      .select(projectSelect)
      .eq("id", params.projectIdOrRef)
      .in("aip_id", Array.from(byAipId.keys()))
      .limit(2);
    if (error) {
      throw new ApiError(400, error.message);
    }
    projectRows = (data ?? []) as ProjectLookupRow[];
  } else {
    const { data, error } = await params.client
      .from("projects")
      .select(projectSelect)
      .eq("aip_ref_code", params.projectIdOrRef)
      .in("aip_id", Array.from(byAipId.keys()))
      .limit(2);
    if (error) {
      throw new ApiError(400, error.message);
    }
    projectRows = (data ?? []) as ProjectLookupRow[];
  }

  if (projectRows.length === 0) {
    return { project: null, conflict: false };
  }
  if (projectRows.length > 1) {
    return { project: null, conflict: true };
  }

  const row = projectRows[0];
  const aip = byAipId.get(row.aip_id);
  if (!aip) {
    return { project: null, conflict: false };
  }
  if (row.category !== "health" && row.category !== "infrastructure") {
    throw new ApiError(400, "Only health or infrastructure projects can be updated.");
  }

  return {
    project: {
      id: row.id,
      aipId: row.aip_id,
      aipRefCode: toDisplayRefCode(row.aip_ref_code),
      category: row.category,
      aipStatus: aip.status,
      barangayId: aip.barangay_id,
      cityId: aip.city_id,
    },
    conflict: false,
  };
}

async function loadUploaderSnapshot(
  client: Awaited<ReturnType<typeof supabaseServer>>,
  actorUserId: string
): Promise<{ name: string; email: string | null; role: string | null }> {
  const { data, error } = await client
    .from("profiles")
    .select("full_name,email,role")
    .eq("id", actorUserId)
    .maybeSingle();

  if (error || !data) {
    return { name: "Unknown", email: null, role: null };
  }

  const row = data as ProfileRow;
  return {
    name: row.full_name?.trim() || "Unknown",
    email: row.email?.trim() || null,
    role: row.role ?? null,
  };
}

export async function handleAddInformationRequest(input: {
  request: Request;
  scope: RouteScope;
  projectIdOrRef: string;
}): Promise<Response> {
  try {
    const actor = await getActorContext();
    assertScopedActor(actor, input.scope);

    const projectIdOrRef = input.projectIdOrRef.trim();
    if (!projectIdOrRef) {
      throw new ApiError(400, "Project identifier is required.");
    }

    const form = await input.request.formData();
    const kindValue = readRequiredStringField(form, "kind", "Project kind");
    if (kindValue !== "health" && kindValue !== "infrastructure") {
      throw new ApiError(400, "Invalid project kind.");
    }
    const kind = kindValue as ProjectKind;

    const client = await supabaseServer();
    const resolved = await resolveScopedProject({
      client,
      scope: input.scope,
      scopeId: actor.scope.id!,
      projectIdOrRef,
    });
    if (resolved.conflict) {
      throw new ApiError(409, "Project reference is ambiguous within your scope.");
    }

    const project = resolved.project;
    if (!project) {
      throw new ApiError(404, "Project not found.");
    }
    if (project.category !== kind) {
      throw new ApiError(400, "Project kind does not match route payload.");
    }
    if (project.aipStatus !== "published") {
      throw new ApiError(
        403,
        "Add information is only allowed for projects under published AIPs."
      );
    }

    const status = parseProjectStatus(readRequiredStringField(form, "status", "Status"));
    const implementingOffice = readStringField(form, "implementingOffice");

    const coverFile = getSingleImageFile(form, "photoFile");
    if (coverFile) {
      assertImageFile(coverFile, "Project photo");
    }

    let uploadedCover: UploadedObjectRef | null = null;
    if (coverFile) {
      uploadedCover = await uploadImageToStorage({
        actor,
        aipId: project.aipId,
        projectId: project.id,
        file: coverFile,
      });
    }

    try {
      if (kind === "health") {
        const projectName = readRequiredStringField(form, "projectName", "Project name");
        const description = readStringField(form, "description");
        const targetParticipants = readRequiredStringField(
          form,
          "targetParticipants",
          "Target participants"
        );
        const totalTargetParticipants = parseNonNegativeInteger(
          readRequiredStringField(
            form,
            "totalTargetParticipants",
            "Total target participants"
          ),
          "Total target participants"
        );
        const budgetAllocated = parseMoneyLike(
          readRequiredStringField(form, "budgetAllocated", "Budget allocated"),
          "Budget allocated"
        );

        const { error: detailError } = await client.from("health_project_details").upsert(
          {
            project_id: project.id,
            program_name: projectName,
            description: description ?? null,
            target_participants: targetParticipants,
            total_target_participants: totalTargetParticipants,
            updated_by: actor.userId,
          },
          { onConflict: "project_id" }
        );
        if (detailError) {
          throw new ApiError(400, detailError.message);
        }

        const projectPatch: Record<string, unknown> = {
          total: budgetAllocated,
          status,
        };
        if (implementingOffice) {
          projectPatch.implementing_agency = implementingOffice;
        }
        if (uploadedCover) {
          projectPatch.image_url = uploadedCover.objectName;
        }

        const { error: projectError } = await client
          .from("projects")
          .update(projectPatch)
          .eq("id", project.id);
        if (projectError) {
          throw new ApiError(400, projectError.message);
        }
      } else {
        const projectName = readRequiredStringField(form, "projectName", "Project name");
        const startDate = normalizeDateInput(
          readRequiredStringField(form, "startDate", "Start date"),
          "Start date"
        );
        const targetCompletionDate = normalizeDateInput(
          readRequiredStringField(form, "targetCompletionDate", "Target completion date"),
          "Target completion date"
        );
        const contractorName = readRequiredStringField(
          form,
          "contractorName",
          "Contractor name"
        );
        const contractCost = parseMoneyLike(
          readRequiredStringField(form, "contractCost", "Contract cost"),
          "Contract cost"
        );
        const fundingSource = readStringField(form, "fundingSource");

        const { error: detailError } = await client
          .from("infrastructure_project_details")
          .upsert(
            {
              project_id: project.id,
              project_name: projectName,
              contractor_name: contractorName,
              contract_cost: contractCost,
              start_date: startDate,
              target_completion_date: targetCompletionDate,
              updated_by: actor.userId,
            },
            { onConflict: "project_id" }
          );
        if (detailError) {
          throw new ApiError(400, detailError.message);
        }

        const projectPatch: Record<string, unknown> = {
          start_date: startDate,
          completion_date: targetCompletionDate,
          total: contractCost,
          status,
        };
        if (implementingOffice) {
          projectPatch.implementing_agency = implementingOffice;
        }
        if (fundingSource) {
          projectPatch.source_of_funds = fundingSource;
        }
        if (uploadedCover) {
          projectPatch.image_url = uploadedCover.objectName;
        }

        const { error: projectError } = await client
          .from("projects")
          .update(projectPatch)
          .eq("id", project.id);
        if (projectError) {
          throw new ApiError(400, projectError.message);
        }
      }
    } catch (error) {
      if (uploadedCover) {
        await removeUploadedStorageRefs([uploadedCover], actor);
      }
      throw error;
    }

    try {
      const uploader = await loadUploaderSnapshot(client, actor.userId);
      const detailsLabel =
        kind === "health" ? "health project information" : "infrastructure project information";

      const { error: logError } = await client.rpc("log_activity", {
        p_action: "project_info_updated",
        p_entity_table: "projects",
        p_entity_id: project.id,
        p_region_id: null,
        p_province_id: null,
        p_city_id: project.cityId,
        p_municipality_id: null,
        p_barangay_id: project.barangayId,
        p_metadata: withWorkflowActivityMetadata(
          {
            details: `Updated ${detailsLabel} for ${project.aipRefCode}.`,
            project_kind: kind,
            project_status: status,
            implementing_office: implementingOffice,
            uploader_name: uploader.name,
            uploader_email: uploader.email,
            uploader_position: uploader.role,
          },
          { hideCrudAction: "project_record_updated" }
        ),
      });

      if (logError) {
        console.error("[PROJECT_ADD_INFO] activity log failed", {
          projectId: project.id,
          error: logError.message,
        });
      }
    } catch (error) {
      console.error("[PROJECT_ADD_INFO] activity log write threw", {
        projectId: project.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return NextResponse.json(
      { message: "Project information saved successfully." },
      { status: 200 }
    );
  } catch (error) {
    return toErrorResponse(error, "Failed to save project information.");
  }
}

export async function handlePostUpdateRequest(input: {
  request: Request;
  scope: RouteScope;
  projectIdOrRef: string;
}): Promise<Response> {
  try {
    const actor = await getActorContext();
    assertScopedActor(actor, input.scope);

    const projectIdOrRef = input.projectIdOrRef.trim();
    if (!projectIdOrRef) {
      throw new ApiError(400, "Project identifier is required.");
    }

    const form = await input.request.formData();
    const title = readRequiredStringField(form, "title", "Update title");
    const description = readRequiredStringField(form, "description", "Description");
    const progressRaw = readRequiredStringField(form, "progressPercent", "Progress percentage");
    const attendanceRaw = readStringField(form, "attendanceCount");

    if (title.length < 3) {
      throw new ApiError(400, "Update title must be at least 3 characters.");
    }
    if (description.length < 10) {
      throw new ApiError(400, "Description must be at least 10 characters.");
    }

    const progressPercent = parseNonNegativeInteger(progressRaw, "Progress percentage");
    if (progressPercent > 100) {
      throw new ApiError(400, "Progress percentage must not exceed 100.");
    }

    const photos = getMultiImageFiles(form, "photos");
    if (photos.length > MAX_UPDATE_PHOTOS) {
      throw new ApiError(400, `You can upload at most ${MAX_UPDATE_PHOTOS} photos.`);
    }
    for (const photo of photos) {
      assertImageFile(photo, "Update photo");
    }

    const client = await supabaseServer();
    const resolved = await resolveScopedProject({
      client,
      scope: input.scope,
      scopeId: actor.scope.id!,
      projectIdOrRef,
    });
    if (resolved.conflict) {
      throw new ApiError(409, "Project reference is ambiguous within your scope.");
    }

    const project = resolved.project;
    if (!project) {
      throw new ApiError(404, "Project not found.");
    }
    if (project.aipStatus !== "published") {
      throw new ApiError(
        403,
        "Posting updates is only allowed for projects under published AIPs."
      );
    }

    const attendanceCount = normalizeAttendanceForProjectCategory({
      projectCategory: project.category,
      attendanceRaw,
      parseNonNegativeInteger,
    });

    const { data: currentProgressRows, error: currentProgressError } = await client
      .from("project_updates")
      .select("progress_percent")
      .eq("project_id", project.id)
      .in("status", ["active", "hidden"])
      .order("progress_percent", { ascending: false })
      .limit(1);
    if (currentProgressError) {
      throw new ApiError(400, currentProgressError.message);
    }

    const currentBaselineProgress = getCurrentProgressBaseline(
      (currentProgressRows ?? []) as Array<{ progress_percent: number | null }>
    );
    if (!isStrictlyIncreasingProgress(progressPercent, currentBaselineProgress)) {
      throw new ApiError(
        400,
        `Progress percentage must be greater than current progress (${currentBaselineProgress}%).`
      );
    }

    const { data: insertedUpdate, error: insertUpdateError } = await client
      .from("project_updates")
      .insert({
        project_id: project.id,
        aip_id: project.aipId,
        title,
        description,
        progress_percent: progressPercent,
        attendance_count: attendanceCount,
        posted_by: actor.userId,
        status: "active",
      })
      .select("id,title,description,progress_percent,attendance_count,created_at")
      .single();
    if (insertUpdateError || !insertedUpdate) {
      throw new ApiError(
        400,
        insertUpdateError?.message ?? "Failed to create project update."
      );
    }

    const uploadedMediaRefs: UploadedObjectRef[] = [];
    let mediaRows:
      | Array<{ id: string; created_at: string }>
      | null = null;

    try {
      for (let index = 0; index < photos.length; index += 1) {
        const file = photos[index];
        const uploaded = await uploadImageToStorage({
          actor,
          aipId: project.aipId,
          projectId: project.id,
          updateId: insertedUpdate.id,
          index: index + 1,
          file,
        });
        uploadedMediaRefs.push(uploaded);
      }

      if (uploadedMediaRefs.length > 0) {
        const { data: insertedMediaRows, error: insertMediaError } = await client
          .from("project_update_media")
          .insert(
            uploadedMediaRefs.map((ref) => ({
              update_id: insertedUpdate.id,
              project_id: project.id,
              bucket_id: ref.bucketId,
              object_name: ref.objectName,
              mime_type: ref.mimeType,
              size_bytes: ref.sizeBytes,
            }))
          )
          .select("id,created_at");
        if (insertMediaError) {
          throw new ApiError(400, insertMediaError.message);
        }
        mediaRows = (insertedMediaRows ?? []) as Array<{ id: string; created_at: string }>;
      }
    } catch (error) {
      await removeUploadedStorageRefs(uploadedMediaRefs, actor);
      await client.from("project_updates").delete().eq("id", insertedUpdate.id);
      throw error;
    }

    const photoUrls =
      (mediaRows ?? []).map((row) => toProjectUpdateMediaProxyUrl(row.id)) ?? [];

    const uploader = await loadUploaderSnapshot(client, actor.userId);
    const updateType = photoUrls.length > 0 ? "photo" : "update";
    const logMetadata = withWorkflowActivityMetadata({
      update_title: title,
      update_caption: project.aipRefCode,
      update_body: description,
      progress_percent: progressPercent,
      attendance_count: attendanceCount,
      media_urls: photoUrls,
      update_type: updateType,
      uploader_name: uploader.name,
      uploader_email: uploader.email,
      uploader_position: uploader.role,
    });

    const { error: logError } = await client.rpc("log_activity", {
      p_action: "project_updated",
      p_entity_table: "projects",
      p_entity_id: project.id,
      p_region_id: null,
      p_province_id: null,
      p_city_id: project.cityId,
      p_municipality_id: null,
      p_barangay_id: project.barangayId,
      p_metadata: logMetadata,
    });
    if (logError) {
      await client.from("project_updates").delete().eq("id", insertedUpdate.id);
      throw new ApiError(400, logError.message);
    }
    await notifySafely({
      eventType: "PROJECT_UPDATE_STATUS_CHANGED",
      scopeType: input.scope,
      entityType: "project_update",
      entityId: insertedUpdate.id,
      projectUpdateId: insertedUpdate.id,
      projectId: project.id,
      aipId: project.aipId,
      barangayId: project.barangayId,
      cityId: project.cityId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      transition: "draft->published",
    });

    return NextResponse.json(
      {
        message: "Project update posted successfully.",
        update: {
          id: insertedUpdate.id,
          title: insertedUpdate.title,
          date: toDateLabel(insertedUpdate.created_at),
          description: insertedUpdate.description,
          progressPercent: insertedUpdate.progress_percent,
          attendanceCount: insertedUpdate.attendance_count ?? undefined,
          photoUrls: photoUrls.length > 0 ? photoUrls : undefined,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error, "Failed to post project update.");
  }
}
