begin;

-- =============================================================================
-- Project updates moderation refactor (hide/unhide)
-- - Replaces legacy project_updates status values (flagged/removed) with hidden
-- - Adds moderation metadata columns directly on project_updates
-- - Keeps audit history in activity_log via project_update_hidden/unhidden actions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Add moderation metadata columns
-- -----------------------------------------------------------------------------
alter table public.project_updates
  add column if not exists hidden_reason text null,
  add column if not exists hidden_violation_category text null,
  add column if not exists hidden_at timestamptz null,
  add column if not exists hidden_by uuid null references public.profiles(id) on delete set null;

create index if not exists idx_project_updates_hidden_by
  on public.project_updates(hidden_by)
  where hidden_by is not null;

create index if not exists idx_project_updates_hidden_at
  on public.project_updates(hidden_at desc)
  where hidden_at is not null;

-- -----------------------------------------------------------------------------
-- 2) Relax status constraint, backfill, then tighten to active|hidden
-- -----------------------------------------------------------------------------
alter table public.project_updates
  drop constraint if exists project_updates_status_check;

alter table public.project_updates
  drop constraint if exists chk_project_updates_status;

update public.project_updates
set
  status = 'hidden',
  hidden_at = coalesce(hidden_at, now()),
  hidden_reason = coalesce(hidden_reason, 'Policy violation.')
where status in ('flagged', 'removed');

alter table public.project_updates
  add constraint chk_project_updates_status
  check (status in ('active', 'hidden'));

-- Ensure hidden metadata is cleared for non-hidden rows.
update public.project_updates
set
  hidden_reason = null,
  hidden_violation_category = null,
  hidden_at = null,
  hidden_by = null
where status <> 'hidden';

commit;
