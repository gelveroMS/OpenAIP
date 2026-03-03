begin;

alter table if exists public.chat_rate_events
  drop constraint if exists chat_rate_events_event_status_check;

alter table if exists public.chat_rate_events
  add constraint chat_rate_events_event_status_check
  check (
    event_status in (
      'accepted',
      'rejected_minute',
      'rejected_hour',
      'rejected_day'
    )
  );

drop function if exists public.consume_chat_quota(uuid, int, int, text);

create or replace function public.consume_chat_quota(
  p_user_id uuid,
  p_per_hour int default 20,
  p_per_day int default 200,
  p_route text default 'barangay_chat_message'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_hour_count int := 0;
  v_day_count int := 0;
  v_remaining_hour int := 0;
  v_remaining_day int := 0;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_per_hour < 1 or p_per_hour > 100000 then
    raise exception 'p_per_hour must be between 1 and 100000';
  end if;

  if p_per_day < 1 or p_per_day > 100000 then
    raise exception 'p_per_day must be between 1 and 100000';
  end if;

  select count(*)::int
    into v_hour_count
  from public.chat_rate_events
  where user_id = p_user_id
    and event_status = 'accepted'
    and created_at >= v_now - interval '1 hour';

  select count(*)::int
    into v_day_count
  from public.chat_rate_events
  where user_id = p_user_id
    and event_status = 'accepted'
    and created_at >= date_trunc('day', v_now);

  if v_hour_count >= p_per_hour then
    insert into public.chat_rate_events (user_id, route, event_status)
    values (p_user_id, coalesce(nullif(trim(p_route), ''), 'barangay_chat_message'), 'rejected_hour');

    return jsonb_build_object(
      'allowed', false,
      'reason', 'hour_limit',
      'remaining_hour', 0,
      'remaining_day', greatest(0, p_per_day - v_day_count)
    );
  end if;

  if v_day_count >= p_per_day then
    insert into public.chat_rate_events (user_id, route, event_status)
    values (p_user_id, coalesce(nullif(trim(p_route), ''), 'barangay_chat_message'), 'rejected_day');

    return jsonb_build_object(
      'allowed', false,
      'reason', 'day_limit',
      'remaining_hour', greatest(0, p_per_hour - v_hour_count),
      'remaining_day', 0
    );
  end if;

  insert into public.chat_rate_events (user_id, route, event_status)
  values (p_user_id, coalesce(nullif(trim(p_route), ''), 'barangay_chat_message'), 'accepted');

  v_remaining_hour := greatest(0, p_per_hour - (v_hour_count + 1));
  v_remaining_day := greatest(0, p_per_day - (v_day_count + 1));

  return jsonb_build_object(
    'allowed', true,
    'reason', 'ok',
    'remaining_hour', v_remaining_hour,
    'remaining_day', v_remaining_day
  );
end;
$$;

revoke all on function public.consume_chat_quota(uuid, int, int, text) from public;
revoke all on function public.consume_chat_quota(uuid, int, int, text) from anon;
revoke all on function public.consume_chat_quota(uuid, int, int, text) from authenticated;
grant execute on function public.consume_chat_quota(uuid, int, int, text) to service_role;

delete from app.settings
where key = 'controls.chatbot_policy';

create or replace function public.inspect_required_db_hardening()
returns table (
  check_key text,
  object_type text,
  object_name text,
  is_present boolean,
  expectation text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with fn_oids as (
    select
      to_regprocedure('public.can_manage_barangay_aip(uuid)') as can_manage_oid,
      to_regprocedure('public.can_edit_aip(uuid)') as can_edit_oid,
      to_regprocedure('public.can_upload_aip_pdf(uuid)') as can_upload_oid,
      to_regprocedure('public.consume_chat_quota(uuid,integer,integer,text)') as consume_quota_oid
  ),
  fn_src as (
    select
      lower(coalesce(edit_proc.prosrc, '')) as can_edit_src,
      lower(coalesce(upload_proc.prosrc, '')) as can_upload_src
    from fn_oids f
    left join pg_proc edit_proc
      on edit_proc.oid = f.can_edit_oid
    left join pg_proc upload_proc
      on upload_proc.oid = f.can_upload_oid
  ),
  aip_policy as (
    select
      lower(coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')) as policy_using,
      lower(coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) as policy_with_check
    from pg_policy pol
    join pg_class cls
      on cls.oid = pol.polrelid
    join pg_namespace nsp
      on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relname = 'aips'
      and pol.polname = 'aips_update_policy'
    limit 1
  ),
  uploaded_files_policy as (
    select
      lower(coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')) as policy_using
    from pg_policy pol
    join pg_class cls
      on cls.oid = pol.polrelid
    join pg_namespace nsp
      on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relname = 'uploaded_files'
      and pol.polname = 'uploaded_files_select_policy'
    limit 1
  ),
  chat_rate_status_constraint as (
    select exists (
      select 1
      from pg_constraint con
      join pg_class cls
        on cls.oid = con.conrelid
      join pg_namespace nsp
        on nsp.oid = cls.relnamespace
      where nsp.nspname = 'public'
        and cls.relname = 'chat_rate_events'
        and con.conname = 'chat_rate_events_event_status_check'
    ) as constraint_exists
  )
  select
    'can_manage_barangay_aip_exists'::text as check_key,
    'function'::text as object_type,
    'public.can_manage_barangay_aip(uuid)'::text as object_name,
    (select can_manage_oid is not null from fn_oids) as is_present,
    'Function exists for barangay uploader workflow lock.'::text as expectation
  union all
  select
    'can_edit_aip_uses_uploader_lock',
    'function_definition',
    'public.can_edit_aip(uuid)',
    (select can_edit_src like '%public.can_manage_barangay_aip(a.id)%' from fn_src),
    'Function definition must call public.can_manage_barangay_aip(a.id).'
  union all
  select
    'can_upload_aip_pdf_uses_uploader_lock',
    'function_definition',
    'public.can_upload_aip_pdf(uuid)',
    (select can_upload_src like '%public.can_manage_barangay_aip(a.id)%' from fn_src),
    'Function definition must call public.can_manage_barangay_aip(a.id).'
  union all
  select
    'aips_update_policy_uses_uploader_lock',
    'policy_definition',
    'public.aips.aips_update_policy',
    (
      select
        policy_using like '%can_manage_barangay_aip(%'
        and policy_with_check like '%can_manage_barangay_aip(%'
      from aip_policy
    ),
    'RLS policy using/with check must require public.can_manage_barangay_aip(id).'
  union all
  select
    'uploaded_files_select_policy_uses_can_read_aip',
    'policy_definition',
    'public.uploaded_files.uploaded_files_select_policy',
    (
      select policy_using like '%can_read_aip(%'
      from uploaded_files_policy
    ),
    'RLS policy must use public.can_read_aip(a.id) for draft read path.'
  union all
  select
    'chat_rate_events_status_constraint_exists',
    'constraint',
    'public.chat_rate_events.chat_rate_events_event_status_check',
    (select constraint_exists from chat_rate_status_constraint),
    'Constraint must exist for accepted/rejected_minute/rejected_hour/rejected_day statuses.'
  union all
  select
    'consume_chat_quota_exists',
    'function',
    'public.consume_chat_quota(uuid, int, int, text)',
    (select consume_quota_oid is not null from fn_oids),
    'Function must exist for chat quota enforcement.'
  ;
$$;

revoke all on function public.inspect_required_db_hardening() from public;
revoke all on function public.inspect_required_db_hardening() from anon;
revoke all on function public.inspect_required_db_hardening() from authenticated;
grant execute on function public.inspect_required_db_hardening() to service_role;

commit;
