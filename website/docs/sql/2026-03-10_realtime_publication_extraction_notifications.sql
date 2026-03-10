begin;

-- =============================================================================
-- Realtime publication hardening for extraction + notifications
-- - Ensures both public.extraction_runs and public.notifications are present in
--   the supabase_realtime publication.
-- - Safe to run multiple times.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'extraction_runs'
    ) then
      alter publication supabase_realtime add table public.extraction_runs;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end $$;

commit;
