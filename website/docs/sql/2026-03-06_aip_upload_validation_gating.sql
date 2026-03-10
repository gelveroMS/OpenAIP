begin;

create table if not exists public.aip_upload_validation_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid null references public.profiles(id) on delete set null,
  lgu_id uuid null,
  lgu_level text null check (lgu_level in ('barangay', 'city')),
  selected_year int null check (selected_year >= 2000 and selected_year <= 2100),
  detected_year int null check (detected_year >= 2000 and detected_year <= 2100),
  detected_lgu_name text null,
  detected_lgu_level text null check (detected_lgu_level in ('barangay', 'city')),
  file_name text null,
  sanitized_file_name text null,
  file_size bigint null check (file_size is null or file_size >= 0),
  file_hash_sha256 text null check (file_hash_sha256 is null or file_hash_sha256 ~ '^[0-9a-f]{64}$'),
  page_count int null check (page_count is null or page_count >= 0),
  storage_path text null,
  status text not null check (status in ('accepted', 'rejected')),
  rejection_code text null,
  rejection_details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_aip_upload_validation_logs_user_created_at
  on public.aip_upload_validation_logs(user_id, created_at desc);

create index if not exists idx_aip_upload_validation_logs_lgu_year
  on public.aip_upload_validation_logs(lgu_id, lgu_level, selected_year);

create index if not exists idx_aip_upload_validation_logs_hash
  on public.aip_upload_validation_logs(file_hash_sha256);

create index if not exists idx_aip_upload_validation_logs_status_created_at
  on public.aip_upload_validation_logs(status, created_at desc);

create index if not exists idx_uploaded_files_sha256_hex
  on public.uploaded_files(sha256_hex);

alter table public.aip_upload_validation_logs enable row level security;

drop policy if exists aip_upload_validation_logs_select_policy on public.aip_upload_validation_logs;
create policy aip_upload_validation_logs_select_policy
on public.aip_upload_validation_logs
for select
to authenticated
using (public.is_active_auth() and public.is_admin());

revoke all on public.aip_upload_validation_logs from anon, authenticated;
grant select on public.aip_upload_validation_logs to authenticated;

commit;
