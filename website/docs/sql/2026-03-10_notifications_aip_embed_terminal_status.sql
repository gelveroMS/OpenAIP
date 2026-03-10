begin;

-- =============================================================================
-- Embed terminal notifications for published AIPs
-- - Extends uploader terminal notifications on extraction_runs to:
--   * keep existing non-embed extraction notifications unchanged
--   * emit embed-specific notifications for stage='embed'
-- - Embed notifications are emitted only when parent AIP is published.
-- - Recipient resolution for embed:
--   1) extraction_runs.created_by
--   2) uploaded_files.uploaded_by (current file)
--   3) aips.created_by
-- =============================================================================

create or replace function public.emit_uploader_extraction_terminal_notifications()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_should_emit boolean := false;
  v_is_embed boolean := false;
  v_recipient_user_id uuid := null;
  v_profile record;
  v_aip record;
  v_event_type text;
  v_template_key text;
  v_title text;
  v_message text;
  v_subject text;
  v_scope_type text := 'city';
  v_action_url text := '/notifications';
  v_lgu_name text := null;
  v_barangay_name text := null;
  v_city_name text := null;
  v_entity_label text := 'AIP';
  v_occurred_at timestamptz := coalesce(new.finished_at, now());
  v_error_line text := null;
  v_excerpt text := null;
  v_dedupe_key text;
  v_in_app_enabled boolean := true;
  v_email_enabled boolean := true;
  v_metadata jsonb;
  v_template_data jsonb;
