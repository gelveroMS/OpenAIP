import type { AipRow, AipReviewRow, ActivityLogRow } from "@/lib/contracts/databasev2";
import { AIP_IDS } from "@/mocks/fixtures/shared/id-contract.fixture";

export const ADMIN_CITY_IDS = {
  cabuyao: "00000000-0000-0000-0000-000000000401",
} as const;

export const ADMIN_BARANGAY_IDS = {
  mamadid: "00000000-0000-0000-0000-000000000501",
  poblacion: "00000000-0000-0000-0000-000000000502",
  sanisidro: "00000000-0000-0000-0000-000000000503",
} as const;

const AIP_CREATED_BY_IDS = {
  city001: "00000000-0000-0000-0000-000000000601",
  brgy001: "00000000-0000-0000-0000-000000000602",
  city002: "00000000-0000-0000-0000-000000000603",
  brgy003: "00000000-0000-0000-0000-000000000604",
  brgy004: "00000000-0000-0000-0000-000000000605",
} as const;

const REVIEWER_IDS = {
  reviewer001: "00000000-0000-0000-0000-000000000701",
  reviewer002: "00000000-0000-0000-0000-000000000702",
  reviewer003: "00000000-0000-0000-0000-000000000703",
  reviewer004: "00000000-0000-0000-0000-000000000704",
} as const;

const ADMIN_ACTOR_ID = "00000000-0000-0000-0000-000000000801";

export const AIP_MONITORING_LGU_NAMES: Record<string, string> = {
  [AIP_IDS.city_2026]: "City of Cabuyao",
  [AIP_IDS.city_2025]: "City of Cabuyao",
  [AIP_IDS.barangay_mamadid_2026]: "Brgy. Mamadid",
  [AIP_IDS.barangay_poblacion_2026]: "Brgy. Poblacion",
  [AIP_IDS.barangay_sanisidro_2026]: "Brgy. San Isidro",
};

export const AIP_MONITORING_BUDGET_TOTAL_BY_AIP_ID: Record<string, number> = {
  [AIP_IDS.city_2026]: 65824308.28,
  [AIP_IDS.city_2025]: 61200000,
  [AIP_IDS.barangay_mamadid_2026]: 15400000,
  [AIP_IDS.barangay_poblacion_2026]: 12950000,
  [AIP_IDS.barangay_sanisidro_2026]: 14120000,
};

export const AIP_MONITORING_AIPS: AipRow[] = [
  {
    id: AIP_IDS.city_2026,
    fiscal_year: 2026,
    barangay_id: null,
    city_id: ADMIN_CITY_IDS.cabuyao,
    municipality_id: null,
    status: "under_review",
    status_updated_at: "2026-01-03T00:00:00.000Z",
    submitted_at: "2025-12-28T00:00:00.000Z",
    published_at: null,
    created_by: AIP_CREATED_BY_IDS.city001,
    created_at: "2025-12-20T00:00:00.000Z",
    updated_at: "2026-02-05T00:00:00.000Z",
  },
  {
    id: AIP_IDS.barangay_mamadid_2026,
    fiscal_year: 2026,
    barangay_id: ADMIN_BARANGAY_IDS.mamadid,
    city_id: null,
    municipality_id: null,
    status: "pending_review",
    status_updated_at: "2026-01-10T00:00:00.000Z",
    submitted_at: "2026-01-10T00:00:00.000Z",
    published_at: null,
    created_by: AIP_CREATED_BY_IDS.brgy001,
    created_at: "2026-01-10T00:00:00.000Z",
    updated_at: "2026-01-20T00:00:00.000Z",
  },
  {
    id: AIP_IDS.city_2025,
    fiscal_year: 2025,
    barangay_id: null,
    city_id: ADMIN_CITY_IDS.cabuyao,
    municipality_id: null,
    status: "published",
    status_updated_at: "2025-01-12T00:00:00.000Z",
    submitted_at: "2024-12-22T00:00:00.000Z",
    published_at: "2025-01-12T00:00:00.000Z",
    created_by: AIP_CREATED_BY_IDS.city002,
    created_at: "2024-12-22T00:00:00.000Z",
    updated_at: "2025-01-12T00:00:00.000Z",
  },
  {
    id: AIP_IDS.barangay_sanisidro_2026,
    fiscal_year: 2026,
    barangay_id: ADMIN_BARANGAY_IDS.sanisidro,
    city_id: null,
    municipality_id: null,
    status: "for_revision",
    status_updated_at: "2026-01-15T00:00:00.000Z",
    submitted_at: "2025-12-30T00:00:00.000Z",
    published_at: null,
    created_by: AIP_CREATED_BY_IDS.brgy003,
    created_at: "2025-12-30T00:00:00.000Z",
    updated_at: "2026-01-18T00:00:00.000Z",
  },
  {
    id: AIP_IDS.barangay_poblacion_2026,
    fiscal_year: 2026,
    barangay_id: ADMIN_BARANGAY_IDS.poblacion,
    city_id: null,
    municipality_id: null,
    status: "under_review",
    status_updated_at: "2025-12-20T00:00:00.000Z",
    submitted_at: "2025-12-05T00:00:00.000Z",
    published_at: null,
    created_by: AIP_CREATED_BY_IDS.brgy004,
    created_at: "2025-12-05T00:00:00.000Z",
    updated_at: "2026-02-07T00:00:00.000Z",
  },
];

