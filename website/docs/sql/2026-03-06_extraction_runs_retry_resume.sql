begin;

alter table public.extraction_runs
  add column if not exists retry_of_run_id uuid null references public.extraction_runs(id) on delete set null,
  add column if not exists resume_from_stage public.pipeline_stage null;

create index if not exists idx_extraction_runs_retry_of_run_id
  on public.extraction_runs(retry_of_run_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'extraction_runs_resume_from_stage_requires_retry_chk'
  ) then
    alter table public.extraction_runs
      add constraint extraction_runs_resume_from_stage_requires_retry_chk
      check (
        resume_from_stage is null
        or retry_of_run_id is not null
      );
  end if;
end
$$;

commit;
