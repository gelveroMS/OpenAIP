const PDF_MAGIC_BYTES = Buffer.from("%PDF-", "ascii");

export function hasPdfExtension(fileName: string | null | undefined): boolean {
  if (!fileName) return false;
  return fileName.toLowerCase().endsWith(".pdf");
}

export function hasStrictPdfMime(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  return mimeType.toLowerCase() === "application/pdf";
}

export function hasPdfMagicBytes(fileBuffer: Buffer): boolean {
  if (fileBuffer.length < PDF_MAGIC_BYTES.length) return false;
  return fileBuffer.subarray(0, PDF_MAGIC_BYTES.length).equals(PDF_MAGIC_BYTES);
}

export function sanitizeFileName(fileName: string | null | undefined): string {
  const fallback = "upload.pdf";
  if (!fileName) return fallback;

  const withoutPath = fileName.split(/[/\\]/).pop() ?? fileName;
  const normalized = withoutPath
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .trim();

  if (!normalized) return fallback;
  const withPdfExt = normalized.toLowerCase().endsWith(".pdf")
    ? normalized
    : `${normalized}.pdf`;
  const maxLength = 120;
  if (withPdfExt.length <= maxLength) {
    return withPdfExt;
  }

  const suffix = ".pdf";
  const truncatedBase = withPdfExt
    .slice(0, maxLength - suffix.length)
    .replace(/\.+$/g, "");
  if (!truncatedBase) return fallback;
  return `${truncatedBase}${suffix}`;
}
