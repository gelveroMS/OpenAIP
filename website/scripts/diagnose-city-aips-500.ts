import { createClient } from "@supabase/supabase-js";

type QueryError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

type RpcProbeResult = {
  name: string;
  exists: boolean;
  callError: QueryError | null;
};

type RelationProbeResult = {
  relation: string;
  exists: boolean;
  error: QueryError | null;
};

type ColumnProbeResult = {
  table: string;
  presentColumns: string[];
  missingColumns: string[];
  relationMissing: boolean;
  unexpectedErrors: string[];
};

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const PROJECT_COLUMNS_TO_CHECK = [
  "financial_expenses",
  "is_human_edited",
  "edited_by",
  "edited_at",
  "cc_topology_code",
  "prm_ncr_lgu_rm_objective_results_indicator",
] as const;

const EXTRACTION_RUN_COLUMNS_TO_CHECK = [
  "overall_progress_pct",
  "progress_message",
  "error_message",
  "progress_updated_at",
  "created_by",
  "retry_of_run_id",
  "resume_from_stage",
] as const;

const UPLOADED_FILES_COLUMNS_TO_CHECK = [
  "sha256_hex",
  "mime_type",
  "size_bytes",
  "is_current",
  "uploaded_by",
] as const;

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function lower(input: unknown): string {
  return String(input ?? "").toLowerCase();
}

function errorHaystack(error: QueryError | null | undefined): string {
  if (!error) return "";
  return [error.code, error.message, error.details, error.hint]
    .map((part) => lower(part))
    .join(" ");
}

function formatError(error: QueryError | null | undefined): string {
  if (!error) return "none";
  const parts = [
    error.code ? `code=${error.code}` : null,
    error.message ? `message=${error.message}` : null,
    error.details ? `details=${error.details}` : null,
    error.hint ? `hint=${error.hint}` : null,
  ].filter(Boolean);
  return parts.join(" | ");
}

function isMissingFunction(error: QueryError | null, fnName: string): boolean {
  const haystack = errorHaystack(error);
  if (!haystack) return false;
  if (haystack.includes("could not find the function")) return true;
  if (haystack.includes("function") && haystack.includes(lower(fnName))) return true;
  return false;
}

function isMissingRelation(error: QueryError | null, relation: string): boolean {
  const haystack = errorHaystack(error);
  if (!haystack) return false;
  if (haystack.includes(`relation "${lower(relation)}" does not exist`)) return true;
  if (haystack.includes(`could not find the '${lower(relation)}' table`)) return true;
  if (haystack.includes(`table "${lower(relation)}" does not exist`)) return true;
  return false;
}

function isMissingColumn(error: QueryError | null, table: string, column: string): boolean {
  const haystack = errorHaystack(error);
  if (!haystack) return false;
  if (haystack.includes(`could not find the '${lower(column)}' column`)) return true;
  if (haystack.includes(`column ${lower(column)} does not exist`)) return true;
  if (haystack.includes(`column "${lower(column)}" does not exist`)) return true;
  if (
    haystack.includes("column") &&
    haystack.includes(lower(column)) &&
    haystack.includes(lower(table))
  ) {
    return true;
  }
  return false;
}

async function probeRpc(
  client: any,
  name: string,
  args: Record<string, unknown> = {}
): Promise<RpcProbeResult> {
  const { error } = await client.rpc(name, args);
  if (!error) {
    return {
      name,
      exists: true,
      callError: null,
    };
  }

  return {
    name,
    exists: !isMissingFunction(error as QueryError, name),
    callError: error as QueryError,
  };
}

async function probeRelation(
  client: any,
  relation: string
): Promise<RelationProbeResult> {
  const { error } = await client.from(relation).select("id").limit(1);
  if (!error) {
    return {
      relation,
      exists: true,
      error: null,
    };
  }

  return {
    relation,
    exists: !isMissingRelation(error as QueryError, relation),
    error: error as QueryError,
  };
}