begin
  if tg_op = 'INSERT' then
    v_should_emit := (new.status in ('succeeded', 'failed'));
  elsif tg_op = 'UPDATE' then
    v_should_emit := (new.status in ('succeeded', 'failed') and old.status is distinct from new.status);
  end if;

  if not v_should_emit then
    return new;
  end if;

  v_is_embed := (new.stage = 'embed');

  select
    a.id,
    a.status,
    a.created_by,
    a.fiscal_year,
    a.barangay_id,
    a.city_id,
    a.municipality_id
  into v_aip
  from public.aips a
  where a.id = new.aip_id
  limit 1;

  if not found then
    return new;
  end if;

  if v_is_embed and v_aip.status <> 'published' then
    return new;
  end if;

  v_recipient_user_id := new.created_by;

  if v_is_embed and v_recipient_user_id is null then
    select uf.uploaded_by
    into v_recipient_user_id
    from public.uploaded_files uf
    where uf.aip_id = new.aip_id
      and uf.is_current = true
    order by uf.created_at desc, uf.id desc
    limit 1;

    if v_recipient_user_id is null then
      v_recipient_user_id := v_aip.created_by;
    end if;
  end if;

  if v_recipient_user_id is null then
    return new;
  end if;

  select
    p.id,
    p.role::text as role,
    p.email,
    p.is_active
  into v_profile
  from public.profiles p
  where p.id = v_recipient_user_id
  limit 1;

  if v_is_embed and (not found or coalesce(v_profile.is_active, false) = false) then
    v_recipient_user_id := null;

    select uf.uploaded_by
    into v_recipient_user_id
    from public.uploaded_files uf
    where uf.aip_id = new.aip_id
      and uf.is_current = true
      and uf.uploaded_by is not null
    order by uf.created_at desc, uf.id desc
    limit 1;

    if v_recipient_user_id is null then
      v_recipient_user_id := v_aip.created_by;
    end if;

    if v_recipient_user_id is null then
      return new;
    end if;

    select
      p.id,
      p.role::text as role,
      p.email,
      p.is_active
    into v_profile
    from public.profiles p
    where p.id = v_recipient_user_id
    limit 1;
  end if;

  if not found or coalesce(v_profile.is_active, false) = false then
    return new;
  end if;

  if v_aip.barangay_id is not null then
    select b.name into v_lgu_name from public.barangays b where b.id = v_aip.barangay_id limit 1;
    v_barangay_name := v_lgu_name;
  elsif v_aip.city_id is not null then
    select c.name into v_lgu_name from public.cities c where c.id = v_aip.city_id limit 1;
    v_city_name := v_lgu_name;
  elsif v_aip.municipality_id is not null then
    select m.name into v_lgu_name from public.municipalities m where m.id = v_aip.municipality_id limit 1;
  end if;

  if v_aip.fiscal_year is not null then
    v_entity_label := format('AIP FY %s', v_aip.fiscal_year);
  end if;

  if v_profile.role = 'barangay_official' then
    v_scope_type := 'barangay';
    v_action_url := format('/barangay/aips/%s?run=%s', new.aip_id, new.id);
  elsif v_profile.role in ('city_official', 'municipal_official') then
    v_scope_type := 'city';
    v_action_url := format('/city/aips/%s?run=%s', new.aip_id, new.id);
  elsif v_profile.role = 'admin' then
    v_scope_type := 'admin';
    v_action_url := format('/admin/aip-monitoring?run=%s', new.id);
  else
    v_scope_type := 'citizen';
    v_action_url := '/notifications';
  end if;

  if new.status = 'succeeded' then
    if v_is_embed then
      v_event_type := 'AIP_EMBED_SUCCEEDED';
      v_template_key := 'aip_embed_succeeded';
      v_title := 'AIP embedding completed';
      v_message := 'Search indexing completed successfully for your published AIP.';
      v_subject := 'OpenAIP - AIP search indexing completed';
      v_excerpt := 'Search indexing completed successfully.';
      v_dedupe_key := format(
        'AIP_EMBED_SUCCEEDED:aip:%s:run:%s:status->succeeded',
        new.aip_id,
        new.id
      );
    else
      v_event_type := 'AIP_EXTRACTION_SUCCEEDED';
      v_template_key := 'aip_extraction_succeeded';
      v_title := 'AIP processing completed';
      v_message := 'Your AIP upload was processed successfully.';
      v_subject := 'OpenAIP - AIP upload processing completed';
      v_excerpt := 'Extraction and validation completed successfully.';
      v_dedupe_key := format(
        'AIP_EXTRACTION_SUCCEEDED:aip:%s:run:%s:status->succeeded',
        new.aip_id,
        new.id
      );
    end if;
  else
    v_error_line := split_part(coalesce(new.error_message, ''), E'\n', 1);
    v_error_line := trim(regexp_replace(v_error_line, '[[:space:]]+', ' ', 'g'));
    if v_error_line = '' then
      v_error_line := null;
    end if;
    if v_error_line is not null and length(v_error_line) > 120 then
      v_error_line := rtrim(substr(v_error_line, 1, 117)) || '...';
    end if;
    v_excerpt := coalesce(v_error_line, 'No error details were provided.');

    if v_is_embed then
      v_event_type := 'AIP_EMBED_FAILED';
      v_template_key := 'aip_embed_failed';
      v_title := 'AIP embedding failed';
      v_message := 'AIP search indexing failed. Please review and retry.';
      v_subject := 'OpenAIP - AIP search indexing failed';
      v_dedupe_key := format(
        'AIP_EMBED_FAILED:aip:%s:run:%s:status->failed',
        new.aip_id,
        new.id
      );
    else
      v_event_type := 'AIP_EXTRACTION_FAILED';
      v_template_key := 'aip_extraction_failed';
      v_title := 'AIP processing failed';
      v_message := 'AIP processing failed. Please review and retry.';
      v_subject := 'OpenAIP - AIP upload processing failed';
      v_dedupe_key := format(
        'AIP_EXTRACTION_FAILED:aip:%s:run:%s:status->failed',
        new.aip_id,
        new.id
      );
    end if;
  end if;

  select
    np.in_app_enabled,
    np.email_enabled
  into
    v_in_app_enabled,
    v_email_enabled
  from public.notification_preferences np
  where np.user_id = v_profile.id
    and np.event_type = v_event_type
  limit 1;

  if not found then
    v_in_app_enabled := true;
    v_email_enabled := true;
  end if;

  v_metadata := jsonb_strip_nulls(
    jsonb_build_object(
      'aip_id', new.aip_id,
      'run_id', new.id,
      'stage', new.stage,
      'status', new.status,
      'error_code', new.error_code,
      'error_message', new.error_message,
      'fiscal_year', v_aip.fiscal_year,
      'lgu_name', v_lgu_name,
      'barangay_name', v_barangay_name,
      'city_name', v_city_name,
      'scope_type', v_scope_type,
      'entity_type', 'aip',
      'entity_label', v_entity_label,
      'occurred_at', v_occurred_at,
      'excerpt', v_excerpt,
      'action_url', v_action_url
    )
  );

  v_template_data := jsonb_strip_nulls(
    jsonb_build_object(
      'app_name', 'OpenAIP',
      'event_type', v_event_type,
      'scope_type', v_scope_type,
      'entity_type', 'aip',
      'entity_id', new.aip_id,
      'aip_id', new.aip_id,
      'run_id', new.id,
      'stage', new.stage,
      'status', new.status,
      'error_code', new.error_code,
      'error_message', new.error_message,
      'fiscal_year', v_aip.fiscal_year,
      'lgu_name', v_lgu_name,
      'barangay_name', v_barangay_name,
      'city_name', v_city_name,
      'entity_label', v_entity_label,
      'occurred_at', v_occurred_at,
      'excerpt', v_excerpt,
      'action_url', v_action_url
    )
  );

  if coalesce(v_in_app_enabled, true) then
    insert into public.notifications (
      recipient_user_id,
      recipient_role,
      scope_type,
      event_type,
      entity_type,
      entity_id,
      title,
      message,
      action_url,
      metadata,
      dedupe_key
    )
    values (
      v_profile.id,
      v_profile.role,
      v_scope_type,
      v_event_type,
      'aip',
      new.aip_id,
      v_title,
      v_message,
      v_action_url,
      v_metadata,
      v_dedupe_key
    )
    on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;

  if coalesce(v_email_enabled, true)
     and v_profile.email is not null
     and length(trim(v_profile.email)) > 0 then
    insert into public.email_outbox (
      recipient_user_id,
      to_email,
      template_key,
      subject,
      payload,
      status,
      dedupe_key
    )
    values (
      v_profile.id,
      v_profile.email,
      v_template_key,
      v_subject,
      jsonb_build_object(
        'title', v_title,
        'message', v_message,
        'action_url', v_action_url,
        'notification_ref', v_dedupe_key,
        'event_type', v_event_type,
        'scope_type', v_scope_type,
        'entity_type', 'aip',
        'entity_id', new.aip_id,
        'template_data', v_template_data,
        'metadata', v_metadata
      ),
      'queued',
      v_dedupe_key
    )
    on conflict (to_email, dedupe_key) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_extraction_runs_emit_uploader_terminal_notifications on public.extraction_runs;
create trigger trg_extraction_runs_emit_uploader_terminal_notifications
after insert or update of status on public.extraction_runs
for each row
execute function public.emit_uploader_extraction_terminal_notifications();

commit;
