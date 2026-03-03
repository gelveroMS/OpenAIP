begin;

-- =============================================================================
-- Admin operational notifications for extraction pipeline failures
-- - Emits PIPELINE_JOB_FAILED notifications when extraction_runs transitions to failed.
-- - Queues optional admin email outbox rows for profiles with active email.
-- =============================================================================

drop function if exists public.emit_admin_pipeline_job_failed();
create or replace function public.emit_admin_pipeline_job_failed()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_should_emit boolean := false;
  v_title text;
  v_message text;
  v_dedupe_key text;
  v_action_url text := '/admin/aip-monitoring';
  v_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    v_should_emit := (new.status = 'failed');
  elsif tg_op = 'UPDATE' then
    v_should_emit := (new.status = 'failed' and old.status is distinct from new.status);
  end if;

  if not v_should_emit then
    return new;
  end if;

  v_title := 'AIP pipeline job failed';
  v_message := format(
    'Run %s failed during %s. Review monitoring for details.',
    new.id,
    coalesce(new.stage::text, 'unknown stage')
  );

  v_dedupe_key := format(
    'PIPELINE_JOB_FAILED:system:%s:%s',
    new.id,
    'status->failed'
  );

  v_metadata := jsonb_build_object(
    'run_id', new.id,
    'aip_id', new.aip_id,
    'stage', new.stage,
    'status', new.status,
    'error_code', new.error_code,
    'error_message', new.error_message,
    'trigger_op', tg_op,
    'triggered_at', now()
  );

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
  select
    p.id,
    p.role::text,
    'admin',
    'PIPELINE_JOB_FAILED',
    'system',
    new.id,
    v_title,
    v_message,
    v_action_url,
    v_metadata,
    v_dedupe_key
  from public.profiles p
  where p.role = 'admin'::public.role_type
    and p.is_active = true
  on conflict (recipient_user_id, dedupe_key) do nothing;

  insert into public.email_outbox (
    recipient_user_id,
    to_email,
    template_key,
    subject,
    payload,
    status,
    dedupe_key
  )
  select
    p.id,
    p.email,
    'PIPELINE_JOB_FAILED',
    v_title,
    jsonb_build_object(
      'title', v_title,
      'message', v_message,
      'action_url', v_action_url,
      'event_type', 'PIPELINE_JOB_FAILED',
      'metadata', v_metadata
    ),
    'queued',
    v_dedupe_key
  from public.profiles p
  where p.role = 'admin'::public.role_type
    and p.is_active = true
    and p.email is not null
    and length(trim(p.email)) > 0
  on conflict (to_email, dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_extraction_runs_emit_admin_pipeline_failed on public.extraction_runs;
create trigger trg_extraction_runs_emit_admin_pipeline_failed
after insert or update of status on public.extraction_runs
for each row
execute function public.emit_admin_pipeline_job_failed();

commit;