async function probeColumns(
  client: any,
  table: string,
  columns: readonly string[]
): Promise<ColumnProbeResult> {
  const presentColumns: string[] = [];
  const missingColumns: string[] = [];
  const unexpectedErrors: string[] = [];
  let relationMissing = false;

  for (const column of columns) {
    const { error } = await client.from(table).select(column).limit(1);
    if (!error) {
      presentColumns.push(column);
      continue;
    }

    const typedError = error as QueryError;
    if (isMissingRelation(typedError, table)) {
      relationMissing = true;
      break;
    }
    if (isMissingColumn(typedError, table, column)) {
      missingColumns.push(column);
      continue;
    }

    unexpectedErrors.push(`${column}: ${formatError(typedError)}`);
  }

  return {
    table,
    presentColumns,
    missingColumns,
    relationMissing,
    unexpectedErrors,
  };
}

function printHeader(): void {
  console.log("[city-aips-500] Starting schema diagnostic probes...");
}

function printProbeLine(label: string, ok: boolean, details?: string): void {
  const marker = ok ? "OK" : "MISSING";
  if (details) {
    console.log(`[city-aips-500] ${marker} ${label} (${details})`);
    return;
  }
  console.log(`[city-aips-500] ${marker} ${label}`);
}

function printMissingColumns(table: string, columns: string[]): void {
  if (columns.length === 0) return;
  console.log(`[city-aips-500] Missing columns in ${table}: ${columns.join(", ")}`);
}

