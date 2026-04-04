do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'review_action'
      and e.enumlabel = 'force_unclaim'
  ) then
    alter type public.review_action add value 'force_unclaim';
  end if;
end
$$;

create or replace function public.force_unclaim_aip_review(
  p_aip_id uuid,
  p_note text
)
returns table (
  aip_id uuid,
  previous_reviewer_id uuid,
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

  v_note := btrim(coalesce(p_note, ''));
  if v_note = '' then
    raise exception 'Admin message is required.';
  end if;
  if length(v_note) > 4000 then
    raise exception 'Admin message exceeds 4000 characters.';
  end if;

  if not public.is_active_auth() then
    raise exception 'Unauthorized.';
  end if;

  if not public.is_admin() then
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
    raise exception 'Force unclaim is only allowed when the AIP is under review.';
  end if;

  select r.aip_id, r.reviewer_id, r.action, r.created_at, r.id
    into v_latest
  from public.aip_reviews r
  where r.aip_id = p_aip_id
  order by r.created_at desc, r.id desc
  limit 1;

  if not found or v_latest.action <> 'claim_review' then
    raise exception 'AIP has no active review claim.';
  end if;

  update public.aips
  set status = 'pending_review'
  where id = v_aip.id;
  v_aip.status := 'pending_review';

  insert into public.aip_reviews (aip_id, action, note, reviewer_id)
  values (v_aip.id, 'force_unclaim', v_note, v_actor_id);

  return query
  select v_aip.id, v_latest.reviewer_id, v_aip.status;
end;
$$;

grant execute on function public.force_unclaim_aip_review(uuid, text) to authenticated;
grant execute on function public.force_unclaim_aip_review(uuid, text) to service_role;
