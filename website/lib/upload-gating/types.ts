import type { AipStatus } from "@/lib/contracts/databasev2";
import type { ActorContext } from "@/lib/domain/actor-context";
import type { SupportedLGULevel } from "./constants";

export const VALIDATION_CODES = [
  "UPLOAD_FILE_REQUIRED",
  "UPLOAD_INVALID_EXTENSION",
  "UPLOAD_INVALID_MIME",
  "UPLOAD_INVALID_SIGNATURE",
  "UPLOAD_FILE_TOO_LARGE",
  "UPLOAD_TOO_MANY_PAGES",
  "UPLOAD_ENCRYPTED_PDF",
  "UPLOAD_CORRUPTED_PDF",
  "UPLOAD_UNAUTHENTICATED",
  "UPLOAD_FORBIDDEN_ROLE",
  "UPLOAD_NO_LGU_SCOPE",
  "UPLOAD_INVALID_YEAR",
  "UPLOAD_INVALID_UPLOADER_SCOPE",
  "UPLOAD_DUPLICATE_FILE",
  "UPLOAD_AIP_ALREADY_EXISTS",
  "UPLOAD_NOT_ALLOWED_IN_STATE",
  "UPLOAD_RATE_LIMITED",
  "UPLOAD_SCANNED_PDF_NOT_SUPPORTED",
  "UPLOAD_NOT_AIP_DOCUMENT",
  "UPLOAD_YEAR_NOT_DETECTED",
  "UPLOAD_YEAR_MISMATCH",
  "UPLOAD_LGU_NOT_DETECTED",
  "UPLOAD_LGU_LEVEL_NOT_DETECTED",
  "UPLOAD_LGU_LEVEL_MISMATCH",
  "UPLOAD_LGU_MISMATCH",
  "UPLOAD_TEMPLATE_COLUMNS_MISSING",
  "UPLOAD_NO_PROJECT_ROWS",
  "UPLOAD_IMPLAUSIBLE_CONTENT",
  "UPLOAD_INTERNAL_VALIDATION_ERROR",
] as const;

export type ValidationCode = (typeof VALIDATION_CODES)[number];

export type UploadFailureDetails = Record<string, unknown> | null;

export type ExistingAipState = {
  id: string;
  status: AipStatus;
} | null;

export type UploaderScopeContext = {
  level: SupportedLGULevel;
  lguId: string;
  lguName: string;
  parentCityName: string | null;
};

export type UploadGateValidatedData = {
  fileBuffer: Buffer;
  originalFileName: string;
  sanitizedFileName: string;
  fileSizeBytes: number;
  fileHashSha256: string;
  selectedYear: number;
  expectedLGULevel: SupportedLGULevel;
  expectedLGUId: string;
  expectedLGUName: string;
  detectedYear: number;
  detectedLGU: string;
  detectedLGULevel: SupportedLGULevel;
  detectedParentLGU: string | null;
  pageCount: number;
  isNativePdf: boolean;
  matchedColumns: string[];
  existingAip: ExistingAipState;
};

export type UploadValidationAuditContext = {
  selectedYear: number | null;
  fileHashSha256: string | null;
  fileSizeBytes: number | null;
  originalFileName: string | null;
  sanitizedFileName: string | null;
  detectedYear: number | null;
  detectedLGU: string | null;
  detectedLGULevel: SupportedLGULevel | null;
  pageCount: number | null;
};

export type UploadGateFailure = {
  ok: false;
  code: ValidationCode;
  message: string;
  details: UploadFailureDetails;
  logDetails?: Record<string, unknown>;
  failedCodes?: ValidationCode[];
  audit: UploadValidationAuditContext;
};

export type UploadGateSuccess = {
  ok: true;
  message: "Upload accepted.";
  data: UploadGateValidatedData;
  audit: UploadValidationAuditContext;
};

export type UploadGateResult = UploadGateFailure | UploadGateSuccess;

export type ValidateAIPUploadInput = {
  actor: ActorContext | null;
  expectedScope: SupportedLGULevel;
  file: File | null;
  selectedYearRaw: FormDataEntryValue | null;
  debug?: boolean;
};

export type UploadApiSuccess = {
  ok: true;
  message: "Upload accepted.";
  data: {
    uploadId: string;
    aipId: string;
    runId: string;
    status: string;
    detectedYear: number;
    detectedLGU: string;
    detectedLGULevel: SupportedLGULevel;
    pageCount: number;
  };
};

export type UploadApiFailure = {
  ok: false;
  code: ValidationCode;
  message: string;
  details: UploadFailureDetails;
  failedCodes?: ValidationCode[];
};

export type UploadApiResult = UploadApiSuccess | UploadApiFailure;