export const REVIEWER_DIRECTORY: Record<string, { name: string }> = {
  [REVIEWER_IDS.reviewer001]: { name: "Maria Santos" },
  [REVIEWER_IDS.reviewer002]: { name: "Jose Reyes" },
  [REVIEWER_IDS.reviewer003]: { name: "Ana Garcia" },
  [REVIEWER_IDS.reviewer004]: { name: "Carmen Lopez" },
};

export const AIP_MONITORING_REVIEWS: AipReviewRow[] = [
  {
    id: "00000000-0000-0000-0000-000000000901",
    aip_id: AIP_IDS.city_2026,
    action: "request_revision",
    note: "Missing procurement schedule attachments.",
    reviewer_id: REVIEWER_IDS.reviewer001,
    created_at: "2026-01-17T08:30:00.000Z",
  },
  {
    id: "00000000-0000-0000-0000-000000000902",
    aip_id: AIP_IDS.city_2025,
    action: "approve",
    note: null,
    reviewer_id: REVIEWER_IDS.reviewer002,
    created_at: "2025-01-10T10:00:00.000Z",
  },
  {
    id: "00000000-0000-0000-0000-000000000903",
    aip_id: AIP_IDS.barangay_sanisidro_2026,
    action: "request_revision",
    note: "Itemize the medical equipment budget.",
    reviewer_id: REVIEWER_IDS.reviewer003,
    created_at: "2026-01-14T13:45:00.000Z",
  },
  {
    id: "00000000-0000-0000-0000-000000000904",
    aip_id: AIP_IDS.barangay_poblacion_2026,
    action: "request_revision",
    note: "Awaiting workflow integrity review.",
    reviewer_id: REVIEWER_IDS.reviewer004,
    created_at: "2026-01-20T09:10:00.000Z",
  },
];

export const AIP_MONITORING_ACTIVITY: ActivityLogRow[] = [
  {
    id: "00000000-0000-0000-0000-000000001001",
    actor_id: ADMIN_ACTOR_ID,
    actor_role: "admin",
    action: "workflow_case",
    entity_table: "aips",
    entity_id: AIP_IDS.barangay_mamadid_2026,
    region_id: null,
    province_id: null,
    city_id: null,
    municipality_id: null,
    barangay_id: ADMIN_BARANGAY_IDS.mamadid,
    metadata: {
      case_type: "Stuck",
      duration_days: 35,
      claimed_by: "Maria Santos",
      last_updated_at: "2026-02-02",
    },
    created_at: "2026-02-02T08:00:00.000Z",
  },
  {
    id: "00000000-0000-0000-0000-000000001002",
    actor_id: ADMIN_ACTOR_ID,
    actor_role: "admin",
    action: "workflow_case",
    entity_table: "aips",
    entity_id: AIP_IDS.city_2025,
    region_id: null,
    province_id: null,
    city_id: ADMIN_CITY_IDS.cabuyao,
    municipality_id: null,
    barangay_id: null,
    metadata: {
      case_type: "Duplicate",
      duration_days: 14,
      claimed_by: null,
      last_updated_at: "2026-01-26",
    },
    created_at: "2026-01-26T07:00:00.000Z",
  },
  {
    id: "00000000-0000-0000-0000-000000001003",
    actor_id: ADMIN_ACTOR_ID,
    actor_role: "admin",
    action: "workflow_case",
    entity_table: "aips",
    entity_id: AIP_IDS.barangay_poblacion_2026,
    region_id: null,
    province_id: null,
    city_id: null,
    municipality_id: null,
    barangay_id: ADMIN_BARANGAY_IDS.poblacion,
    metadata: {
      case_type: "Locked",
      duration_days: 60,
      claimed_by: "Carmen Lopez",
      last_updated_at: "2026-02-07",
    },
    created_at: "2026-02-07T09:00:00.000Z",
  },
];

export type AipMonitoringDetail = {
  fileName: string;
  pdfUrl?: string;
  summaryText: string;
  detailedBullets: string[];
  durationDays?: number;
  submissionHistory: { year: number; submittedDate: string; status: string }[];
  archivedSubmissions: {
    year: number;
    submittedDate: string;
    archivedDate: string;
    reason: string;
  }[];
  timeline: { label: string; date: string; note?: string }[];
};

