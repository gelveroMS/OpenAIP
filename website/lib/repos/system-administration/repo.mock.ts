import type { ActivityLogRow } from "@/lib/contracts/databasev2";
import {
  SYSTEM_ADMIN_ACTIVITY_LOGS,
  SYSTEM_ADMIN_BANNER_DRAFT,
  SYSTEM_ADMIN_BANNER_PUBLISHED,
  SYSTEM_ADMIN_SECURITY_SETTINGS,
} from "@/mocks/fixtures/admin/system-administration/systemAdministration.mock";
import type {
  SecuritySettings,
  SystemAdministrationRepo,
  SystemAdministrationUpdateMeta,
  SystemBannerDraft,
  SystemBannerPublished,
} from "./types";

type SystemAdministrationStore = {
  security: SecuritySettings;
  bannerDraft: SystemBannerDraft;
  bannerPublished: SystemBannerPublished | null;
  activity: ActivityLogRow[];
};

let idCounter = 0;

const nowIso = () => new Date().toISOString();

const createId = (prefix: string) => {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
};

const cloneSettings = (): SystemAdministrationStore => ({
  security: {
    ...SYSTEM_ADMIN_SECURITY_SETTINGS,
    passwordPolicy: { ...SYSTEM_ADMIN_SECURITY_SETTINGS.passwordPolicy },
    sessionTimeout: { ...SYSTEM_ADMIN_SECURITY_SETTINGS.sessionTimeout },
    loginAttemptLimits: { ...SYSTEM_ADMIN_SECURITY_SETTINGS.loginAttemptLimits },
  },
  bannerDraft: { ...SYSTEM_ADMIN_BANNER_DRAFT },
  bannerPublished: { ...SYSTEM_ADMIN_BANNER_PUBLISHED },
  activity: SYSTEM_ADMIN_ACTIVITY_LOGS.map((row) => ({ ...row })),
});

const store: SystemAdministrationStore = cloneSettings();

const appendActivity = (input: ActivityLogRow) => {
  store.activity = [...store.activity, input];
};

const resolveActorName = (meta?: SystemAdministrationUpdateMeta) =>
  meta?.performedBy ?? "Admin Maria Rodriguez";

const resolvePerformedAt = (meta?: SystemAdministrationUpdateMeta) => meta?.performedAt ?? nowIso();

const createAuditEntry = (
  action: string,
  metadata: Record<string, unknown>,
  meta?: SystemAdministrationUpdateMeta
): ActivityLogRow => ({
  id: createId("activity"),
  actor_id: "admin_001",
  actor_role: "admin",
  action,
  entity_table: null,
  entity_id: null,
  region_id: null,
  province_id: null,
  city_id: null,
  municipality_id: null,
  barangay_id: null,
  metadata: {
    ...metadata,
    actor_name: resolveActorName(meta),
  },
  created_at: resolvePerformedAt(meta),
});

export function createMockSystemAdministrationRepo(): SystemAdministrationRepo {
  return {
    async getSecuritySettings() {
      return { ...store.security };
    },
    async updateSecuritySettings(next, meta) {
      const before = store.security;
      store.security = {
        ...next,
        passwordPolicy: { ...next.passwordPolicy },
        sessionTimeout: { ...next.sessionTimeout },
        loginAttemptLimits: { ...next.loginAttemptLimits },
      };
      appendActivity(
        createAuditEntry(
          "security_settings_updated",
          { before, after: store.security, reason: meta?.reason ?? null },
          meta
        )
      );
      return { ...store.security };
    },
    async getSystemBannerDraft() {
      return { ...store.bannerDraft };
    },
    async getSystemBannerPublished() {
      return store.bannerPublished ? { ...store.bannerPublished } : null;
    },
    async publishSystemBanner(draft, meta) {
      const before = store.bannerDraft;
      const published: SystemBannerPublished = {
        ...draft,
        publishedAt: resolvePerformedAt(meta),
      };
      store.bannerDraft = { ...draft };
      store.bannerPublished = published;
      appendActivity(
        createAuditEntry(
          "system_banner_published",
          { before, after: published, reason: meta?.reason ?? null },
          meta
        )
      );
      return published;
    },
    async unpublishSystemBanner(meta) {
      const before = store.bannerPublished;
      store.bannerPublished = null;
      appendActivity(
        createAuditEntry(
          "system_banner_unpublished",
          { before, after: null, reason: meta?.reason ?? null },
          meta
        )
      );
      return { unpublished: true };
    },
    async listAuditLogs() {
      return store.activity.map((row) => ({ ...row }));
    },
  };
}

