import {
  applyProjectEditPatch,
  buildProjectReviewBody,
  deriveSectorFromRefCode,
  diffProjectEditableFields,
  projectEditableFieldsFromRow,
} from "@/lib/repos/aip/project-review";
import type { AipProjectRow } from "@/lib/repos/aip/repo";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const BASE_ROW: AipProjectRow = {
  id: "p-1",
  aipId: "aip-1",
  aipRefCode: "3000-001",
  programProjectDescription: "Upgrade barangay health center",
  implementingAgency: "Barangay Health Office",
  startDate: "2026-01-15",
  completionDate: "2026-06-30",
  expectedOutput: "Expanded treatment capacity",
  sourceOfFunds: "General Fund",
  personalServices: 100000,
  maintenanceAndOtherOperatingExpenses: 80000,
  financialExpenses: 20000,
  capitalOutlay: 300000,
  total: 500000,
  climateChangeAdaptation: null,
  climateChangeMitigation: null,
  ccTopologyCode: null,
  prmNcrLguRmObjectiveResultsIndicator: null,
  category: "health",
  errors: null,
  projectRefCode: "3000-001",
  kind: "health",
  sector: "Social Sector",
  amount: 500000,
  reviewStatus: "unreviewed",
  aipDescription: "Upgrade barangay health center",
  aiIssues: undefined,
  officialComment: undefined,
};

export async function runAipProjectReviewUtilsTests() {
  const base = projectEditableFieldsFromRow(BASE_ROW);
  const next = applyProjectEditPatch(base, {
    category: "other",
    total: 525000,
  });

  const diff = diffProjectEditableFields(base, next);
  assert(diff.length === 2, "Expected two changed fields in diff.");

  const body = buildProjectReviewBody({
    reason: "Adjusted category and total after validation.",
    diff,
  });
  assert(
    body.includes("Adjusted category and total after validation."),
    "Expected reason text to be included."
  );
  assert(body.includes("Changes:"), "Expected formatted diff section.");
  assert(
    body.includes("Category") && body.includes("Total"),
    "Expected changed field labels in diff body."
  );

  assert(
    deriveSectorFromRefCode("3000-ABC") === "Social Sector",
    "Expected Social Sector from 3000 ref code."
  );
  assert(
    deriveSectorFromRefCode("UNKNOWN-CODE") === "Unknown",
    "Expected Unknown sector for non-standard ref code."
  );
  assert(
    deriveSectorFromRefCode(null) === "Unknown",
    "Expected Unknown sector when ref code is null."
  );

  const whitespaceOnlyDiff = diffProjectEditableFields(base, {
    ...base,
    implementingAgency: "Barangay\u00A0  Health Office",
  });
  assert(
    whitespaceOnlyDiff.length === 0,
    "Expected whitespace-only differences to be ignored."
  );

  const refCodeSpacingDiff = diffProjectEditableFields(base, {
    ...base,
    aipRefCode: "3000 - 001",
  });
  assert(
    refCodeSpacingDiff.length === 0,
    "Expected AIP ref-code hyphen spacing differences to be ignored."
  );
}
