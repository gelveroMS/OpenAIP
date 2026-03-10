import type { FeedbackKind, ProjectCategory, RoleType } from "@/lib/contracts/databasev2";
import { AIP_IDS, PROJECT_IDS } from "@/mocks/fixtures/shared/id-contract.fixture";
import type {
  Dbv2ActivityLogRow,
  Dbv2AipRow,
  Dbv2BarangayRow,
  Dbv2CityRow,
  Dbv2FeedbackRow,
  Dbv2MunicipalityRow,
  Dbv2ProfileRow,
  Dbv2ProjectRow,
  FeedbackModerationDataset,
} from "@/lib/repos/feedback-moderation/types";

const ADMIN_ID = "admin_001";

const createProjectRow = (input: {
  id: string;
  aipId: string;
  description: string;
  category: ProjectCategory;
}): Dbv2ProjectRow => ({
  id: input.id,
  aip_id: input.aipId,
  extraction_artifact_id: null,
  project_key: input.id,
  aip_ref_code: input.id,
  program_project_description: input.description,
  implementing_agency: null,
  start_date: null,
  completion_date: null,
  expected_output: null,
  source_of_funds: null,
  personal_services: null,
  maintenance_and_other_operating_expenses: null,
  capital_outlay: null,
  total: null,
  climate_change_adaptation: null,
  climate_change_mitigation: null,
  cc_topology_code: null,
  prm_ncr_lgu_rm_objective_results_indicator: null,
  errors: null,
  category: input.category,
  sector_code: "SOC",
  is_human_edited: false,
  edited_by: null,
  edited_at: null,
  created_at: "2026-01-05T08:00:00.000Z",
  updated_at: "2026-01-05T08:00:00.000Z",
});

type FeedbackInput =
  | {
      targetType: "aip";
      aipId: string;
      projectId?: null;
      id: string;
      body: string;
      kind: FeedbackKind;
      authorId: string;
      createdAt: string;
      isPublic: boolean;
    }
  | {
      targetType: "project";
      aipId?: null;
      projectId: string;
      id: string;
      body: string;
      kind: FeedbackKind;
      authorId: string;
      createdAt: string;
      isPublic: boolean;
    };

const createFeedbackRow = (input: FeedbackInput): Dbv2FeedbackRow => {
  if (input.targetType === "aip") {
    return {
      id: input.id,
      target_type: "aip",
      aip_id: input.aipId,
      project_id: null,
      parent_feedback_id: null,
      source: "human",
      kind: input.kind,
      extraction_run_id: null,
      extraction_artifact_id: null,
      field_key: null,
      severity: null,
      body: input.body,
      is_public: input.isPublic,
      author_id: input.authorId,
      created_at: input.createdAt,
      updated_at: input.createdAt,
    } satisfies Dbv2FeedbackRow;
  }

  return {
    id: input.id,
    target_type: "project",
    aip_id: null,
    project_id: input.projectId,
    parent_feedback_id: null,
    source: "human",
    kind: input.kind,
    extraction_run_id: null,
    extraction_artifact_id: null,
    field_key: null,
    severity: null,
    body: input.body,
    is_public: input.isPublic,
    author_id: input.authorId,
    created_at: input.createdAt,
    updated_at: input.createdAt,
  } satisfies Dbv2FeedbackRow;
};

const CITY_FIXTURE: Dbv2CityRow[] = [
  {
    id: "city_qc",
    region_id: "region_001",
    province_id: null,
    psgc_code: "133900000",
    name: "Quezon City",
    is_independent: true,
    is_active: true,
    created_at: "2020-01-01T00:00:00.000Z",
  },
  {
    id: "city_mnl",
    region_id: "region_001",
    province_id: null,
    psgc_code: "133900001",
    name: "Manila",
    is_independent: true,
    is_active: true,
    created_at: "2020-01-01T00:00:00.000Z",
  },
];

const MUNICIPALITY_FIXTURE: Dbv2MunicipalityRow[] = [
  {
    id: "municipality_001",
    province_id: "province_001",
    psgc_code: "045600001",
    name: "San Mateo",
    is_active: true,
    created_at: "2020-01-01T00:00:00.000Z",
  },
];

