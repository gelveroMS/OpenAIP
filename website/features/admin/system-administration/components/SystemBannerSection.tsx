"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  SystemBannerDraft,
  SystemBannerPublished,
} from "@/lib/repos/system-administration/types";
import { emitSystemBannerChanged } from "@/components/system/system-banner-events";
import BannerComposerCard from "./BannerComposerCard";
import BannerPreviewCard from "./BannerPreviewCard";
import ConfirmPublishBannerModal from "./ConfirmPublishBannerModal";
import ConfirmUnpublishBannerModal from "./ConfirmUnpublishBannerModal";

const EMPTY_DRAFT: SystemBannerDraft = {
  title: null,
  message: "",
  severity: "Info",
  startAt: null,
  endAt: null,
};

const isScheduleValid = (draft: SystemBannerDraft) => {
  const nowMs = Date.now();
  const startMs = draft.startAt ? new Date(draft.startAt).getTime() : null;
  const endMs = draft.endAt ? new Date(draft.endAt).getTime() : null;
  if (draft.startAt && (!startMs || Number.isNaN(startMs))) return false;
  if (draft.endAt && (!endMs || Number.isNaN(endMs))) return false;
  if (endMs !== null && endMs <= nowMs) return false;
  if (startMs !== null && endMs !== null) return endMs > startMs;
  return true;
};

const isPublishedActive = (published: SystemBannerPublished | null): boolean => {
  if (!published) return false;
  const now = Date.now();
  const start = published.startAt ? new Date(published.startAt).getTime() : null;
  const end = published.endAt ? new Date(published.endAt).getTime() : null;

  if (start !== null && Number.isFinite(start) && now < start) return false;
  if (end !== null && Number.isFinite(end) && now > end) return false;
  return true;
};

export default function SystemBannerSection({
  draft,
  published,
  loading,
  onPublish,
  onUnpublish,
}: {
  draft: SystemBannerDraft;
  published: SystemBannerPublished | null;
  loading: boolean;
  onPublish: (next: SystemBannerDraft) => Promise<void>;
  onUnpublish: () => Promise<void>;
}) {
  const [localDraft, setLocalDraft] = useState(draft);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmUnpublishOpen, setConfirmUnpublishOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [unpublished, setUnpublished] = useState(false);

  const isValid = useMemo(() => {
    return localDraft.message.trim().length > 0 && isScheduleValid(localDraft);
  }, [localDraft]);
  const currentlyActive = useMemo(() => isPublishedActive(published), [published]);

  const handlePublish = async () => {
    await onPublish(localDraft);
    setLocalDraft({ ...EMPTY_DRAFT });
    setSaved(true);
    setUnpublished(false);
    setConfirmOpen(false);
    emitSystemBannerChanged();
    setTimeout(() => setSaved(false), 2000);
  };

  const handleUnpublish = async () => {
    await onUnpublish();
    setLocalDraft({ ...EMPTY_DRAFT });
    setUnpublished(true);
    setSaved(false);
    setConfirmUnpublishOpen(false);
    emitSystemBannerChanged();
    setTimeout(() => setUnpublished(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[15px] font-semibold text-slate-900">System Banner</div>
        <div className="text-[13.5px] text-slate-500">
          Configure and publish system-wide banners for announcements, maintenance notices, or critical
          alerts.
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-[12px] text-slate-600">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {published ? (
            <div className="space-y-1">
              <div>
                <span className="font-semibold text-slate-900">Current Published Banner:</span>{" "}
                {currentlyActive ? "Active now" : "Published, currently inactive (schedule window)"}
              </div>
              <div>
                Published at:{" "}
                <span className="font-medium text-slate-700">
                  {new Date(published.publishedAt).toLocaleString()}
                </span>
              </div>
            </div>
          ) : (
            <div>
              <span className="font-semibold text-slate-900">Current Published Banner:</span> None
            </div>
          )}
          <Button
            variant="outline"
            onClick={() => setConfirmUnpublishOpen(true)}
            disabled={!published || loading}
          >
            Unpublish Banner
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <BannerComposerCard draft={localDraft} onChange={setLocalDraft} />
        <div className="space-y-4">
          <BannerPreviewCard draft={localDraft} />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              className="bg-[#0E5D6F] text-white hover:bg-[#0E5D6F]/90"
              onClick={() => setConfirmOpen(true)}
              disabled={!isValid || loading}
            >
              Publish Banner
            </Button>
            {saved && (
              <span className="text-[12px] text-emerald-600">Banner published successfully.</span>
            )}
            {unpublished && (
              <span className="text-[12px] text-amber-700">Banner unpublished successfully.</span>
            )}
            {!isValid && localDraft.message.trim().length > 0 && (
              <span className="text-[12px] text-rose-700">
                Invalid banner schedule. Past schedule windows cannot be published.
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
        <span className="font-semibold">High-Impact Action:</span> System banners are visible to all
        users across the entire platform. Publishing or disabling a banner requires confirmation and is
        audit-logged for compliance.
      </div>

      <ConfirmPublishBannerModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handlePublish}
        confirmDisabled={!isValid || loading}
      />

      <ConfirmUnpublishBannerModal
        open={confirmUnpublishOpen}
        onOpenChange={setConfirmUnpublishOpen}
        onConfirm={handleUnpublish}
        confirmDisabled={!published || loading}
      />
    </div>
  );
}

