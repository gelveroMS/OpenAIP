"use client";

import { useEffect, useMemo, useState } from "react";
import SecurityNoticeBanner from "../components/SecurityNoticeBanner";
import SecuritySettingsSection from "../components/SecuritySettingsSection";
import SystemBannerSection from "../components/SystemBannerSection";
import { getSystemAdministrationRepo } from "@/lib/repos/system-administration/repo";
import type {
  SecuritySettings,
  SystemBannerDraft,
  SystemBannerPublished,
} from "@/lib/repos/system-administration/types";

export default function SystemAdministrationView() {
  const repo = useMemo(() => getSystemAdministrationRepo(), []);
  const [securitySettings, setSecuritySettings] = useState<SecuritySettings | null>(null);
  const [bannerDraft, setBannerDraft] = useState<SystemBannerDraft | null>(null);
  const [bannerPublished, setBannerPublished] = useState<SystemBannerPublished | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [security, bannerDraftData, bannerPublishedData] = await Promise.all([
          repo.getSecuritySettings(),
          repo.getSystemBannerDraft(),
          repo.getSystemBannerPublished(),
        ]);
        if (!isActive) return;
        setSecuritySettings(security);
        setBannerDraft(bannerDraftData);
        setBannerPublished(bannerPublishedData);
      } catch (err) {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : "Failed to load system administration data.");
      } finally {
        if (isActive) setLoading(false);
      }
    };
    load();
    return () => {
      isActive = false;
    };
  }, [repo]);

  const handleSaveSecurity = async (next: SecuritySettings) => {
    const updated = await repo.updateSecuritySettings(next, {
      performedBy: "Admin Maria Rodriguez",
    });
    setSecuritySettings(updated);
  };

  const handlePublishBanner = async (draft: SystemBannerDraft) => {
    const published = await repo.publishSystemBanner(draft, {
      performedBy: "Admin Maria Rodriguez",
    });
    setBannerDraft(draft);
    setBannerPublished(published);
  };

  const handleUnpublishBanner = async () => {
    await repo.unpublishSystemBanner({ performedBy: "Admin Maria Rodriguez" });
    setBannerPublished(null);
  };

  if (!securitySettings || !bannerDraft) {
    return (
      <div className="space-y-6 text-[13.5px] text-slate-700">
        <div>
          <h1 className="text-[28px] font-semibold text-slate-900">System Administration</h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            Manage security-related configuration and operational controls with confirmation dialogs
            for high-impact settings.
          </p>
        </div>
        {loading && <div className="text-sm text-slate-500">Loading system administration...</div>}
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 text-[13.5px] text-slate-700">
      <div>
        <h1 className="text-[28px] font-semibold text-slate-900">System Administration</h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Manage security-related configuration and operational controls with confirmation dialogs for
          high-impact settings.
        </p>
      </div>

      <SecurityNoticeBanner />

      <SecuritySettingsSection
        settings={securitySettings}
        loading={loading}
        onSave={handleSaveSecurity}
      />

      <SystemBannerSection
        draft={bannerDraft}
        published={bannerPublished}
        loading={loading}
        onPublish={handlePublishBanner}
        onUnpublish={handleUnpublishBanner}
      />
    </div>
  );
}