const BARANGAY_FIXTURE: Dbv2BarangayRow[] = [
  {
    id: "brgy_sanisidro",
    city_id: "city_qc",
    municipality_id: null,
    psgc_code: "133900001",
    name: "Barangay San Isidro",
    is_active: true,
    created_at: "2020-01-01T00:00:00.000Z",
  },
  {
    id: "brgy_poblacion",
    city_id: "city_mnl",
    municipality_id: null,
    psgc_code: "133900002",
    name: "Barangay Poblacion",
    is_active: true,
    created_at: "2020-01-01T00:00:00.000Z",
  },
  {
    id: "brgy_mamadid",
    city_id: null,
    municipality_id: "municipality_001",
    psgc_code: "045600009",
    name: "Barangay Mamadid",
    is_active: true,
    created_at: "2020-01-01T00:00:00.000Z",
  },
];

const PROFILE_FIXTURE: Dbv2ProfileRow[] = [
  {
    id: "profile_juan",
    role: "citizen",
    full_name: "Juan Dela Cruz",
    email: "juan.delacruz@example.com",
    barangay_id: "brgy_sanisidro",
    city_id: null,
    municipality_id: null,
    is_active: true,
    created_at: "2025-11-01T08:00:00.000Z",
    updated_at: "2026-02-01T08:00:00.000Z",
  },
  {
    id: "profile_maria",
    role: "citizen",
    full_name: "Maria Santos",
    email: "maria.santos@example.com",
    barangay_id: "brgy_poblacion",
    city_id: null,
    municipality_id: null,
    is_active: true,
    created_at: "2025-11-10T08:00:00.000Z",
    updated_at: "2026-02-01T08:00:00.000Z",
  },
  {
    id: "profile_elena",
    role: "city_official",
    full_name: "Elena Reyes",
    email: "elena.reyes@example.com",
    barangay_id: null,
    city_id: "city_qc",
    municipality_id: null,
    is_active: true,
    created_at: "2025-11-15T08:00:00.000Z",
    updated_at: "2026-02-01T08:00:00.000Z",
  },
  {
    id: "profile_ana",
    role: "citizen",
    full_name: "Ana Lopez",
    email: "ana.lopez@example.com",
    barangay_id: "brgy_mamadid",
    city_id: null,
    municipality_id: null,
    is_active: true,
    created_at: "2025-11-18T08:00:00.000Z",
    updated_at: "2026-02-01T08:00:00.000Z",
  },
  {
    id: ADMIN_ID,
    role: "admin" as RoleType,
    full_name: "System Admin",
    email: "admin@openaip.local",
    barangay_id: null,
    city_id: null,
    municipality_id: null,
    is_active: true,
    created_at: "2025-10-01T08:00:00.000Z",
    updated_at: "2026-02-01T08:00:00.000Z",
  },
];

const AIP_FIXTURE: Dbv2AipRow[] = [
  {
    id: AIP_IDS.city_2026,
    fiscal_year: 2026,
    barangay_id: null,
    city_id: "city_qc",
    municipality_id: null,
    status: "published",
    status_updated_at: "2026-02-01T08:00:00.000Z",
    submitted_at: "2026-01-10T08:00:00.000Z",
    published_at: "2026-02-01T08:00:00.000Z",
    created_by: "profile_elena",
    created_at: "2026-01-05T08:00:00.000Z",
    updated_at: "2026-02-01T08:00:00.000Z",
  },
  {
    id: AIP_IDS.barangay_mamadid_2026,
    fiscal_year: 2026,
    barangay_id: "brgy_mamadid",
    city_id: null,
    municipality_id: "municipality_001",
    status: "published",
    status_updated_at: "2026-02-01T08:00:00.000Z",
    submitted_at: "2026-01-12T08:00:00.000Z",
    published_at: "2026-02-01T08:00:00.000Z",
    created_by: "profile_ana",
    created_at: "2026-01-08T08:00:00.000Z",
    updated_at: "2026-02-01T08:00:00.000Z",
  },
];

const PROJECT_FIXTURE: Dbv2ProjectRow[] = [
  createProjectRow({
    id: PROJECT_IDS.infra_road_rehab_2026_001,
    aipId: AIP_IDS.city_2026,
    description: "Road Improvement - Barangay 5",
    category: "infrastructure",
  }),
  createProjectRow({
    id: PROJECT_IDS.infra_drainage_2026_003,
    aipId: AIP_IDS.city_2026,
    description: "Water System Upgrade",
    category: "infrastructure",
  }),
  createProjectRow({
    id: PROJECT_IDS.infra_public_market_2026_007,
    aipId: AIP_IDS.city_2026,
    description: "Community Center",
    category: "infrastructure",
  }),
  createProjectRow({
    id: PROJECT_IDS.health_vaccination_2026_001,
    aipId: AIP_IDS.barangay_mamadid_2026,
    description: "Health Center Renovation",
    category: "health",
  }),
];

