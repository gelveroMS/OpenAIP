import { normalizeText } from "../normalize";

type ColumnConcept =
  | "reference_code"
  | "description"
  | "implementing_agency"
  | "start_date"
  | "completion_date"
  | "expected_output"
  | "source_of_funds"
  | "budget_amount"
  | "total"
  | "personal_services"
  | "maintenance_and_other_operating_expenses"
  | "capital_outlay"
  | "climate_change_adaptation"
  | "climate_change_mitigation"
  | "cc_typology_code"
  | "prm_ncr_lgu_rm_objective_results_indicator";

const REQUIRED_COLUMN_CONCEPTS: ColumnConcept[] = [
  "reference_code",
  "description",
  "implementing_agency",
  "start_date",
  "completion_date",
  "expected_output",
  "source_of_funds",
  "budget_amount",
  "total",
];

const COLUMN_ALIASES: Record<ColumnConcept, string[]> = {
  reference_code: [
    "aip reference code",
    "baip reference code",
    "aip reference",
    "ref code",
    "code",
  ],
  description: [
    "program/project/activity description",
    "program/project/activity",
    "program/project description",
    "project description",
    "description",
  ],
  implementing_agency: [
    "implementing office/unit",
    "implementing office",
    "implementing agency",
    "implementing office/department",
    "implementing department",
    "department",
  ],
  start_date: [
    "start date",
    "starting date",
    "schedule of implementation",
    "implementation start",
  ],
  completion_date: [
    "completion date",
    "end date",
    "ending date",
    "implementation end",
  ],
  expected_output: ["expected output", "expected outputs", "outputs"],
  source_of_funds: ["source of funds", "funding source", "source"],
  budget_amount: [
    "amount",
    "amount in thousand pesos",
    "budget amount",
    "ps",
    "mooe",
    "co",
  ],
  total: ["total", "total amount"],
  personal_services: ["personal services", "ps"],
  maintenance_and_other_operating_expenses: [
    "maintenance and other operating expenses",
    "mooe",
  ],
  capital_outlay: ["capital outlay", "co"],
  climate_change_adaptation: ["climate change adaptation"],
  climate_change_mitigation: ["climate change mitigation"],
  cc_typology_code: ["cc typology code", "cc topology code"],
  prm_ncr_lgu_rm_objective_results_indicator: [
    "prm/ncr lgu rm objective-results indicator code",
    "prm/ncr lgu rm objective results indicator",
    "rm objective-results indicator code",
  ],
};

const REF_CODE_PATTERN = /\b\d{3,4}(?:-\d{1,3}){1,5}\b/g;
const DATE_LIKE_PATTERN =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|q[1-4]|20\d{2}|2100|\d{1,2}\/\d{1,2}\/\d{2,4})\b/gi;
const NUMERIC_PATTERN =
  /\b(?:\u20B1|php|p)?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/gi;
const SECTION_HEADER_PATTERN =
  /^(?:general public service sector|social services sector|economic services|other services|environment sector)$/i;

function flattenLines(pages: string[]): string[] {
  const lines: string[] = [];
  for (const page of pages) {
    for (const line of page.split(/\r?\n/)) {
      const cleaned = line.replace(/\s+/g, " ").trim();
      if (!cleaned) continue;
      lines.push(cleaned);
    }
  }
  return lines;
}

function countMatches(pattern: RegExp, text: string): number {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  let count = 0;
  let match = regex.exec(text);
  while (match) {
    count += 1;
    match = regex.exec(text);
  }
  return count;
}

function hasAlias(documentText: string, aliases: string[]): boolean {
  return aliases.some((alias) => documentText.includes(normalizeText(alias)));
}

export type AipStructureDetection = {
  matchedColumns: ColumnConcept[];
  missingRequiredColumns: ColumnConcept[];
  hasRequiredColumns: boolean;
  hasTableLikeStructure: boolean;
  projectRowCount: number;
  refCodeHits: number;
  dateLikeHits: number;
  numericHits: number;
};

export type AipPlausibilityResult = {
  ok: boolean;
  score: number;
  hasDateLikeValues: boolean;
  hasNumericBudgetValues: boolean;
  hasTotalsPattern: boolean;
  hasReferenceCodePattern: boolean;
  hasProjectRows: boolean;
};

export function detectAipStructure(input: {
  pages: string[];
  minRequiredColumnMatches: number;
}): AipStructureDetection {
  const lines = flattenLines(input.pages);
  const joinedText = lines.join("\n");
  const normalizedDoc = normalizeText(joinedText);

  const matchedColumns: ColumnConcept[] = [];
  for (const [concept, aliases] of Object.entries(COLUMN_ALIASES) as Array<
    [ColumnConcept, string[]]
  >) {
    if (hasAlias(normalizedDoc, aliases)) {
      matchedColumns.push(concept);
    }
  }

  const refCodeHits = countMatches(REF_CODE_PATTERN, joinedText);
  const dateLikeHits = countMatches(DATE_LIKE_PATTERN, joinedText);
  const numericHits = countMatches(NUMERIC_PATTERN, joinedText);
  const totalHits = countMatches(/\btotal\b/gi, joinedText);

  let projectRowCount = 0;
  for (const line of lines) {
    if (SECTION_HEADER_PATTERN.test(line.trim().toLowerCase())) {
      continue;
    }
    const hasRefCode = /\b\d{3,4}(?:-\d{1,3}){1,5}\b/i.test(line);
    const hasNumeric =
      /\b(?:\u20B1|php|p)?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/i.test(line);
    const hasDateLike =
      /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|q[1-4]|\d{1,2}\/\d{1,2}\/\d{2,4}|20\d{2}|2100)\b/i.test(
        line
      );
    if (hasRefCode && (hasNumeric || hasDateLike)) {
      projectRowCount += 1;
    }
  }

  const missingRequiredColumns = REQUIRED_COLUMN_CONCEPTS.filter(
    (concept) => !matchedColumns.includes(concept)
  );
  const hasRequiredColumns =
    matchedColumns.length >= input.minRequiredColumnMatches;
  const hasTableLikeStructure =
    hasRequiredColumns &&
    (projectRowCount > 0 ||
      refCodeHits >= 3 ||
      (numericHits >= 20 && totalHits >= 2 && lines.length >= 25));

  return {
    matchedColumns,
    missingRequiredColumns,
    hasRequiredColumns,
    hasTableLikeStructure,
    projectRowCount,
    refCodeHits,
    dateLikeHits,
    numericHits,
  };
}

export function evaluateAipPlausibility(input: {
  pages: string[];
  structure: AipStructureDetection;
}): AipPlausibilityResult {
  const joinedText = input.pages.join("\n");
  const hasDateLikeValues = input.structure.dateLikeHits > 0;
  const hasNumericBudgetValues = input.structure.numericHits >= 5;
  const hasTotalsPattern =
    /\btotal\b/i.test(joinedText) && input.structure.numericHits >= 5;
  const hasReferenceCodePattern = input.structure.refCodeHits > 0;
  const hasProjectRows = input.structure.projectRowCount > 0;

  const score = [
    hasDateLikeValues,
    hasNumericBudgetValues,
    hasTotalsPattern,
    hasReferenceCodePattern,
    hasProjectRows,
  ].filter(Boolean).length;

  const ok =
    hasDateLikeValues &&
    hasNumericBudgetValues &&
    hasProjectRows &&
    score >= 4;

  return {
    ok,
    score,
    hasDateLikeValues,
    hasNumericBudgetValues,
    hasTotalsPattern,
    hasReferenceCodePattern,
    hasProjectRows,
  };
}

