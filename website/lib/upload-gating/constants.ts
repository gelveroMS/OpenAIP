export type SupportedLGULevel = "barangay" | "city";

export const SUPPORTED_LGU_LEVELS: readonly SupportedLGULevel[] = [
  "barangay",
  "city",
] as const;

export const MIN_FISCAL_YEAR = 2000;
export const MAX_FISCAL_YEAR = new Date().getUTCFullYear() + 2;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveIntEnvMany(names: string[], fallback: number): number {
  for (const name of names) {
    const value = readPositiveIntEnv(name, Number.NaN);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return fallback;
}

export const MAX_UPLOAD_SIZE_BYTES = readPositiveIntEnv(
  "AIP_UPLOAD_MAX_BYTES",
  25 * 1024 * 1024
);
export const MAX_UPLOAD_PAGES = readPositiveIntEnv("AIP_UPLOAD_MAX_PAGES", 150);
export const MAX_TEXTLESS_PAGES_ALLOWED = readPositiveIntEnv(
  "AIP_UPLOAD_MAX_TEXTLESS_PAGES_ALLOWED",
  7
);
export const MIN_EXTRACTED_TEXT_CHARS = readPositiveIntEnv(
  "AIP_UPLOAD_MIN_EXTRACTED_TEXT_CHARS",
  500
);
export const MIN_REQUIRED_COLUMN_MATCHES = readPositiveIntEnv(
  "AIP_UPLOAD_MIN_REQUIRED_COLUMN_MATCHES",
  6
);
export const UPLOAD_RATE_LIMIT_WINDOW_MINUTES = readPositiveIntEnvMany(
  ["AIP_UPLOAD_RATE_LIMIT_WINDOW_MINUTES", "AIP_UPLOAD_FAILURE_WINDOW_MINUTES"],
  15
);
export const UPLOAD_RATE_LIMIT_MAX_ATTEMPTS = readPositiveIntEnvMany(
  ["AIP_UPLOAD_RATE_LIMIT_MAX_ATTEMPTS", "AIP_UPLOAD_FAILURE_THRESHOLD"],
  10
);
export const PDF_PARSE_TIMEOUT_MS = readPositiveIntEnv(
  "AIP_UPLOAD_PDF_PARSE_TIMEOUT_MS",
  8000
);
export const TEXT_SCAN_PAGES = readPositiveIntEnv(
  "AIP_UPLOAD_TEXT_SCAN_PAGES",
  8
);
export const IDENTITY_SCAN_PAGES = readPositiveIntEnv(
  "AIP_UPLOAD_IDENTITY_SCAN_PAGES",
  5
);
export const STRUCTURE_SCAN_PAGES = readPositiveIntEnv(
  "AIP_UPLOAD_STRUCTURE_SCAN_PAGES",
  40
);

export const UPLOAD_BUCKET_ID = "aip-pdfs";
