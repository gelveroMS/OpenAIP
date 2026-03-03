import type { ActivityLogRow, RoleType, Json } from "@/lib/contracts/databasev2";
import { PROJECT_IDS } from "@/mocks/fixtures/shared/id-contract.fixture";
import { FEEDBACK_MODERATION_DATASET } from "@/mocks/fixtures/admin/feedback-moderation/feedbackModeration.mock";
import type {
  ModerationActionRecord,
} from "@/lib/repos/feedback-moderation-project-updates/types";

const ADMIN_ID = "admin_001";

const makeUpdateLog = (input: {
  id: string;
  actorId: string;
  actorRole: RoleType | null;
  projectId: string;
  cityId?: string | null;
  municipalityId?: string | null;
  barangayId?: string | null;
  createdAt: string;
  metadata: Record<string, Json>;
}): ActivityLogRow => ({
  id: input.id,
  actor_id: input.actorId,
  actor_role: input.actorRole,
  action: "project_updated",
  entity_table: "projects",
  entity_id: input.projectId,
  region_id: null,
  province_id: null,
  city_id: input.cityId ?? null,
  municipality_id: input.municipalityId ?? null,
  barangay_id: input.barangayId ?? null,
  metadata: input.metadata,
  created_at: input.createdAt,
});

const makeModerationAction = (input: {
  id: string;
  action: "project_update_hidden" | "project_update_unhidden";
  updateLogId: string;
  createdAt: string;
  reason: string;
  violationCategory?: string | null;
}): ActivityLogRow => ({
  id: input.id,
  actor_id: ADMIN_ID,
  actor_role: "admin",
  action: input.action,
  entity_table: "project_updates",
  entity_id: input.updateLogId,
  region_id: null,
  province_id: null,
  city_id: null,
  municipality_id: null,
  barangay_id: null,
  metadata: {
    reason: input.reason,
    violation_category: input.violationCategory ?? null,
  },
  created_at: input.createdAt,
});

export const PROJECT_UPDATE_LOGS: ActivityLogRow[] = [
  makeUpdateLog({
    id: "update_log_001",
    actorId: "profile_juan",
    actorRole: "barangay_official",
    projectId: PROJECT_IDS.health_vaccination_2026_001,
    municipalityId: "municipality_001",
    barangayId: "brgy_mamadid",
    createdAt: "2026-02-10T08:30:00.000Z",
    metadata: {
      update_title: "First vaccination drive completed",
      update_caption: "Community Vaccination Program",
      update_body:
        "Successfully conducted the first vaccination drive at Barangay Hall. Reached 450 residents with high community participation.",
      progress_percent: 50,
      attendance_count: 450,
      media_urls: ["/mock/health/health1.jpg", "/mock/health/health2.jpg"],
      update_type: "photo",
      uploader_name: "Juan Santos",
      uploader_email: "juan.santos@barangay.gov.ph",
      uploader_position: "Barangay Captain",
    },
  }),
  makeUpdateLog({
    id: "update_log_002",
    actorId: "profile_maria",
    actorRole: "city_official",
    projectId: PROJECT_IDS.infra_road_rehab_2026_001,
    cityId: "city_qc",
    createdAt: "2026-02-08T10:00:00.000Z",
    metadata: {
      update_title: "Attendance sheets uploaded",
      update_caption: "Road Rehabilitation",
      update_body:
        "Uploaded attendance sheets from on-site briefing. Contractors and residents present for the kickoff meeting.",
      progress_percent: 20,
      attendance_count: 120,
      media_urls: ["/mock/health/health3.jpg"],
      update_type: "photo",
      uploader_name: "Maria Reyes",
      uploader_email: "maria.reyes@cityhall.gov.ph",
      uploader_position: "Project Coordinator",
    },
  }),
  makeUpdateLog({
    id: "update_log_003",
    actorId: "profile_elena",
    actorRole: "city_official",
    projectId: PROJECT_IDS.infra_public_market_2026_007,
    cityId: "city_mnl",
    createdAt: "2026-02-13T09:15:00.000Z",
    metadata: {
      update_title: "Health office visit",
      update_caption: "Public Market Improvement",
      update_body:
        "Public relations team visited the site to coordinate with vendors. Documentation shared for compliance review.",
      progress_percent: 35,
      attendance_count: 80,
      media_urls: [],
      update_type: "update",
      uploader_name: "Elena Cruz",
      uploader_email: "elena.cruz@cityhall.gov.ph",
      uploader_position: "Public Relations",
    },
  }),
];

export const PROJECT_UPDATE_ACTIONS: ModerationActionRecord[] = [
  makeModerationAction({
    id: "update_action_001",
    action: "project_update_hidden",
    updateLogId: "update_log_002",
    createdAt: "2026-02-09T12:10:00.000Z",
    reason: "Contains personal identifiers and signatures of participants.",
    violationCategory: "Government IDs & Signatures",
  }),
  makeModerationAction({
    id: "update_action_002",
    action: "project_update_hidden",
    updateLogId: "update_log_003",
    createdAt: "2026-02-13T11:30:00.000Z",
    reason: "Contains policy-sensitive imagery pending correction.",
    violationCategory: "Inappropriate Images",
  }),
];

export const PROJECT_UPDATE_LGU_MAP = {
  aips: FEEDBACK_MODERATION_DATASET.aips,
  projects: FEEDBACK_MODERATION_DATASET.projects,
  profiles: FEEDBACK_MODERATION_DATASET.profiles,
  cities: FEEDBACK_MODERATION_DATASET.cities,
  barangays: FEEDBACK_MODERATION_DATASET.barangays,
  municipalities: FEEDBACK_MODERATION_DATASET.municipalities,
};
