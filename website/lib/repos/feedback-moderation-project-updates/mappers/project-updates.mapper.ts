import { formatDate } from "@/lib/formatting";
import { toProjectUpdateMediaProxyUrl } from "@/lib/projects/media";
import type {
  AipRecord,
  BarangayRecord,
  CityRecord,
  MunicipalityRecord,
  ProfileRecord,
  ProjectRecord,
  ProjectUpdateDetailsModel,
  ProjectUpdateMediaRecord,
  ProjectUpdateRecord,
  ProjectUpdateRowModel,
  ProjectUpdateStatus,
  ProjectUpdateType,
} from "@/lib/repos/feedback-moderation-project-updates/types";

const normalizeUpdateType = (mediaCount: number): ProjectUpdateType => {
  if (mediaCount > 0) return "Photo";
  return "Update";
};

const normalizeStatus = (status: ProjectUpdateRecord["status"]): ProjectUpdateStatus => {
  if (status === "hidden") return "Hidden";
  return "Visible";
};

const toMediaUrl = (media: ProjectUpdateMediaRecord): string => {
  if (media.object_name.startsWith("/")) return media.object_name;
  return toProjectUpdateMediaProxyUrl(media.id);
};

const getLguName = (
  aip: AipRecord | undefined,
  cities: CityRecord[],
  barangays: BarangayRecord[],
  municipalities: MunicipalityRecord[]
) => {
  if (!aip) return "\u2014";
  if (aip.city_id) {
    return cities.find((row) => row.id === aip.city_id)?.name ?? "City";
  }
  if (aip.municipality_id) {
    return municipalities.find((row) => row.id === aip.municipality_id)?.name ?? "Municipality";
  }
  if (aip.barangay_id) {
    return barangays.find((row) => row.id === aip.barangay_id)?.name ?? "Barangay";
  }
  return "\u2014";
};

export function mapProjectUpdatesToRows(input: {
  updates: ProjectUpdateRecord[];
  media: ProjectUpdateMediaRecord[];
  projects: ProjectRecord[];
  aips: AipRecord[];
  profiles: ProfileRecord[];
  cities: CityRecord[];
  barangays: BarangayRecord[];
  municipalities: MunicipalityRecord[];
}): ProjectUpdateRowModel[] {
  const mediaByUpdateId = new Map<string, ProjectUpdateMediaRecord[]>();
  input.media.forEach((media) => {
    const list = mediaByUpdateId.get(media.update_id) ?? [];
    list.push(media);
    mediaByUpdateId.set(media.update_id, list);
  });

  return input.updates.map((update) => {
    const project = input.projects.find((row) => row.id === update.project_id);
    const aip = input.aips.find((row) => row.id === update.aip_id);
    const lguName = getLguName(aip, input.cities, input.barangays, input.municipalities);
    const profile = input.profiles.find((row) => row.id === update.posted_by);
    const mediaRows = mediaByUpdateId.get(update.id) ?? [];
    const updateType = normalizeUpdateType(mediaRows.length);
    const uploaderName = profile?.full_name ?? "Unknown";
    const uploaderPosition = profile?.role ? profile.role.replaceAll("_", " ") : null;
    const uploadedBy = uploaderPosition ? `${uploaderName} (${uploaderPosition})` : uploaderName;

    return {
      id: update.id,
      previewUrl: mediaRows[0] ? toMediaUrl(mediaRows[0]) : null,
      title: update.title || project?.program_project_description || "Project Update",
      caption: updateType === "Photo" ? "Media update" : null,
      lguName,
      uploadedBy,
      type: updateType,
      status: normalizeStatus(update.status),
      date: formatDate(update.created_at),
    };
  });
}

export function mapProjectUpdateToDetails(input: {
  update: ProjectUpdateRecord;
  media: ProjectUpdateMediaRecord[];
  project?: ProjectRecord | undefined;
  aip?: AipRecord | undefined;
  profile?: ProfileRecord | undefined;
  cities: CityRecord[];
  barangays: BarangayRecord[];
  municipalities: MunicipalityRecord[];
}): ProjectUpdateDetailsModel {
  const lguName = getLguName(input.aip, input.cities, input.barangays, input.municipalities);
  const mediaUrls = input.media.map((media) => toMediaUrl(media));
  const uploaderName = input.profile?.full_name ?? "Unknown";
  const uploaderEmail = input.profile?.email ?? null;
  const uploaderPosition = input.profile?.role ? input.profile.role.replaceAll("_", " ") : null;

  return {
    id: input.update.id,
    projectTitle: input.project?.program_project_description ?? "Project Update",
    lguName,
    updateTitle: input.update.title || "Project Update",
    updateCaption: mediaUrls.length > 0 ? "Media update" : null,
    updateContent: input.update.description || "No update content provided.",
    progressPercent: input.update.progress_percent,
    attendanceCount: input.update.attendance_count,
    attachments: mediaUrls,
    uploadedByName: uploaderName,
    uploadedByPosition: uploaderPosition,
    uploadedByEmail: uploaderEmail,
    uploadedAt: formatDate(input.update.created_at),
    status: normalizeStatus(input.update.status),
    hiddenReason: input.update.hidden_reason,
    violationCategory: input.update.hidden_violation_category,
  };
}
