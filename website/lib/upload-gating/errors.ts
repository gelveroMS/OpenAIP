import {
  MAX_UPLOAD_PAGES,
  MAX_UPLOAD_SIZE_BYTES,
} from "./constants";
import type {
  UploadFailureDetails,
  UploadGateFailure,
  ValidationCode,
} from "./types";

function bytesToMbLabel(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return mb.endsWith(".0") ? mb.slice(0, -2) : mb;
}

export function validationCodeToHttpStatus(code: ValidationCode): number {
  switch (code) {
    case "UPLOAD_UNAUTHENTICATED":
      return 401;
    case "UPLOAD_FORBIDDEN_ROLE":
    case "UPLOAD_NO_LGU_SCOPE":
    case "UPLOAD_INVALID_UPLOADER_SCOPE":
    case "UPLOAD_LGU_LEVEL_MISMATCH":
    case "UPLOAD_LGU_MISMATCH":
      return 403;
    case "UPLOAD_DUPLICATE_FILE":
    case "UPLOAD_AIP_ALREADY_EXISTS":
    case "UPLOAD_NOT_ALLOWED_IN_STATE":
      return 409;
    case "UPLOAD_RATE_LIMITED":
      return 429;
    case "UPLOAD_INTERNAL_VALIDATION_ERROR":
      return 500;
    default:
      return 422;
  }
}

export function validationMessageForCode(code: ValidationCode): string {
  switch (code) {
    case "UPLOAD_FILE_REQUIRED":
      return "No file was uploaded.";
    case "UPLOAD_INVALID_EXTENSION":
      return "Only PDF files are accepted.";
    case "UPLOAD_INVALID_MIME":
      return "The uploaded file is not recognized as a PDF.";
    case "UPLOAD_INVALID_SIGNATURE":
      return "The uploaded file is not a valid PDF.";
    case "UPLOAD_FILE_TOO_LARGE":
      return `The PDF exceeds the maximum file size of ${bytesToMbLabel(MAX_UPLOAD_SIZE_BYTES)} MB.`;
    case "UPLOAD_TOO_MANY_PAGES":
      return `The PDF exceeds the maximum allowed page count of ${MAX_UPLOAD_PAGES} pages.`;
    case "UPLOAD_ENCRYPTED_PDF":
      return "Password-protected or encrypted PDFs are not supported.";
    case "UPLOAD_CORRUPTED_PDF":
      return "The PDF could not be read. Please upload a valid, non-corrupted PDF.";
    case "UPLOAD_UNAUTHENTICATED":
      return "You must be signed in to upload a file.";
    case "UPLOAD_FORBIDDEN_ROLE":
      return "Your account is not allowed to upload AIP files.";
    case "UPLOAD_NO_LGU_SCOPE":
      return "Your account does not have an assigned LGU scope.";
    case "UPLOAD_INVALID_YEAR":
      return "Please select a valid fiscal year.";
    case "UPLOAD_INVALID_UPLOADER_SCOPE":
      return "Your account\u2019s LGU scope is incomplete or invalid for uploads.";
    case "UPLOAD_DUPLICATE_FILE":
      return "This exact file has already been uploaded.";
    case "UPLOAD_AIP_ALREADY_EXISTS":
      return "An AIP for this LGU and fiscal year already exists.";
    case "UPLOAD_NOT_ALLOWED_IN_STATE":
      return "A new upload is not allowed for this LGU and year in the current workflow state.";
    case "UPLOAD_RATE_LIMITED":
      return "Too many upload attempts. Please try again later.";
    case "UPLOAD_SCANNED_PDF_NOT_SUPPORTED":
      return "This upload appears to be a scanned or image-only PDF. Please upload a native PDF with selectable text.";
    case "UPLOAD_NOT_AIP_DOCUMENT":
      return "The document does not appear to be a valid AIP/BAIP PDF.";
    case "UPLOAD_YEAR_NOT_DETECTED":
      return "The fiscal year could not be detected from the PDF.";
    case "UPLOAD_YEAR_MISMATCH":
      return "The selected year does not match the fiscal year detected in the PDF.";
    case "UPLOAD_LGU_NOT_DETECTED":
      return "The LGU could not be detected from the PDF.";
    case "UPLOAD_LGU_LEVEL_NOT_DETECTED":
      return "The LGU level of the document could not be determined from the PDF.";
    case "UPLOAD_LGU_LEVEL_MISMATCH":
      return "The uploaded document type does not match your allowed LGU upload scope.";
    case "UPLOAD_LGU_MISMATCH":
      return "The detected LGU in the PDF does not match your assigned LGU.";
    case "UPLOAD_TEMPLATE_COLUMNS_MISSING":
      return "The document does not match the expected AIP/BAIP table structure.";
    case "UPLOAD_NO_PROJECT_ROWS":
      return "The document does not contain recognizable AIP project rows.";
    case "UPLOAD_IMPLAUSIBLE_CONTENT":
      return "The document content does not appear to be a valid AIP/BAIP.";
    case "UPLOAD_INTERNAL_VALIDATION_ERROR":
    default:
      return "The upload could not be validated due to a system error. Please try again.";
  }
}

export function toValidationFailure(input: {
  code: ValidationCode;
  details?: UploadFailureDetails;
  logDetails?: Record<string, unknown>;
  failedCodes?: ValidationCode[];
  audit: UploadGateFailure["audit"];
}): UploadGateFailure {
  return {
    ok: false,
    code: input.code,
    message: validationMessageForCode(input.code),
    details: input.details ?? null,
    logDetails: input.logDetails,
    failedCodes: input.failedCodes,
    audit: input.audit,
  };
}

