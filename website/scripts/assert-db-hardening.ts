/* eslint-disable @typescript-eslint/no-require-imports */
const { createClient } = require("@supabase/supabase-js");

type HardeningCheckRow = {
  check_key: string;
  object_type: string;
  object_name: string;
  is_present: boolean;
  expectation: string;
};

const EXPECTED_CHECK_KEYS = [
  "can_manage_barangay_aip_exists",
  "can_edit_aip_uses_uploader_lock",
  "can_upload_aip_pdf_uses_uploader_lock",
  "aips_update_policy_uses_uploader_lock",
  "uploaded_files_select_policy_uses_can_read_aip",
  "chat_rate_events_status_constraint_exists",
  "consume_chat_quota_exists",
] as const;

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function printFailureReport(
  rowsByKey: Map<string, HardeningCheckRow>,
  missingKeys: string[],
  failingRows: HardeningCheckRow[]
): void {
  console.error("[db-hardening] FAIL");
  console.error(
    `[db-hardening] Required checks: ${EXPECTED_CHECK_KEYS.length}, returned checks: ${rowsByKey.size}`
  );

  if (missingKeys.length > 0) {
    console.error("[db-hardening] Missing checks from RPC response:");
    for (const key of missingKeys) {
      console.error(`  - ${key}`);
    }
  }

  if (failingRows.length > 0) {
    console.error("[db-hardening] Missing/stale required DB objects:");
    for (const row of failingRows) {
      console.error(
        `  - ${row.check_key}: ${row.object_type} ${row.object_name} | ${row.expectation}`
      );
    }
  }
}

function printPassReport(rows: HardeningCheckRow[]): void {
  console.log("[db-hardening] PASS");
  console.log(`[db-hardening] Validated ${rows.length} required checks.`);
  for (const row of rows) {
    console.log(`  - OK ${row.check_key}: ${row.object_name}`);
  }
}

async function main(): Promise<void> {
  const supabaseUrl = readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await client.rpc("inspect_required_db_hardening");
  if (error) {
    if (
      typeof error.message === "string" &&
      error.message.includes("inspect_required_db_hardening")
    ) {
      printFailureReport(
        new Map(),
        ["inspect_required_db_hardening_rpc_available"],
        [
          {
            check_key: "inspect_required_db_hardening_rpc_available",
            object_type: "function",
            object_name: "public.inspect_required_db_hardening()",
            is_present: false,
            expectation:
              "Assertion RPC must exist. Apply March 2026 hardening SQL migrations.",
          },
        ]
      );
      process.exitCode = 1;
      return;
    }

    throw new Error(
      `RPC public.inspect_required_db_hardening failed: ${error.message}`
    );
  }

  if (!Array.isArray(data)) {
    throw new Error("Unexpected RPC response: expected an array of checks.");
  }

  const typedRows = data as HardeningCheckRow[];
  const rowsByKey = new Map<string, HardeningCheckRow>();
  for (const row of typedRows) {
    if (row?.check_key) {
      rowsByKey.set(row.check_key, row);
    }
  }

  const missingKeys = EXPECTED_CHECK_KEYS.filter((key) => !rowsByKey.has(key));
  const failingRows = EXPECTED_CHECK_KEYS.map((key) => rowsByKey.get(key))
    .filter((row): row is HardeningCheckRow => !!row)
    .filter((row) => row.is_present !== true);

  if (missingKeys.length > 0 || failingRows.length > 0) {
    printFailureReport(rowsByKey, missingKeys, failingRows);
    process.exitCode = 1;
    return;
  }

  const passRows = EXPECTED_CHECK_KEYS.map((key) => rowsByKey.get(key))
    .filter((row): row is HardeningCheckRow => !!row);
  printPassReport(passRows);
}

main().catch((error) => {
  console.error("[db-hardening] FAIL");
  console.error(
    `[db-hardening] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
