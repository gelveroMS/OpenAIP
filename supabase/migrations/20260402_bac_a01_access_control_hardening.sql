begin;

-- -----------------------------------------------------------------------------
-- BAC-001: Published-only public readability
-- -----------------------------------------------------------------------------
create or replace function public.can_read_aip(p_aip_id uuid)
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
        a.status = 'published'
        or (
          public.is_active_auth()
          and (
            public.is_admin()
            or (
              public.is_barangay_official()
              and a.barangay_id is not null
              and a.barangay_id = public.current_barangay_id()
            )
            or (
              public.is_city_official()
              and (
                (a.city_id is not null and a.city_id = public.current_city_id())
                or (a.barangay_id is not null and public.barangay_in_my_city(a.barangay_id))
              )
            )
            or (
              public.is_municipal_official()
              and (
                (a.municipality_id is not null and a.municipality_id = public.current_municipality_id())
                or (a.barangay_id is not null and public.barangay_in_my_municipality(a.barangay_id))
              )
            )
          )
        )
      )
  );
$$;

drop policy if exists aips_select_policy on public.aips;
create policy aips_select_policy
on public.aips
for select
to anon, authenticated
using (
  status = 'published'
  or (
    public.is_active_auth()
    and (
      public.is_admin()
      or (
        public.is_barangay_official()
        and barangay_id is not null
        and barangay_id = public.current_barangay_id()
      )
      or (
        public.is_city_official()
        and (
          (city_id is not null and city_id = public.current_city_id())
          or (barangay_id is not null and public.barangay_in_my_city(barangay_id))
        )
      )
      or (
        public.is_municipal_official()
        and (
          (municipality_id is not null and municipality_id = public.current_municipality_id())
          or (barangay_id is not null and public.barangay_in_my_municipality(barangay_id))
        )
      )
    )
  )
);

drop policy if exists extraction_artifacts_select_policy on public.extraction_artifacts;
create policy extraction_artifacts_select_policy
on public.extraction_artifacts
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.aips a
    where a.id = extraction_artifacts.aip_id
      and (
        (
          a.status = 'published'
          and extraction_artifacts.artifact_type in ('summarize', 'categorize')
        )
        or (
          public.is_active_auth()
          and public.can_read_aip(a.id)
        )
      )
  )
);

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
        a.status = 'published'
        or (
          public.is_active_auth()
          and public.can_read_aip(a.id)
        )
      )
  )
);

drop view if exists public.v_aip_public_status;
create view public.v_aip_public_status
with (security_invoker = true, security_barrier = true)
as
select
  a.id,
  a.fiscal_year,
  a.status,
  a.status_updated_at,
  a.submitted_at,
  a.published_at,
  a.created_at,
  a.barangay_id,
  a.city_id,
  a.municipality_id,
  case
    when a.barangay_id is not null then 'barangay'
    when a.city_id is not null then 'city'
    when a.municipality_id is not null then 'municipality'
    else 'unknown'
  end as scope_type,
  coalesce(b.name, c.name, m.name) as scope_name
from public.aips a
left join public.barangays b on b.id = a.barangay_id
left join public.cities c on c.id = a.city_id
left join public.municipalities m on m.id = a.municipality_id
where a.status = 'published';

grant select on public.v_aip_public_status to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- BAC-002: Remove reviewer direct status bypass on public.aips
-- -----------------------------------------------------------------------------
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
  )
);

