begin;

-- -----------------------------------------------------------------------------
-- Allow citizens to write activity_log entries only for feedback CRUD actions.
-- -----------------------------------------------------------------------------
drop function if exists public.log_activity(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, jsonb
);

create or replace function public.log_activity(
  p_action text,
  p_entity_table text default null,
  p_entity_id uuid default null,

  p_region_id uuid default null,
  p_province_id uuid default null,
  p_city_id uuid default null,
  p_municipality_id uuid default null,
  p_barangay_id uuid default null,

  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_actor uuid;
  v_actor_role text;
begin
  if p_action is null or length(p_action) = 0 or length(p_action) > 80 then
    raise exception 'invalid action (1..80 chars required)';
  end if;

  if p_entity_table is not null and length(p_entity_table) > 80 then
    raise exception 'invalid entity_table (<= 80 chars)';
  end if;

  v_actor := public.current_user_id();
  v_actor_role := public.current_role_code();

  if not public.is_active_auth() then
    raise exception 'not authorized';
  end if;

  if not (
    public.is_admin()
    or public.is_barangay_official()
    or public.is_city_official()
    or public.is_municipal_official()
    or (
      public.is_citizen()
      and p_entity_table = 'feedback'
      and p_action in ('feedback_created', 'feedback_updated', 'feedback_deleted')
    )
  ) then
    raise exception 'not authorized';
  end if;

  insert into public.activity_log (
    actor_id,
    actor_role,
    action,
    entity_table,
    entity_id,
    region_id,
    province_id,
    city_id,
    municipality_id,
    barangay_id,
    metadata
  ) values (
    v_actor,
    v_actor_role,
    p_action,
    p_entity_table,
    p_entity_id,
    p_region_id,
    p_province_id,
    p_city_id,
    p_municipality_id,
    p_barangay_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.log_activity(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, jsonb
) to authenticated;

-- -----------------------------------------------------------------------------
-- Expand feedback CRUD trigger logging to citizen + municipal roles.
-- -----------------------------------------------------------------------------
create or replace function public.trg_feedback_activity_log_crud()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_actor_name text;
  v_actor_position text;
  v_action text;
  v_details text;
  v_feedback_id uuid;
  v_target_type text;
  v_kind text;
  v_parent_feedback_id uuid;
  v_aip_id uuid;
  v_project_id uuid;
  v_barangay_id uuid;
  v_city_id uuid;
  v_municipality_id uuid;
begin
  v_actor_id := public.current_user_id();
  v_actor_role := public.current_role_code();

  if v_actor_id is null
     or v_actor_role is null
     or v_actor_role not in ('barangay_official', 'city_official', 'municipal_official', 'citizen') then
    return coalesce(new, old);
  end if;

  v_actor_position :=
    case
      when v_actor_role = 'city_official' then 'City Official'
      when v_actor_role = 'municipal_official' then 'Municipal Official'
      when v_actor_role = 'citizen' then 'Citizen'
      else 'Barangay Official'
    end;

  select nullif(trim(p.full_name), '')
    into v_actor_name
  from public.profiles p
  where p.id = v_actor_id;

  if tg_op = 'INSERT' then
    v_action := 'feedback_created';
    v_feedback_id := new.id;
    v_target_type := new.target_type::text;
    v_kind := new.kind::text;
    v_parent_feedback_id := new.parent_feedback_id;
    v_aip_id := new.aip_id;
    v_project_id := new.project_id;
  elsif tg_op = 'UPDATE' then
    v_action := 'feedback_updated';
    v_feedback_id := new.id;
    v_target_type := new.target_type::text;
    v_kind := new.kind::text;
    v_parent_feedback_id := new.parent_feedback_id;
    v_aip_id := new.aip_id;
    v_project_id := new.project_id;
  else
    v_action := 'feedback_deleted';
    v_feedback_id := old.id;
    v_target_type := old.target_type::text;
    v_kind := old.kind::text;
    v_parent_feedback_id := old.parent_feedback_id;
    v_aip_id := old.aip_id;
    v_project_id := old.project_id;
  end if;

  if v_target_type = 'project' and v_project_id is not null then
    select p.aip_id into v_aip_id
    from public.projects p
    where p.id = v_project_id;
  end if;

  if v_aip_id is not null then
    select a.barangay_id, a.city_id, a.municipality_id
      into v_barangay_id, v_city_id, v_municipality_id
    from public.aips a
    where a.id = v_aip_id;
  end if;

  if v_actor_role = 'city_official' and v_city_id is null then
    v_city_id := public.current_city_id();
  end if;
  if v_actor_role = 'municipal_official' and v_municipality_id is null then
    v_municipality_id := public.current_municipality_id();
  end if;
  if v_actor_role = 'citizen' and v_barangay_id is null then
    v_barangay_id := public.current_barangay_id();
  end if;

  if v_action = 'feedback_created' then
    if v_parent_feedback_id is null then
      v_details := format('Created feedback entry (%s).', coalesce(v_kind, 'unknown'));
    else
      v_details := format('Created feedback reply (%s).', coalesce(v_kind, 'unknown'));
    end if;
  elsif v_action = 'feedback_updated' then
    v_details := format('Updated feedback entry (%s).', coalesce(v_kind, 'unknown'));
  else
    v_details := format('Deleted feedback entry (%s).', coalesce(v_kind, 'unknown'));
  end if;

  perform public.log_activity(
    p_action => v_action,
    p_entity_table => 'feedback',
    p_entity_id => v_feedback_id,
    p_region_id => null,
    p_province_id => null,
    p_city_id => v_city_id,
    p_municipality_id => v_municipality_id,
    p_barangay_id => v_barangay_id,
    p_metadata => jsonb_build_object(
      'source', 'crud',
      'actor_name', coalesce(v_actor_name, 'Unknown'),
      'actor_position', v_actor_position,
      'details', v_details,
      'target_type', v_target_type,
      'feedback_kind', v_kind,
      'parent_feedback_id', v_parent_feedback_id,
      'aip_id', v_aip_id,
      'project_id', v_project_id
    )
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_feedback_activity_log_crud on public.feedback;
create trigger trg_feedback_activity_log_crud
after insert or update or delete
on public.feedback
for each row
execute function public.trg_feedback_activity_log_crud();

commit;
