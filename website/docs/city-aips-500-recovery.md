# City AIP 500 Recovery Runbook

Use this runbook when city AIP upload flow returns a generic Next.js `500` page, especially on:
- `POST /api/city/aips/upload`
- `GET /city/aips`

## 1) Capture the first real exception

1. Reproduce once in production.
2. Check server logs for:
   - `[CITY_AIP_UPLOAD_ROUTE][UNHANDLED]`
   - `[AIP_UPLOAD][UNHANDLED]`
   - `[CITY_AIPS_PAGE][LIST_VISIBLE_AIPS_FAILED]`
3. Record the first SQL/runtime error (for example `column ... does not exist`, `function ... does not exist`).

## 2) Run API-backed schema probes

From `website/`:

```bash
npm run diagnose:city-aips-500
```

This checks:
- `public.aip_upload_validation_logs`
- `public.can_upload_aip_pdf(uuid)`
- `public.inspect_required_db_hardening()`
- Required columns in `projects`, `extraction_runs`, `uploaded_files`

If any check fails, the script prints recommended SQL patches.

## 3) Run SQL-editor probes (read-only)

Run:

- `website/docs/sql/2026-03-10_city_aips_500_schema_probe.sql`

This confirms the same objects via `to_regclass`, `to_regprocedure`, and `information_schema.columns`.

## 4) Apply only missing patches

- Missing `aip_upload_validation_logs`:
  - `website/docs/sql/2026-03-06_aip_upload_validation_gating.sql`
- Missing `can_upload_aip_pdf(uuid)`:
  - `website/docs/sql/2026-03-01_barangay_aip_uploader_workflow_lock.sql`
- Missing extraction progress columns:
  - `website/docs/sql/2026-02-19_extraction_run_progress.sql`
- Missing retry/resume columns:
  - `website/docs/sql/2026-03-06_extraction_runs_retry_resume.sql`
- Missing `projects` edit columns (`is_human_edited`, `edited_by`, `edited_at`) or base table columns:
  - `website/docs/sql/database-v2.sql` (safest backfill)

## 5) Redeploy and verify

1. Redeploy website.
2. Verify:
   - `GET /city/aips` returns `200` (no HTML `500`).
   - Invalid upload returns JSON validation failure (not HTML).
   - Valid upload returns `200` with `{ aipId, runId }`.
   - Redirect to `/city/aips/{aipId}` renders correctly.
3. Run hardening assertion:

```bash
npm run db:assert-hardening
```
