import "server-only";

import type { SystemBannerPublishedValue } from "@/lib/settings/app-settings";
import { getTypedAppSetting } from "@/lib/settings/app-settings";

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function isBannerActiveNow(
  banner: SystemBannerPublishedValue | null,
  nowMs = Date.now()
): boolean {
  if (!banner) return false;

  const startMs = parseDateMs(banner.startAt);
  const endMs = parseDateMs(banner.endAt);

  if (startMs !== null && endMs !== null) {
    return nowMs >= startMs && nowMs <= endMs;
  }
  if (startMs !== null) {
    return nowMs >= startMs;
  }
  if (endMs !== null) {
    return nowMs <= endMs;
  }
  return true;
}

export async function getActiveSystemBanner(): Promise<SystemBannerPublishedValue | null> {
  const published = await getTypedAppSetting("system.banner_published");
  if (!isBannerActiveNow(published)) return null;
  return published;
}

