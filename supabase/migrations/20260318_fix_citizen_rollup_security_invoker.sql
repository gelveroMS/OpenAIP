begin;

-- Ensure anon consumers can resolve rollup totals using the view owner's
-- permissions while preserving row filtering in the view definition.
alter view public.v_citizen_dashboard_published_rollups
  set (security_invoker = false, security_barrier = true);

-- Keep public read access for citizen dashboard endpoints.
grant select on public.v_citizen_dashboard_published_rollups to anon, authenticated, service_role;

commit;
