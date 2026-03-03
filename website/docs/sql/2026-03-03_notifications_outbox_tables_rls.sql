begin;

-- =============================================================================
-- Notifications + Email Outbox + Preferences (scaffold)
-- =============================================================================

create table if not exists public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_role text not null,
  scope_type text not null
    check (scope_type in ('barangay', 'city', 'citizen', 'admin')),
  event_type text not null,
  entity_type text not null
    check (entity_type in ('aip', 'project', 'feedback', 'project_update', 'system')),
  entity_id uuid null,
  title text not null,
  message text not null,
  action_url text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz null,
  dedupe_key text not null
);

create unique index if not exists uq_notifications_recipient_dedupe
  on public.notifications(recipient_user_id, dedupe_key);

create index if not exists idx_notifications_recipient_created
  on public.notifications(recipient_user_id, created_at desc);

create index if not exists idx_notifications_unread
  on public.notifications(recipient_user_id, created_at desc)
  where read_at is null;

create index if not exists idx_notifications_event_type
  on public.notifications(event_type);

create index if not exists idx_notifications_entity
  on public.notifications(entity_type, entity_id);

create table if not exists public.email_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  recipient_user_id uuid null references public.profiles(id) on delete set null,
  to_email text not null,
  template_key text not null,
  subject text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed')),
  attempt_count int not null default 0
    check (attempt_count >= 0),
  last_error text null,
  created_at timestamptz not null default now(),
  sent_at timestamptz null,
  dedupe_key text not null
);

create unique index if not exists uq_email_outbox_email_dedupe
  on public.email_outbox(to_email, dedupe_key);

create index if not exists idx_email_outbox_queue
  on public.email_outbox(status, attempt_count, created_at asc);

create index if not exists idx_email_outbox_created
  on public.email_outbox(created_at desc);

create table if not exists public.notification_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_type)
);

drop trigger if exists trg_notification_preferences_set_updated_at on public.notification_preferences;
create trigger trg_notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();

alter table public.notifications enable row level security;
alter table public.email_outbox enable row level security;
alter table public.notification_preferences enable row level security;

drop policy if exists notifications_select_self on public.notifications;
create policy notifications_select_self
on public.notifications
for select
to authenticated
using (
  public.is_active_auth()
  and auth.uid() = recipient_user_id
);

drop policy if exists notifications_update_self on public.notifications;
create policy notifications_update_self
on public.notifications
for update
to authenticated
using (
  public.is_active_auth()
  and auth.uid() = recipient_user_id
)
with check (
  public.is_active_auth()
  and auth.uid() = recipient_user_id
);

-- No insert/delete policies for authenticated. Service-role contexts remain privileged.

drop policy if exists notification_preferences_select_self on public.notification_preferences;
create policy notification_preferences_select_self
on public.notification_preferences
for select
to authenticated
using (
  public.is_active_auth()
  and auth.uid() = user_id
);

drop policy if exists notification_preferences_insert_self on public.notification_preferences;
create policy notification_preferences_insert_self
on public.notification_preferences
for insert
to authenticated
with check (
  public.is_active_auth()
  and auth.uid() = user_id
);

drop policy if exists notification_preferences_update_self on public.notification_preferences;
create policy notification_preferences_update_self
on public.notification_preferences
for update
to authenticated
using (
  public.is_active_auth()
  and auth.uid() = user_id
)
with check (
  public.is_active_auth()
  and auth.uid() = user_id
);

drop function if exists public.notifications_guard_read_update();
create or replace function public.notifications_guard_read_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.recipient_user_id is distinct from old.recipient_user_id
     or new.recipient_role is distinct from old.recipient_role
     or new.scope_type is distinct from old.scope_type
     or new.event_type is distinct from old.event_type
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.title is distinct from old.title
     or new.message is distinct from old.message
     or new.action_url is distinct from old.action_url
     or new.metadata is distinct from old.metadata
     or new.created_at is distinct from old.created_at
     or new.dedupe_key is distinct from old.dedupe_key then
    raise exception 'Only read_at can be updated.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notifications_guard_read_update on public.notifications;
create trigger trg_notifications_guard_read_update
before update on public.notifications
for each row execute function public.notifications_guard_read_update();

grant select, update on public.notifications to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
revoke all on public.email_outbox from anon;
revoke all on public.email_outbox from authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

commit;
