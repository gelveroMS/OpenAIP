begin;

-- ============================================================================
-- Barangay AIP workflow lock: only the current uploader (or created_by fallback)
-- can modify barangay draft/for_revision workflows.
-- ============================================================================

create or replace function public.can_manage_barangay_aip(p_aip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.aips a
    left join lateral (
      select uf.uploaded_by
      from public.uploaded_files uf
      where uf.aip_id = a.id
        and uf.is_current = true
      order by uf.created_at desc, uf.id desc
      limit 1
    ) current_file on true
    where a.id = p_aip_id
      and a.barangay_id is not null
      and public.is_active_auth()
      and public.is_barangay_official()
      and a.barangay_id = public.current_barangay_id()
      and coalesce(current_file.uploaded_by, a.created_by) = public.current_user_id()
  );
$$;

create or replace function public.can_edit_aip(p_aip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.aips a
    where a.id = p_aip_id
      and (
        public.is_admin()
        or (
          public.is_active_auth()
          and a.status in ('draft','for_revision')
          and (
            (
              public.is_barangay_official()
              and a.barangay_id is not null
              and a.barangay_id = public.current_barangay_id()
              and public.can_manage_barangay_aip(a.id)
            )
            or
            (public.is_city_official() and a.city_id is not null and a.city_id = public.current_city_id())
            or
            (public.is_municipal_official() and a.municipality_id is not null and a.municipality_id = public.current_municipality_id())
          )
        )
      )
  );
$$;

create or replace function public.can_upload_aip_pdf(p_aip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.aips a
    where a.id = p_aip_id
      and (
        public.is_admin()
        or (
          a.status in ('draft','for_revision')
          and (
            (
              public.is_barangay_official()
              and a.barangay_id is not null
              and a.barangay_id = public.current_barangay_id()
              and public.can_manage_barangay_aip(a.id)
            )
            or
            (public.is_city_official() and a.city_id is not null and a.city_id = public.current_city_id())
            or
            (public.is_municipal_official() and a.municipality_id is not null and a.municipality_id = public.current_municipality_id())
          )
        )
      )
  );
$$;

drop policy if exists aips_update_policy on public.aips;
create policy aips_update_policy
on public.aips
for update
to authenticated
using (
  public.is_active_auth()
  and (
    public.is_admin()
    or (
      public.is_barangay_official()
      and barangay_id is not null
      and barangay_id = public.current_barangay_id()
      and public.can_manage_barangay_aip(id)
    )
    or (
      public.is_city_official()
      and city_id is not null
      and city_id = public.current_city_id()
    )
    or (
      public.is_municipal_official()
      and municipality_id is not null
      and municipality_id = public.current_municipality_id()
    )
    or (
      public.is_city_official()
      and barangay_id is not null
      and public.barangay_in_my_city(barangay_id)
    )
    or (
      public.is_municipal_official()
      and barangay_id is not null
      and public.barangay_in_my_municipality(barangay_id)
    )
  )
)
with check (
  public.is_active_auth()
  and (
    public.is_admin()
    or (
      public.is_barangay_official()
      and barangay_id is not null
      and barangay_id = public.current_barangay_id()
      and city_id is null and municipality_id is null
      and public.can_manage_barangay_aip(id)
    )
    or (
      public.is_city_official()
      and city_id is not null
      and city_id = public.current_city_id()
      and barangay_id is null and municipality_id is null
    )
    or (
      public.is_municipal_official()
      and municipality_id is not null
      and municipality_id = public.current_municipality_id()
      and barangay_id is null and city_id is null
    )
    or (
      public.is_city_official()
      and barangay_id is not null
      and public.barangay_in_my_city(barangay_id)
      and city_id is null and municipality_id is null
    )
    or (
      public.is_municipal_official()
      and barangay_id is not null
      and public.barangay_in_my_municipality(barangay_id)
      and city_id is null and municipality_id is null
    )
  )
);

-- Keep read visibility for uploaded file metadata decoupled from upload/edit rights.
drop policy if exists uploaded_files_select_policy on public.uploaded_files;
create policy uploaded_files_select_policy
on public.uploaded_files
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.aips a
    where a.id = uploaded_files.aip_id
      and (
        a.status <> 'draft'
        or (
          public.is_active_auth()
          and public.can_read_aip(a.id)
        )
      )
  )
);

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