export const AIP_MONITORING_DETAILS: Record<string, AipMonitoringDetail> = {
  [AIP_IDS.city_2026]: {
    fileName: "Cabuyao_AIP_2026.pdf",
    pdfUrl: "C:\\Users\\User\\Documents\\COLLEGE\\THESIS\\OpenAIP\\public\\mock\\sample.pdf",
    durationDays: 42,
    summaryText:
      "This AIP focuses on infrastructure rehabilitation, community health programs, and socio-economic initiatives aligned with the city's development priorities.",
    detailedBullets: [
      "Road rehabilitation and traffic decongestion projects",
      "Expansion of community health facilities and services",
      "Social protection programs for vulnerable sectors",
      "Economic development and livelihood support initiatives",
      "Environmental management and disaster resilience measures",
    ],
    submissionHistory: [
      { year: 2026, submittedDate: "2025-12-28", status: "In Review" },
      { year: 2025, submittedDate: "2024-12-20", status: "Approved" },
    ],
    archivedSubmissions: [
      {
        year: 2023,
        submittedDate: "2022-12-15",
        archivedDate: "2024-01-10",
        reason: "Superseded by FY 2024 rebaselining.",
      },
    ],
    timeline: [
      { label: "Submitted", date: "Dec 28, 2025" },
      { label: "In Review", date: "Jan 03, 2026" },
      { label: "Reviewer Notes Added", date: "Jan 17, 2026" },
      { label: "Pending Approval", date: "Feb 01, 2026" },
    ],
  },
  [AIP_IDS.barangay_mamadid_2026]: {
    fileName: "Brgy_Mamadid_AIP_2026.pdf",
    pdfUrl: "C:\\Users\\User\\Documents\\COLLEGE\\THESIS\\OpenAIP\\public\\mock\\sample.pdf",
    durationDays: 18,
    summaryText:
      "Annual investment plan emphasizing barangay facility upgrades, peace and order programs, and youth development initiatives.",
    detailedBullets: [
      "Barangay hall repairs and facility upgrades",
      "Peace and order patrol equipment procurement",
      "Youth skills training and scholarship support",
      "Drainage and flood mitigation improvements",
      "Community wellness programs",
    ],
    submissionHistory: [
      { year: 2026, submittedDate: "2026-01-10", status: "Pending" },
      { year: 2025, submittedDate: "2024-12-12", status: "Approved" },
    ],
    archivedSubmissions: [],
    timeline: [
      { label: "Submitted", date: "Jan 10, 2026" },
      { label: "Pending Review", date: "Jan 10, 2026" },
    ],
  },
  [AIP_IDS.city_2025]: {
    fileName: "City_AIP_2025.pdf",
    pdfUrl: "C:\\Users\\User\\Documents\\COLLEGE\\THESIS\\OpenAIP\\public\\mock\\sample.pdf",
    durationDays: 10,
    summaryText:
      "City-wide AIP focused on transport infrastructure, public health investments, and economic resilience programs.",
    detailedBullets: [
      "Public transport hub modernization",
      "Hospital equipment upgrades",
      "Small business support programs",
      "Road safety enhancements",
      "Public market redevelopment",
    ],
    submissionHistory: [
      { year: 2025, submittedDate: "2024-12-22", status: "Approved" },
    ],
    archivedSubmissions: [],
    timeline: [
      { label: "Submitted", date: "Dec 22, 2024" },
      { label: "In Review", date: "Jan 02, 2025" },
      { label: "Approved", date: "Jan 12, 2025" },
    ],
  },
  [AIP_IDS.barangay_sanisidro_2026]: {
    fileName: "Brgy_SanIsidro_AIP_2026.pdf",
    pdfUrl: "C:\\Users\\User\\Documents\\COLLEGE\\THESIS\\OpenAIP\\public\\mock\\sample.pdf",
    durationDays: 27,
    summaryText:
      "Barangay investment plan with focus on community facilities, youth development, and sanitation improvements.",
    detailedBullets: [
      "Multi-purpose hall improvements",
      "Sanitation and waste management equipment",
      "Youth livelihood training support",
      "Street lighting installation",
      "Health and nutrition programs",
    ],
    submissionHistory: [
      { year: 2026, submittedDate: "2025-12-30", status: "For Revision" },
    ],
    archivedSubmissions: [],
    timeline: [
      { label: "Submitted", date: "Dec 30, 2025" },
      { label: "In Review", date: "Jan 05, 2026" },
      { label: "For Revision", date: "Jan 15, 2026" },
    ],
  },
  [AIP_IDS.barangay_poblacion_2026]: {
    fileName: "Brgy_Poblacion_AIP_2026.pdf",
    pdfUrl: "C:\\Users\\User\\Documents\\COLLEGE\\THESIS\\OpenAIP\\public\\mock\\sample.pdf",
    durationDays: 70,
    summaryText:
      "Locked AIP submission due to workflow integrity case; awaiting admin action before resuming review.",
    detailedBullets: [
      "Central business district enhancements",
      "Social services expansion",
      "Flood mitigation projects",
      "Public school facility upgrades",
      "Disaster resilience investments",
    ],
    submissionHistory: [
      { year: 2026, submittedDate: "2025-12-05", status: "Locked" },
    ],
    archivedSubmissions: [],
    timeline: [
      { label: "Submitted", date: "Dec 05, 2025" },
      { label: "In Review", date: "Dec 12, 2025" },
      { label: "Locked", date: "Dec 20, 2025" },
    ],
  },
};
