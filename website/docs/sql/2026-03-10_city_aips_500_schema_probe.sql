-- Diagnostic SQL only (read-only).
-- Use this in Supabase SQL Editor when /city/aips or /api/city/aips/upload returns 500.

select
  to_regclass('public.aip_upload_validation_logs') as aip_upload_validation_logs,
  to_regprocedure('public.can_upload_aip_pdf(uuid)') as can_upload_aip_pdf,
  to_regprocedure('public.inspect_required_db_hardening()') as inspect_required_db_hardening;

select column_name
from information_schema.columns
where table_schema='public' and table_name='projects'
  and column_name in (
    'financial_expenses',
    'is_human_edited',
    'edited_by',
    'edited_at',
    'cc_topology_code',
    'prm_ncr_lgu_rm_objective_results_indicator'
  )
order by column_name;

select column_name
from information_schema.columns
where table_schema='public' and table_name='extraction_runs'
  and column_name in (
    'overall_progress_pct',
    'progress_message',
    'error_message',
    'progress_updated_at',
    'created_by',
    'retry_of_run_id',
    'resume_from_stage'
  )
order by column_name;

select column_name
from information_schema.columns
where table_schema='public' and table_name='uploaded_files'
  and column_name in (
    'sha256_hex',
    'mime_type',
    'size_bytes',
    'is_current',
    'uploaded_by'
  )
order by column_name;
