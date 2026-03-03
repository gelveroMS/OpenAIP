import type { SystemAdministrationRepo } from "./types";

type SystemAdministrationState = {
  securitySettings: Awaited<ReturnType<SystemAdministrationRepo["getSecuritySettings"]>>;
  systemBannerDraft: Awaited<ReturnType<SystemAdministrationRepo["getSystemBannerDraft"]>>;
  systemBannerPublished: Awaited<
    ReturnType<SystemAdministrationRepo["getSystemBannerPublished"]>
  >;
  auditLogs: Awaited<ReturnType<SystemAdministrationRepo["listAuditLogs"]>>;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message ?? "System administration request failed.");
  }
  return payload;
}

async function getState(): Promise<SystemAdministrationState> {
  const response = await fetch("/api/admin/system-administration", {
    method: "GET",
    cache: "no-store",
  });
  return readJson<SystemAdministrationState>(response);
}

async function postAction<T>(action: string, payload: unknown): Promise<T> {
  const response = await fetch("/api/admin/system-administration", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  return readJson<T>(response);
}

export function createSupabaseSystemAdministrationRepo(): SystemAdministrationRepo {
  return {
    async getSecuritySettings() {
      return (await getState()).securitySettings;
    },
    async updateSecuritySettings(next, meta) {
      const payload = await postAction<{
        securitySettings: Awaited<
          ReturnType<SystemAdministrationRepo["getSecuritySettings"]>
        >;
      }>("update_security_settings", { next, meta });
      return payload.securitySettings;
    },
    async getSystemBannerDraft() {
      return (await getState()).systemBannerDraft;
    },
    async getSystemBannerPublished() {
      return (await getState()).systemBannerPublished;
    },
    async publishSystemBanner(draft, meta) {
      const payload = await postAction<{
        systemBannerPublished: Awaited<
          ReturnType<SystemAdministrationRepo["publishSystemBanner"]>
        >;
      }>("publish_system_banner", { draft, meta });
      return payload.systemBannerPublished;
    },
    async unpublishSystemBanner(meta) {
      return postAction<{ unpublished: true }>("unpublish_system_banner", { meta });
    },
    async listAuditLogs() {
      return (await getState()).auditLogs;
    },
  };
}
