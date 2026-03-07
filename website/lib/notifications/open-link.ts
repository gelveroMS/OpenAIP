const TRACKED_OPEN_PATH = "/api/notifications/open";

type BuildTrackedNotificationOpenHrefInput = {
  next: string | null | undefined;
  notificationId?: string | null;
  dedupe?: string | null;
};

type BuildNotificationDestinationHrefInput = {
  next: string | null | undefined;
  notificationId?: string | null;
};

export function isSafeInternalPath(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith("/")) return false;
  if (trimmed.startsWith("//")) return false;
  if (trimmed.startsWith("/\\")) return false;
  return true;
}

function normalizeTrackedTarget(value: string | null | undefined): string {
  return isSafeInternalPath(value) ? value.trim() : "/";
}

export function buildNotificationDestinationHref(
  input: BuildNotificationDestinationHrefInput
): string {
  const target = normalizeTrackedTarget(input.next);
  const notificationId = input.notificationId?.trim();
  if (!notificationId) {
    return target;
  }

  const parsed = new URL(target, "https://openaip.local");
  parsed.searchParams.set("notificationId", notificationId);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function buildTrackedNotificationOpenHref(
  input: BuildTrackedNotificationOpenHrefInput
): string {
  const params = new URLSearchParams();
  params.set("next", normalizeTrackedTarget(input.next));

  const notificationId = input.notificationId?.trim();
  if (notificationId) {
    params.set("notificationId", notificationId);
  }

  const dedupe = input.dedupe?.trim();
  if (dedupe) {
    params.set("dedupe", dedupe);
  }

  return `${TRACKED_OPEN_PATH}?${params.toString()}`;
}