async function main(): Promise<void> {
  printHeader();

  const supabaseUrl = readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const [
    validationLogsRelation,
    canUploadRpc,
    hardeningRpc,
    projectsColumns,
    extractionRunsColumns,
    uploadedFilesColumns,
  ] = await Promise.all([
    probeRelation(client, "aip_upload_validation_logs"),
    probeRpc(client, "can_upload_aip_pdf", { p_aip_id: ZERO_UUID }),
    probeRpc(client, "inspect_required_db_hardening"),
    probeColumns(client, "projects", PROJECT_COLUMNS_TO_CHECK),
    probeColumns(client, "extraction_runs", EXTRACTION_RUN_COLUMNS_TO_CHECK),
    probeColumns(client, "uploaded_files", UPLOADED_FILES_COLUMNS_TO_CHECK),
  ]);

  printProbeLine(
    "public.aip_upload_validation_logs",
    validationLogsRelation.exists,
    validationLogsRelation.error
      ? formatError(validationLogsRelation.error)
      : undefined
  );
  printProbeLine(
    "public.can_upload_aip_pdf(uuid)",
    canUploadRpc.exists,
    canUploadRpc.callError ? formatError(canUploadRpc.callError) : undefined
  );
  printProbeLine(
    "public.inspect_required_db_hardening()",
    hardeningRpc.exists,
    hardeningRpc.callError ? formatError(hardeningRpc.callError) : undefined
  );

  if (projectsColumns.relationMissing) {
    printProbeLine("public.projects", false, "relation missing");
  } else {
    printProbeLine(
      "public.projects required columns",
      projectsColumns.missingColumns.length === 0,
      projectsColumns.missingColumns.length
        ? `${projectsColumns.missingColumns.length} missing`
        : undefined
    );
    printMissingColumns(projectsColumns.table, projectsColumns.missingColumns);
  }

  if (extractionRunsColumns.relationMissing) {
    printProbeLine("public.extraction_runs", false, "relation missing");
  } else {
    printProbeLine(
      "public.extraction_runs required columns",
      extractionRunsColumns.missingColumns.length === 0,
      extractionRunsColumns.missingColumns.length
        ? `${extractionRunsColumns.missingColumns.length} missing`
        : undefined
    );
    printMissingColumns(extractionRunsColumns.table, extractionRunsColumns.missingColumns);
  }

  if (uploadedFilesColumns.relationMissing) {
    printProbeLine("public.uploaded_files", false, "relation missing");
  } else {
    printProbeLine(
      "public.uploaded_files required columns",
      uploadedFilesColumns.missingColumns.length === 0,
      uploadedFilesColumns.missingColumns.length
        ? `${uploadedFilesColumns.missingColumns.length} missing`
        : undefined
    );
    printMissingColumns(uploadedFilesColumns.table, uploadedFilesColumns.missingColumns);
  }

  const unexpectedErrors = [
    ...projectsColumns.unexpectedErrors.map((error) => `projects.${error}`),
    ...extractionRunsColumns.unexpectedErrors.map((error) => `extraction_runs.${error}`),
    ...uploadedFilesColumns.unexpectedErrors.map((error) => `uploaded_files.${error}`),
  ];

  if (unexpectedErrors.length > 0) {
    console.log("[city-aips-500] Non-schema errors detected while probing:");
    for (const err of unexpectedErrors) {
      console.log(`[city-aips-500]   - ${err}`);
    }
  }

  const missingProgressColumns = extractionRunsColumns.missingColumns.filter((column) =>
    [
      "overall_progress_pct",
      "progress_message",
      "error_message",
      "progress_updated_at",
    ].includes(column)
  );
  const missingRetryColumns = extractionRunsColumns.missingColumns.filter((column) =>
    ["retry_of_run_id", "resume_from_stage"].includes(column)
  );
  const missingProjectsEditColumns = projectsColumns.missingColumns.filter((column) =>
    ["is_human_edited", "edited_by", "edited_at"].includes(column)
  );
  const missingUploadedFilesColumns = uploadedFilesColumns.missingColumns;
  const missingCreatedBy = extractionRunsColumns.missingColumns.includes("created_by");

  const recommendedPatches = new Set<string>();
  if (!validationLogsRelation.exists) {
    recommendedPatches.add("website/docs/sql/2026-03-06_aip_upload_validation_gating.sql");
  }
  if (!canUploadRpc.exists) {
    recommendedPatches.add("website/docs/sql/2026-03-01_barangay_aip_uploader_workflow_lock.sql");
  }
  if (missingProgressColumns.length > 0) {
    recommendedPatches.add("website/docs/sql/2026-02-19_extraction_run_progress.sql");
  }
  if (missingRetryColumns.length > 0) {
    recommendedPatches.add("website/docs/sql/2026-03-06_extraction_runs_retry_resume.sql");
  }
  if (
    projectsColumns.relationMissing ||
    missingProjectsEditColumns.length > 0 ||
    missingCreatedBy ||
    uploadedFilesColumns.relationMissing ||
    missingUploadedFilesColumns.length > 0
  ) {
    recommendedPatches.add("website/docs/sql/database-v2.sql");
  }
  if (!hardeningRpc.exists) {
    recommendedPatches.add("website/docs/sql/database-v2.sql");
  }

  const hasSchemaGaps =
    !validationLogsRelation.exists ||
    !canUploadRpc.exists ||
    !hardeningRpc.exists ||
    projectsColumns.relationMissing ||
    extractionRunsColumns.relationMissing ||
    uploadedFilesColumns.relationMissing ||
    projectsColumns.missingColumns.length > 0 ||
    extractionRunsColumns.missingColumns.length > 0 ||
    uploadedFilesColumns.missingColumns.length > 0;

  console.log("[city-aips-500] Recommended SQL patches:");
  if (recommendedPatches.size === 0) {
    console.log("[city-aips-500]   - none (schema probes passed)");
  } else {
    for (const patch of recommendedPatches) {
      console.log(`[city-aips-500]   - ${patch}`);
    }
  }

  console.log("[city-aips-500] SQL editor probe script:");
  console.log(
    "[city-aips-500]   - website/docs/sql/2026-03-10_city_aips_500_schema_probe.sql"
  );

  if (hasSchemaGaps || unexpectedErrors.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("[city-aips-500] PASS: no required schema gaps detected.");
}

main().catch((error) => {
  console.error("[city-aips-500] FAIL");
  console.error(
    `[city-aips-500] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
