import type { Json, RoleType } from "@/lib/contracts/databasev2";

type ActivityScopeSnapshot =
  | {
      scope_type: "none";
      barangay_id: null;
      city_id: null;
      municipality_id: null;
    }
  | {
      scope_type: "barangay";
      barangay_id: string;
      city_id: null;
      municipality_id: null;
    }
  | {
      scope_type: "city";
      barangay_id: null;
      city_id: string;
      municipality_id: null;
    }
  | {
      scope_type: "municipality";
      barangay_id: null;
      city_id: null;
      municipality_id: string;
    };

type ActivityLogRow = {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  scope?: ActivityScopeSnapshot | null;
  metadata?: Json | null;
  actorRole?: RoleType | null;
  createdAt: string;
};

// TODO(P1-next): centralize shared mock ids in `mocks/fixtures/shared/*` when migrating AIP/Projects/Feedback.
export const ACTIVITY_LOG_FIXTURE: ActivityLogRow[] = [
  {
    id: "log_001",
    actorId: "user_001",
    actorRole: "barangay_official",
    action: "draft_created",
    entityType: "aip",
    entityId: "aip-2026-mamadid",
    scope: {
      scope_type: "barangay",
      barangay_id: "brgy_mamadid",
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: "Maria Santos",
      actor_position: "Barangay Captain",
      details:
        "Created new AIP draft document for Q1 2026. Initial budget allocation set at â‚±5,800,000.",
    },
    createdAt: "2026-01-20T14:30:00.000Z",
  },
  {
    id: "log_002",
    actorId: "user_002",
    actorRole: "barangay_official",
    action: "project_updated",
    entityType: "project",
    entityId: "PROJ-I-2026-001",
    scope: {
      scope_type: "barangay",
      barangay_id: "brgy_poblacion",
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: "Juan Dela Cruz",
      actor_position: "Barangay Official",
      details:
        "Posted update on Barangay Hall Renovation progress. Completion marked at 65%. Interior renovation phase started.",
    },
    createdAt: "2026-01-20T10:15:00.000Z",
  },
  {
    id: "log_003",
    actorId: "user_003",
    actorRole: "barangay_official",
    action: "submission_created",
    entityType: "upload",
    entityId: "upload_001",
    scope: {
      scope_type: "barangay",
      barangay_id: "brgy_mamadid",
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: "Ana Reyes",
      actor_position: "Barangay Secretary",
      details:
        'Submitted AIP document "Annual Investment Plan 2026 - Q1" for review. Document ID: AIP-2026-001.',
    },
    createdAt: "2026-01-19T16:45:00.000Z",
  },
  {
    id: "log_004",
    actorId: "user_004",
    actorRole: "barangay_official",
    action: "comment_replied",
    entityType: "feedback",
    entityId: "feedback_014",
    scope: {
      scope_type: "barangay",
      barangay_id: "brgy_sanisidro",
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: "Pedro Garcia",
      actor_position: "Barangay Councilor",
      details:
        "Replied to comment on infrastructure budget allocation. Provided additional clarification on roadwork materials and timeline.",
    },
    createdAt: "2026-01-19T11:20:00.000Z",
  },
  {
    id: "log_005",
    actorId: "user_002",
    actorRole: "barangay_official",
    action: "project_updated",
    entityType: "project",
    entityId: "PROJ-I-2026-001",
    scope: {
      scope_type: "barangay",
      barangay_id: "brgy_poblacion",
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: "Juan Dela Cruz",
      actor_position: "Barangay Official",
      details:
        "Posted update on Road Concreting Project - Purok 3. Progress: 45%. Foundation work completed.",
    },
    createdAt: "2026-01-18T15:00:00.000Z",
  },
  {
    id: "log_006",
    actorId: "user_001",
    actorRole: "barangay_official",
    action: "revision_uploaded",
    entityType: "upload",
    entityId: "upload_002",
    scope: {
      scope_type: "barangay",
      barangay_id: "brgy_mamadid",
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: "Maria Santos",
      actor_position: "Barangay Captain",
      details:
        "Uploaded revised version of AIP document addressing feedback from review committee.",
    },
    createdAt: "2026-01-18T09:00:00.000Z",
  },
  {
    id: "log_007",
    actorId: "user_003",
    actorRole: "barangay_official",
    action: "cancelled",
    entityType: "aip",
    entityId: "aip-2025-mamadid",
    scope: {
      scope_type: "barangay",
      barangay_id: "brgy_mamadid",
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: "Ana Reyes",
      actor_position: "Barangay Secretary",
      details:
        'Cancelled AIP submission "Q4 2025 Amendment" due to duplicate entry. Document marked as superseded.',
    },
    createdAt: "2026-01-17T14:15:00.000Z",
  },
  {
    id: "log_008",
    actorId: "user_004",
    actorRole: "barangay_official",
    action: "draft_created",
    entityType: "project",
    entityId: "PROJ-H-2026-001",
    scope: {
      scope_type: "barangay",
      barangay_id: "brgy_santisidro",
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: "Pedro Garcia",
      actor_position: "Barangay Councilor",
      details:
        'Created new health project draft: "Community Vaccination Drive 2026". Budget allocated: â‚±1,200,000.',
    },
    createdAt: "2026-01-17T10:30:00.000Z",
  },
  {
    id: "log_009",
    actorId: "user_002",
    actorRole: "city_official",
    action: "project_updated",
    entityType: "project",
    entityId: "PROJ-I-2026-002",
    scope: {
      scope_type: "city",
      barangay_id: null,
      city_id: "city_001",
      municipality_id: null,
    },
    metadata: {
      actor_name: "Engineer Roberto Cruz",
      actor_position: "City Planning Officer",
      details:
        "City-level update posted for Multi-Purpose Covered Court project. Site preparation started. Estimated timeline: 6 months.",
    },
    createdAt: "2026-01-16T16:20:00.000Z",
  },
  {
    id: "log_010",
    actorId: "user_001",
    actorRole: "barangay_official",
    action: "submission_created",
    entityType: "aip",
    entityId: "aip-2026-mamadid",
    scope: {
      scope_type: "barangay",
      barangay_id: "brgy_mamadid",
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: "Maria Santos",
      actor_position: "Barangay Captain",
      details:
        "Submitted infrastructure project proposal for drainage system improvement. Total contract: â‚±2,300,000.",
    },
    createdAt: "2026-01-16T13:00:00.000Z",
  },
  {
    id: "log_011",
    actorId: "admin_001",
    actorRole: "admin",
    action: "revision_requested",
    entityType: "aip",
    entityId: "aip-2026-city",
    scope: {
      scope_type: "none",
      barangay_id: null,
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: "System Admin",
      actor_position: "Administrator",
      details:
        "Requested revision for City-Wide AIP 2026 due to missing procurement schedule attachments.",
    },
    createdAt: "2026-01-15T09:45:00.000Z",
  },
  {
    id: "log_012",
    actorId: "admin_001",
    actorRole: "admin",
    action: "approval_granted",
    entityType: "aip",
    entityId: "aip-2026-poblacion",
    scope: {
      scope_type: "none",
      barangay_id: null,
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: "System Admin",
      actor_position: "Administrator",
      details:
        "Approved barangay AIP for publication after compliance checks. Review cycle completed with no outstanding issues.",
    },
    createdAt: "2026-01-14T12:10:00.000Z",
  },
  {
    id: "log_013",
    actorId: "user_002",
    actorRole: "city_official",
    action: "published",
    entityType: "aip",
    entityId: "aip-2025-city",
    scope: {
      scope_type: "city",
      barangay_id: null,
      city_id: "city_001",
      municipality_id: null,
    },
    metadata: {
      actor_name: "Engineer Roberto Cruz",
      actor_position: "City Planning Officer",
      details:
        "Published City-Wide Annual Investment Program 2025. Public access enabled for approved items.",
    },
    createdAt: "2026-01-13T08:05:00.000Z",
  },
  {
    id: "log_014",
    actorId: "citizen_001",
    actorRole: "citizen",
    action: "feedback_created",
    entityType: "feedback",
    entityId: "feedback_200",
    scope: {
      scope_type: "barangay",
      barangay_id: "brgy_mamadid",
      city_id: null,
      municipality_id: null,
    },
    metadata: {
      actor_name: "Citizen One",
      actor_position: "Citizen",
      details: "Created feedback entry (question).",
      target_type: "aip",
      feedback_kind: "question",
      parent_feedback_id: null,
      aip_id: "aip-2026-mamadid",
      project_id: null,
    },
    createdAt: "2026-01-12T09:15:00.000Z",
  },
];