const FEEDBACK_FIXTURE: Dbv2FeedbackRow[] = [
  createFeedbackRow({
    id: "feedback_001",
    targetType: "project",
    projectId: PROJECT_IDS.infra_road_rehab_2026_001,
    body: "The road improvement project is taking too long. When will it be finished? This is affecting our daily commute and business operations.",
    kind: "question",
    authorId: "profile_juan",
    createdAt: "2026-02-10T08:15:00.000Z",
    isPublic: true,
  }),
  createFeedbackRow({
    id: "feedback_002",
    targetType: "project",
    projectId: PROJECT_IDS.infra_drainage_2026_003,
    body: "Thank you for the new water system! Clean water is now available in our area. Great job to the LGU!",
    kind: "commend",
    authorId: "profile_maria",
    createdAt: "2026-02-11T09:45:00.000Z",
    isPublic: true,
  }),
  createFeedbackRow({
    id: "feedback_003",
    targetType: "project",
    projectId: PROJECT_IDS.infra_public_market_2026_007,
    body: "Pangit!!!",
    kind: "concern",
    authorId: "profile_maria",
    createdAt: "2026-02-08T06:30:00.000Z",
    isPublic: false,
  }),
  createFeedbackRow({
    id: "feedback_004",
    targetType: "project",
    projectId: PROJECT_IDS.health_vaccination_2026_001,
    body: "The health center is well-maintained. Staff are friendly and professional.",
    kind: "commend",
    authorId: "profile_elena",
    createdAt: "2026-02-12T11:15:00.000Z",
    isPublic: true,
  }),
  createFeedbackRow({
    id: "feedback_005",
    targetType: "aip",
    aipId: AIP_IDS.city_2026,
    body: "Why is the construction so slow? Are you people even working? This is a waste of taxpayer money!",
    kind: "concern",
    authorId: "profile_juan",
    createdAt: "2026-02-09T10:00:00.000Z",
    isPublic: false,
  }),
  createFeedbackRow({
    id: "feedback_006",
    targetType: "aip",
    aipId: AIP_IDS.barangay_mamadid_2026,
    body: "Great initiative! The new playground is safe for children. Thank you!",
    kind: "commend",
    authorId: "profile_ana",
    createdAt: "2026-02-13T07:25:00.000Z",
    isPublic: true,
  }),
];

const ACTIVITY_LOG_FIXTURE: Dbv2ActivityLogRow[] = [
  {
    id: "activity_001",
    actor_id: ADMIN_ID,
    actor_role: "admin",
    action: "feedback_hidden",
    entity_table: "feedback",
    entity_id: "feedback_003",
    region_id: null,
    province_id: null,
    city_id: "city_mnl",
    municipality_id: null,
    barangay_id: "brgy_poblacion",
    metadata: {
      reason: "Contains disrespectful language.",
      violation_category: "Offensive Language",
    },
    created_at: "2026-02-08T10:05:00.000Z",
  },
  {
    id: "activity_002",
    actor_id: ADMIN_ID,
    actor_role: "admin",
    action: "feedback_hidden",
    entity_table: "feedback",
    entity_id: "feedback_005",
    region_id: null,
    province_id: null,
    city_id: "city_qc",
    municipality_id: null,
    barangay_id: null,
    metadata: {
      reason: "Flagged for misinformation and harassment.",
      violation_category: "Misinformation",
    },
    created_at: "2026-02-09T12:00:00.000Z",
  },
];

export const FEEDBACK_MODERATION_DATASET: FeedbackModerationDataset = {
  feedback: FEEDBACK_FIXTURE,
  activity: ACTIVITY_LOG_FIXTURE,
  profiles: PROFILE_FIXTURE,
  aips: AIP_FIXTURE,
  projects: PROJECT_FIXTURE,
  cities: CITY_FIXTURE,
  barangays: BARANGAY_FIXTURE,
  municipalities: MUNICIPALITY_FIXTURE,
};
