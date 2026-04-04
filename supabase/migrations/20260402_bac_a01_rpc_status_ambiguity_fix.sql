begin;

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

  update public.aips as a
  set status = 'for_revision'
  where a.id = v_aip.id
    and a.status = 'under_review';

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

  update public.aips as a
  set status = 'published'
  where a.id = v_aip.id
    and a.status = 'under_review';

  return query
  select v_aip.id, v_actor_id, 'published'::public.aip_status;
end;
$$;

commit;
