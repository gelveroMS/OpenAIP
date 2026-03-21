begin;

-- ---------------------------------------------------------------------------
-- Account deletion preflight guard
-- - Returns blocker categories for profile rows that are protected by
--   ON DELETE RESTRICT references.
-- ---------------------------------------------------------------------------
create or replace function public.get_profile_delete_blockers(p_profile_id uuid)
returns table (
  blocker text,
  row_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with blockers as (
    select 'uploaded_files'::text as blocker, count(*)::bigint as row_count
    from public.uploaded_files uf
    where uf.uploaded_by = p_profile_id

    union all

    select 'aip_reviews'::text as blocker, count(*)::bigint as row_count
    from public.aip_reviews ar
    where ar.reviewer_id = p_profile_id

    union all

    select 'project_updates'::text as blocker, count(*)::bigint as row_count
    from public.project_updates pu
    where pu.posted_by = p_profile_id
  )
  select b.blocker, b.row_count
  from blockers b
  where b.row_count > 0
  order by b.blocker;
$$;

revoke all on function public.get_profile_delete_blockers(uuid) from public;
revoke all on function public.get_profile_delete_blockers(uuid) from anon;
revoke all on function public.get_profile_delete_blockers(uuid) from authenticated;
grant execute on function public.get_profile_delete_blockers(uuid) to service_role;

commit;