-- -----------------------------------------------------------------------------
-- BAC-002: Harden workflow transition RPCs
-- -----------------------------------------------------------------------------
create or replace function public.claim_aip_review(p_aip_id uuid)
returns table (
  aip_id uuid,
  reviewer_id uuid,
  status public.aip_status
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_aip public.aips%rowtype;
  v_latest record;
  v_actor_id uuid;
  v_has_latest boolean := false;
begin
  if p_aip_id is null then
    raise exception 'AIP id is required.';
  end if;

  if not public.is_active_auth() then
    raise exception 'Unauthorized.';
  end if;

  if not (public.is_admin() or public.is_city_official() or public.is_municipal_official()) then
    raise exception 'Unauthorized.';
  end if;

  v_actor_id := public.current_user_id();
  if v_actor_id is null then
    raise exception 'Unauthorized.';
  end if;

  select *
    into v_aip
  from public.aips
  where id = p_aip_id
  for update;

  if not found then
    raise exception 'AIP not found.';
  end if;

  if v_aip.barangay_id is null then
    raise exception 'AIP is not a barangay submission.';
  end if;

  if v_aip.status not in ('pending_review', 'under_review') then
    raise exception 'AIP is not available for review claim.';
  end if;

  if not public.is_admin() and not (
    (public.is_city_official() and public.barangay_in_my_city(v_aip.barangay_id))
    or (public.is_municipal_official() and public.barangay_in_my_municipality(v_aip.barangay_id))
  ) then
    raise exception 'AIP is outside jurisdiction.';
  end if;

  select r.aip_id, r.reviewer_id, r.action, r.created_at, r.id
    into v_latest
  from public.aip_reviews r
  where r.aip_id = p_aip_id
  order by r.created_at desc, r.id desc
  limit 1;
  v_has_latest := found;

  if v_has_latest
     and v_latest.action = 'claim_review'
     and v_latest.reviewer_id <> v_actor_id
     and not public.is_admin() then
    raise exception 'This AIP is assigned to another reviewer.';
  end if;

  if v_aip.status = 'pending_review' then
    update public.aips
    set status = 'under_review'
    where id = v_aip.id;
    v_aip.status := 'under_review';
  end if;

  if not v_has_latest
     or v_latest.action <> 'claim_review'
     or v_latest.reviewer_id <> v_actor_id then
    insert into public.aip_reviews (aip_id, action, note, reviewer_id)
    values (v_aip.id, 'claim_review', null, v_actor_id);
  end if;

  return query
  select v_aip.id, v_actor_id, v_aip.status;
end;
$$;

create or replace function public.request_aip_revision(
  p_aip_id uuid,
  p_note text
)
returns table (
  aip_id uuid,
  reviewer_id uuid,
  status public.aip_status
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_aip public.aips%rowtype;
  v_latest record;
  v_actor_id uuid;
  v_note text;
begin
  if p_aip_id is null then
    raise exception 'AIP id is required.';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is null then
    raise exception 'Revision comments are required.';
  end if;

  if length(v_note) > 4000 then
    raise exception 'Revision comments must be 4000 characters or less.';
  end if;

  if not public.is_active_auth() then
    raise exception 'Unauthorized.';
  end if;

  if not (public.is_admin() or public.is_city_official() or public.is_municipal_official()) then
    raise exception 'Unauthorized.';
  end if;

  v_actor_id := public.current_user_id();
  if v_actor_id is null then
    raise exception 'Unauthorized.';
  end if;

  select *
    into v_aip
  from public.aips
  where id = p_aip_id
  for update;

  if not found then
    raise exception 'AIP not found.';
  end if;

  if v_aip.barangay_id is null then
    raise exception 'AIP is not a barangay submission.';
  end if;

  if v_aip.status <> 'under_review' then
    raise exception 'Request Revision is only allowed when the AIP is under review.';
  end if;

  if not public.is_admin() and not (
    (public.is_city_official() and public.barangay_in_my_city(v_aip.barangay_id))
    or (public.is_municipal_official() and public.barangay_in_my_municipality(v_aip.barangay_id))
  ) then
    raise exception 'AIP is outside jurisdiction.';
  end if;

  select r.aip_id, r.reviewer_id, r.action, r.created_at, r.id
    into v_latest
  from public.aip_reviews r
  where r.aip_id = p_aip_id
  order by r.created_at desc, r.id desc
  limit 1;

  if not found or v_latest.action <> 'claim_review' then
    raise exception 'Claim review before taking actions.';
  end if;

  if v_latest.reviewer_id <> v_actor_id then
    if public.is_admin() then
      raise exception 'This AIP is assigned to another reviewer. Claim review to take over before taking actions.';
    end if;
    raise exception 'This AIP is assigned to another reviewer.';
  end if;

  insert into public.aip_reviews (aip_id, action, note, reviewer_id)
  values (v_aip.id, 'request_revision', v_note, v_actor_id);

  update public.aips
  set status = 'for_revision'
  where id = v_aip.id
    and status = 'under_review';

  return query
  select v_aip.id, v_actor_id, 'for_revision'::public.aip_status;
end;
$$;

create or replace function public.publish_aip_review(
  p_aip_id uuid,
  p_note text default null
)
returns table (
  aip_id uuid,
  reviewer_id uuid,
  status public.aip_status
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_aip public.aips%rowtype;
  v_latest record;
  v_actor_id uuid;
  v_note text;
begin
  if p_aip_id is null then
    raise exception 'AIP id is required.';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and length(v_note) > 4000 then
    raise exception 'Review note must be 4000 characters or less.';
  end if;

  if not public.is_active_auth() then
    raise exception 'Unauthorized.';
  end if;

  if not (public.is_admin() or public.is_city_official() or public.is_municipal_official()) then
    raise exception 'Unauthorized.';
  end if;

  v_actor_id := public.current_user_id();
  if v_actor_id is null then
    raise exception 'Unauthorized.';
  end if;

  select *
    into v_aip
  from public.aips
  where id = p_aip_id
  for update;

  if not found then
    raise exception 'AIP not found.';
  end if;

  if v_aip.barangay_id is null then
    raise exception 'AIP is not a barangay submission.';
  end if;

  if v_aip.status <> 'under_review' then
    raise exception 'Publish is only allowed when the AIP is under review.';
  end if;

  if not public.is_admin() and not (
    (public.is_city_official() and public.barangay_in_my_city(v_aip.barangay_id))
    or (public.is_municipal_official() and public.barangay_in_my_municipality(v_aip.barangay_id))
  ) then
    raise exception 'AIP is outside jurisdiction.';
  end if;

  select r.aip_id, r.reviewer_id, r.action, r.created_at, r.id
    into v_latest
  from public.aip_reviews r
  where r.aip_id = p_aip_id
  order by r.created_at desc, r.id desc
  limit 1;

  if not found or v_latest.action <> 'claim_review' then
    raise exception 'Claim review before taking actions.';
  end if;

  if v_latest.reviewer_id <> v_actor_id then
    if public.is_admin() then
      raise exception 'This AIP is assigned to another reviewer. Claim review to take over before taking actions.';
    end if;
    raise exception 'This AIP is assigned to another reviewer.';
  end if;

  insert into public.aip_reviews (aip_id, action, note, reviewer_id)
  values (v_aip.id, 'approve', v_note, v_actor_id);

  update public.aips
  set status = 'published'
  where id = v_aip.id
    and status = 'under_review';

  return query
  select v_aip.id, v_actor_id, 'published'::public.aip_status;
end;
$$;

drop policy if exists aip_reviews_insert_policy on public.aip_reviews;
create policy aip_reviews_insert_policy
on public.aip_reviews
for insert
to authenticated
with check (
  public.is_active_auth()
  and reviewer_id = public.current_user_id()
  and (
    public.is_admin()
    or exists (
      select 1
      from public.aips a
      where a.id = aip_reviews.aip_id
        and aip_reviews.action = 'approve'
        and a.status = 'published'
        and (
          (
            public.is_city_official()
            and a.city_id is not null
            and a.city_id = public.current_city_id()
            and a.barangay_id is null
            and a.municipality_id is null
          )
          or (
            public.is_municipal_official()
            and a.municipality_id is not null
            and a.municipality_id = public.current_municipality_id()
            and a.barangay_id is null
            and a.city_id is null
          )
        )
    )
  )
);

revoke all on function public.claim_aip_review(uuid) from public;
revoke all on function public.claim_aip_review(uuid) from anon;
grant execute on function public.claim_aip_review(uuid) to authenticated;
grant execute on function public.claim_aip_review(uuid) to service_role;

revoke all on function public.request_aip_revision(uuid, text) from public;
revoke all on function public.request_aip_revision(uuid, text) from anon;
grant execute on function public.request_aip_revision(uuid, text) to authenticated;
grant execute on function public.request_aip_revision(uuid, text) to service_role;

revoke all on function public.publish_aip_review(uuid, text) from public;
revoke all on function public.publish_aip_review(uuid, text) from anon;
grant execute on function public.publish_aip_review(uuid, text) to authenticated;
grant execute on function public.publish_aip_review(uuid, text) to service_role;

commit;
