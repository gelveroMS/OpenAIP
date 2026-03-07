export const DEFAULT_PROJECT_MEDIA_BUCKET = "project-media";
const PROJECT_MEDIA_PROXY_PREFIXES = ["/api/projects/media/", "/api/projects/cover/"] as const;

export function getProjectMediaBucketName(): string {
  const raw = process.env.SUPABASE_STORAGE_PROJECT_MEDIA_BUCKET;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : DEFAULT_PROJECT_MEDIA_BUCKET;
}

export function toProjectUpdateMediaProxyUrl(mediaId: string): string {
  return `/api/projects/media/${encodeURIComponent(mediaId)}`;
}

export function toProjectCoverProxyUrl(projectId: string): string {
  return `/api/projects/cover/${encodeURIComponent(projectId)}`;
}

export function isProjectMediaProxyUrl(src: string | null | undefined): boolean {
  if (typeof src !== "string") return false;
  const normalized = src.trim();
  if (!normalized) return false;

  if (PROJECT_MEDIA_PROXY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }

  if (!/^https?:\/\//i.test(normalized)) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    return PROJECT_MEDIA_PROXY_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}
