import { NextResponse } from "next/server";

const IMAGE_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

export function inferImageContentType(path: string, blobType?: string): string {
  const normalizedBlobType = typeof blobType === "string" ? blobType.trim().toLowerCase() : "";
  if (normalizedBlobType.startsWith("image/")) {
    return normalizedBlobType;
  }

  const normalizedPath = path.trim().toLowerCase();
  if (normalizedPath.endsWith(".jpg") || normalizedPath.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalizedPath.endsWith(".png")) {
    return "image/png";
  }
  if (normalizedPath.endsWith(".webp")) {
    return "image/webp";
  }
  if (normalizedPath.endsWith(".gif")) {
    return "image/gif";
  }
  if (normalizedPath.endsWith(".avif")) {
    return "image/avif";
  }

  return "application/octet-stream";
}

export function toImageResponse(
  data: Blob,
  path: string,
  preferredContentType?: string
): NextResponse {
  return new NextResponse(data.stream(), {
    status: 200,
    headers: {
      "content-type": inferImageContentType(path, preferredContentType ?? data.type),
      "cache-control": IMAGE_CACHE_CONTROL,
    },
  });
}
