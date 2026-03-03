begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.dispatch_embed_categorize_for_aip(p_aip_id uuid)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_aip public.aips%rowtype;
  v_url text := nullif(current_setting('app.embed_categorize_url', true), '');
  v_secret text := null;
  v_audience text := nullif(current_setting('app.embed_categorize_audience', true), '');
  v_scope_type text := 'unknown';
  v_scope_id uuid := null;
  v_job_request_id uuid := extensions.gen_random_uuid();
  v_job_ts text := floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_job_nonce text := extensions.gen_random_uuid()::text;
  v_payload jsonb;
  v_payload_text text;
  v_job_sig text;
  v_http_request_id bigint := null;
begin
  -- Hosted-safe fallback: app.settings + app.embed_categorize_url()
  if v_url is null then
    begin
      select nullif(app.embed_categorize_url(), '') into v_url;
    exception
      when undefined_function or invalid_schema_name then
        v_url := null;
      when others then
        v_url := null;
    end;
  end if;

  if v_audience is null then
    begin
      select nullif(s.value, '')
      into v_audience
      from app.settings s
      where s.key = 'embed_categorize_audience'
      limit 1;
    exception
      when undefined_table or invalid_schema_name then
        v_audience := null;
      when others then
        v_audience := null;
    end;
  end if;

  if v_audience is null or btrim(v_audience) = '' then
    v_audience := 'embed-categorize-dispatcher';
  end if;

  select *
  into v_aip
  from public.aips
  where id = p_aip_id;

  if not found then
    raise warning 'dispatch_embed_categorize_for_aip aip % not found', p_aip_id;
    return null;
  end if;

  begin
    select ds.decrypted_secret
    into v_secret
    from vault.decrypted_secrets ds
    where ds.name = 'embed_categorize_job_secret'
    order by ds.created_at desc nulls last
    limit 1;
  exception
    when others then
      v_secret := null;
  end;

  if v_secret is null or btrim(v_secret) = '' then
    v_secret := current_setting('app.embed_categorize_secret', true);
  end if;

  if v_aip.barangay_id is not null then
    v_scope_type := 'barangay';
    v_scope_id := v_aip.barangay_id;
  elsif v_aip.city_id is not null then
    v_scope_type := 'city';
    v_scope_id := v_aip.city_id;
  elsif v_aip.municipality_id is not null then
    v_scope_type := 'municipality';
    v_scope_id := v_aip.municipality_id;
  end if;

  if v_url is null or btrim(v_url) = '' then
    raise warning 'dispatch_embed_categorize_for_aip missing app.embed_categorize_url/app.embed_categorize_url() for aip %', p_aip_id;
    return null;
  end if;

  if v_secret is null or btrim(v_secret) = '' then
    raise warning 'dispatch_embed_categorize_for_aip missing secret for aip %', p_aip_id;
    return null;
  end if;

  v_payload := jsonb_build_object(
    'aip_id', v_aip.id,
    'request_id', v_job_request_id::text,
    'published_at', v_aip.published_at,
    'fiscal_year', v_aip.fiscal_year,
    'scope_type', v_scope_type,
    'scope_id', v_scope_id,
    'barangay_id', v_aip.barangay_id,
    'city_id', v_aip.city_id,
    'municipality_id', v_aip.municipality_id
  );

  -- Keep canonical payload identical to function-side verifier.
  v_payload_text := v_payload::text;
  v_job_sig := encode(
    extensions.hmac(
      convert_to(v_audience || '|' || v_job_ts || '|' || v_job_nonce || '|' || v_payload_text, 'utf8'),
      convert_to(v_secret, 'utf8'),
      'sha256'
    ),
    'hex'
  );

  v_http_request_id := net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Job-Ts', v_job_ts,
      'X-Job-Nonce', v_job_nonce,
      'X-Job-Sig', v_job_sig
    ),
    body := v_payload
  );

  raise log
    'dispatch_embed_categorize_for_aip queued aip %, request_id %, net_http_request_id %',
    p_aip_id,
    v_job_request_id,
    v_http_request_id;
  return v_http_request_id;
exception
  when others then
    raise warning 'dispatch_embed_categorize_for_aip failed for aip %: %', p_aip_id, sqlerrm;
    return null;
end;
$$;

revoke all on function public.dispatch_embed_categorize_for_aip(uuid) from public;
revoke all on function public.dispatch_embed_categorize_for_aip(uuid) from anon;
revoke all on function public.dispatch_embed_categorize_for_aip(uuid) from authenticated;
grant execute on function public.dispatch_embed_categorize_for_aip(uuid) to service_role;

commit;
