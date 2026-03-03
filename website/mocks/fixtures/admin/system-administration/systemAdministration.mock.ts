import type { ActivityLogRow } from "@/lib/contracts/databasev2";
import type {
  SecuritySettings,
  SystemBannerDraft,
  SystemBannerPublished,
  SystemAdministrationAuditLog,
} from "@/lib/repos/system-administration/types";

const ADMIN_ID = "admin_001";

export const SYSTEM_ADMIN_SECURITY_SETTINGS: SecuritySettings = {
  passwordPolicy: {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialCharacters: true,
  },
  sessionTimeout: {
    timeoutValue: 30,
    timeUnit: "minutes",
    warningMinutes: 2,
  },
  loginAttemptLimits: {
    maxAttempts: 5,
    lockoutDuration: 15,
    lockoutUnit: "minutes",
  },
};

export const SYSTEM_ADMIN_BANNER_DRAFT: SystemBannerDraft = {
  title: "System Notice",
  message: "Scheduled maintenance will occur tonight from 9:00 PM to 11:00 PM.",
  severity: "Warning",
  startAt: null,
  endAt: null,
};

export const SYSTEM_ADMIN_BANNER_PUBLISHED: SystemBannerPublished = {
  ...SYSTEM_ADMIN_BANNER_DRAFT,
  publishedAt: "2026-02-13T09:00:00.000Z",
};

const createActivity = (input: ActivityLogRow): ActivityLogRow => ({ ...input });

export const SYSTEM_ADMIN_ACTIVITY_LOGS: SystemAdministrationAuditLog[] = [
  createActivity({
    id: "activity_security_001",
    actor_id: ADMIN_ID,
    actor_role: "admin",
    action: "security_settings_updated",
    entity_table: null,
    entity_id: null,
    region_id: null,
    province_id: null,
    city_id: null,
    municipality_id: null,
    barangay_id: null,
    metadata: {
      before: null,
      after: SYSTEM_ADMIN_SECURITY_SETTINGS,
      actor_name: "Admin Maria Rodriguez",
    },
    created_at: "2026-02-13T08:30:00.000Z",
  }),
  createActivity({
    id: "activity_banner_001",
    actor_id: ADMIN_ID,
    actor_role: "admin",
    action: "system_banner_published",
    entity_table: null,
    entity_id: null,
    region_id: null,
    province_id: null,
    city_id: null,
    municipality_id: null,
    barangay_id: null,
    metadata: {
      before: null,
      after: SYSTEM_ADMIN_BANNER_PUBLISHED,
      actor_name: "Admin Maria Rodriguez",
    },
    created_at: "2026-02-13T09:00:00.000Z",
  }),
];

