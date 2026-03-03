begin;

-- =============================================================================
-- Phase 0) Extensions + schemas + baseline safety setup
-- =============================================================================

-- 0.1) Dedicated schema for extensions (avoid installing into public)
create schema if not exists extensions;

-- 0.2) Required extensions (installed into extensions schema)
-- pgcrypto: gen_random_uuid(), cryptographic helpers
create extension if not exists pgcrypto with schema extensions;

-- vector: pgvector for embeddings
create extension if not exists vector with schema extensions;

-- 0.3) Baseline privileges hardening
-- Note: Supabase/PostgREST will expose objects in schemas included in the API settings.
-- We keep extensions schema non-API and do not grant extra access beyond default.
revoke all on schema extensions from public;

-- 0.4) Helper: consistent "now" timestamp (optional convenience; safe, stable)
-- (OPTIONAL) If you prefer not to add utility functions, remove this.
create or replace function public.now_utc()
returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select now();
$$;

commit;

begin;

-- =============================================================================
-- Phase 1) Geo master tables (PSGC subset) + public SELECT(active) + consistency triggers
-- NOTE: Admin policies are intentionally deferred to Phase 2 (per request),
--       so this phase does NOT reference public.is_admin()/public.is_active_auth().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1) Regions
-- -----------------------------------------------------------------------------
create table if not exists public.regions (
  id uuid primary key default extensions.gen_random_uuid(),
  psgc_code text not null unique,
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint chk_regions_psgc check (psgc_code ~ '^[0-9]{2}$')
);

-- -----------------------------------------------------------------------------
-- 1.2) Provinces (region required)
-- -----------------------------------------------------------------------------
create table if not exists public.provinces (
  id uuid primary key default extensions.gen_random_uuid(),
  region_id uuid not null references public.regions(id) on delete restrict,
  psgc_code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint uq_provinces_region_name unique (region_id, name),
  constraint chk_provinces_psgc check (psgc_code ~ '^[0-9]{4}$')
);

create index if not exists idx_provinces_region_id
  on public.provinces(region_id);

-- -----------------------------------------------------------------------------
-- 1.3) Cities
-- - region_id always required
-- - province_id nullable for independent/HUC
-- - if province_id is not NULL, province.region_id must match cities.region_id
-- -----------------------------------------------------------------------------
create table if not exists public.cities (
  id uuid primary key default extensions.gen_random_uuid(),
  region_id uuid not null references public.regions(id) on delete restrict,
  province_id uuid null references public.provinces(id) on delete restrict,
  psgc_code text not null unique,
  name text not null,
  is_independent boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint chk_cities_psgc check (psgc_code ~ '^[0-9]{6}$'),
  constraint chk_city_independent_consistency check (
    (province_id is null and is_independent = true)
    or
    (province_id is not null)
  )
);

create index if not exists idx_cities_region_id
  on public.cities(region_id);

create index if not exists idx_cities_province_id
  on public.cities(province_id);

-- -----------------------------------------------------------------------------
-- 1.4) Municipalities (province required)
-- -----------------------------------------------------------------------------
create table if not exists public.municipalities (
  id uuid primary key default extensions.gen_random_uuid(),
  province_id uuid not null references public.provinces(id) on delete restrict,
  psgc_code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint uq_municipalities_province_name unique (province_id, name),
  constraint chk_municipalities_psgc check (psgc_code ~ '^[0-9]{6}$')
);

create index if not exists idx_municipalities_province_id
  on public.municipalities(province_id);

-- -----------------------------------------------------------------------------
-- 1.5) Barangays (exactly one parent: city XOR municipality)
-- -----------------------------------------------------------------------------
create table if not exists public.barangays (
  id uuid primary key default extensions.gen_random_uuid(),
  city_id uuid null references public.cities(id) on delete restrict,
  municipality_id uuid null references public.municipalities(id) on delete restrict,
  psgc_code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint chk_barangays_psgc check (psgc_code ~ '^[0-9]{9}$'),
  constraint chk_barangay_parent_xor check (
    (city_id is not null and municipality_id is null)
    or
    (city_id is null and municipality_id is not null)
  ),
  constraint uq_barangay_parent_name unique (city_id, municipality_id, name)
);

create index if not exists idx_barangays_city_id
  on public.barangays(city_id);

create index if not exists idx_barangays_municipality_id
  on public.barangays(municipality_id);

-- -----------------------------------------------------------------------------
-- 1.6) Consistency trigger: if cities.province_id is set,
--      provinces.region_id must match cities.region_id
-- -----------------------------------------------------------------------------
create or replace function public.enforce_city_region_consistency()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_region_id uuid;
begin
  if new.province_id is null then
    return new;
  end if;

  select p.region_id
    into v_region_id
  from public.provinces p
  where p.id = new.province_id;

  if v_region_id is null then
    raise exception 'cities.province_id must reference an existing province';
  end if;

  if new.region_id <> v_region_id then
    raise exception 'cities.region_id must match the region of its province';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_cities_region_consistency on public.cities;
create trigger trg_cities_region_consistency
before insert or update of region_id, province_id
on public.cities
for each row
execute function public.enforce_city_region_consistency();

-- -----------------------------------------------------------------------------
-- 1.7) RLS: public can SELECT active (admin policies deferred to Phase 2)
-- - One permissive SELECT policy per table
-- - Explicit TO anon, authenticated (no accidental PUBLIC coverage)
-- -----------------------------------------------------------------------------
alter table public.regions enable row level security;
alter table public.provinces enable row level security;
alter table public.cities enable row level security;
alter table public.municipalities enable row level security;
alter table public.barangays enable row level security;

drop policy if exists regions_select_active on public.regions;
create policy regions_select_active
on public.regions
for select
to anon, authenticated
using (is_active = true);

drop policy if exists provinces_select_active on public.provinces;
create policy provinces_select_active
on public.provinces
for select
to anon, authenticated
using (is_active = true);

drop policy if exists cities_select_active on public.cities;
create policy cities_select_active
on public.cities
for select
to anon, authenticated
using (is_active = true);

drop policy if exists municipalities_select_active on public.municipalities;
create policy municipalities_select_active
on public.municipalities
for select
to anon, authenticated
using (is_active = true);

drop policy if exists barangays_select_active on public.barangays;
create policy barangays_select_active
on public.barangays
for select
to anon, authenticated
using (is_active = true);

commit;

begin;

-- =============================================================================
-- Phase 2 (REVISED) — Profiles + role/scope binding + hardened helpers + admin geo policies
-- Pattern A: Admin creates/invites auth user first, then inserts profile row.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2.1) Role type (ENUM) for profiles
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'role_type') then
    create type public.role_type as enum (
      'citizen',
      'barangay_official',
      'city_official',
      'municipal_official',
      'admin'
    );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2.2) Profiles table
-- - id must equal auth.users.id
-- - admin inserts officials; citizens may self-insert as citizen only
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key, -- equals auth.users.id
  role public.role_type not null default 'citizen',

  full_name text null,
  email text null,

  -- Scope binding
  barangay_id uuid null references public.barangays(id) on delete restrict,
  city_id uuid null references public.cities(id) on delete restrict,
  municipality_id uuid null references public.municipalities(id) on delete restrict,

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_profiles_scope_binding check (
    -- Admin: no geo binding
    (role = 'admin'
      and barangay_id is null and city_id is null and municipality_id is null)
    or
    -- City official: city only
    (role = 'city_official'
      and city_id is not null and barangay_id is null and municipality_id is null)
    or
    -- Municipal official: municipality only
    (role = 'municipal_official'
      and municipality_id is not null and barangay_id is null and city_id is null)
    or
    -- Citizen + Barangay official: barangay only (citizen requires barangay)
    (role in ('citizen','barangay_official')
      and barangay_id is not null and city_id is null and municipality_id is null)
  )
);

-- Optional uniqueness on email (case-insensitive) when present
create unique index if not exists uq_profiles_email_lower
  on public.profiles ((lower(email)))
  where email is not null;

create index if not exists idx_profiles_role
  on public.profiles(role);

create index if not exists idx_profiles_barangay_id
  on public.profiles(barangay_id);

create index if not exists idx_profiles_city_id
  on public.profiles(city_id);

create index if not exists idx_profiles_municipality_id
  on public.profiles(municipality_id);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2.3) Hardened auth helper functions (avoid RLS init-plan warnings)
-- -----------------------------------------------------------------------------
create or replace function public.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid());
$$;

create or replace function public.current_auth_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.role());
$$;

create or replace function public.is_active_auth()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null;
$$;

create or replace function public.current_role()
returns public.role_type
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid());
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_role() = 'admin'::public.role_type;
$$;

create or replace function public.is_citizen()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_role() = 'citizen'::public.role_type;
$$;

create or replace function public.is_barangay_official()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_role() = 'barangay_official'::public.role_type;
$$;

create or replace function public.is_city_official()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_role() = 'city_official'::public.role_type;
$$;

create or replace function public.is_municipal_official()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_role() = 'municipal_official'::public.role_type;
$$;

create or replace function public.current_barangay_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.barangay_id
  from public.profiles p
  where p.id = (select auth.uid());
$$;

create or replace function public.current_city_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.city_id
  from public.profiles p
  where p.id = (select auth.uid());
$$;

create or replace function public.current_municipality_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.municipality_id
  from public.profiles p
  where p.id = (select auth.uid());
$$;

-- Reviewer scope helpers (needed later for AIP review rules)
create or replace function public.barangay_in_my_city(p_barangay_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.barangays b
    where b.id = p_barangay_id
      and b.city_id is not null
      and b.city_id = public.current_city_id()
  );
$$;

create or replace function public.barangay_in_my_municipality(p_barangay_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.barangays b
    where b.id = p_barangay_id
      and b.municipality_id is not null
      and b.municipality_id = public.current_municipality_id()
  );
$$;

-- -----------------------------------------------------------------------------
-- 2.4) Prevent non-admins from changing protected profile fields
-- - Non-admin may only change full_name (and updated_at via trigger)
-- -----------------------------------------------------------------------------
create or replace function public.enforce_profile_update_rules()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
begin
  v_uid := (select auth.uid());
  v_is_admin := (public.current_role() = 'admin'::public.role_type);

  -- If not authenticated, block
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Admin can update anything
  if v_is_admin then
    return new;
  end if;

  -- Non-admin: can only update their own row
  if old.id <> v_uid then
    raise exception 'Not permitted';
  end if;

  -- Protected fields must not change
  if new.role is distinct from old.role then
    raise exception 'role is admin-managed';
  end if;

  if new.email is distinct from old.email then
    raise exception 'email is admin-managed';
  end if;

  if new.is_active is distinct from old.is_active then
    raise exception 'is_active is admin-managed';
  end if;

  if new.barangay_id is distinct from old.barangay_id
     or new.city_id is distinct from old.city_id
     or new.municipality_id is distinct from old.municipality_id then
    raise exception 'scope is admin-managed';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_enforce_update_rules on public.profiles;
create trigger trg_profiles_enforce_update_rules
before update on public.profiles
for each row execute function public.enforce_profile_update_rules();

-- -----------------------------------------------------------------------------
-- 2.4A) Account administration hardening
-- - Prevent mutating/deleting the last active admin account
-- -----------------------------------------------------------------------------
create or replace function public.prevent_last_active_admin_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_active_admin_count bigint;
begin
  -- UPDATE path:
  -- Block if this row is currently an active admin and update would remove that.
  if tg_op = 'UPDATE' then
    if old.role = 'admin'::public.role_type and old.is_active = true then
      if not (new.role = 'admin'::public.role_type and new.is_active = true) then
        select count(*)::bigint
          into v_active_admin_count
        from public.profiles p
        where p.role = 'admin'::public.role_type
          and p.is_active = true;

        if v_active_admin_count <= 1 then
          raise exception 'Cannot modify the last active admin account.';
        end if;
      end if;
    end if;
    return new;
  end if;

  -- DELETE path:
  -- Block deleting the last active admin.
  if tg_op = 'DELETE' then
    if old.role = 'admin'::public.role_type and old.is_active = true then
      select count(*)::bigint
        into v_active_admin_count
      from public.profiles p
      where p.role = 'admin'::public.role_type
        and p.is_active = true;

      if v_active_admin_count <= 1 then
        raise exception 'Cannot delete the last active admin account.';
      end if;
    end if;
    return old;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_profiles_prevent_last_active_admin_update on public.profiles;
create trigger trg_profiles_prevent_last_active_admin_update
before update of role, is_active
on public.profiles
for each row
execute function public.prevent_last_active_admin_mutation();

drop trigger if exists trg_profiles_prevent_last_active_admin_delete on public.profiles;
create trigger trg_profiles_prevent_last_active_admin_delete
before delete
on public.profiles
for each row
execute function public.prevent_last_active_admin_mutation();

-- -----------------------------------------------------------------------------
-- 2.5) Profiles RLS (Pattern A)
-- - SELECT: self or admin
-- - INSERT: admin inserts officials; citizens may self-insert as citizen only
-- - UPDATE: self or admin (trigger restricts non-admin changes)
-- - DELETE: admin only
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin
on public.profiles
for select
to authenticated
using (
  public.is_active_auth()
  and (
    id = public.current_user_id()
    or public.is_admin()
  )
);

drop policy if exists profiles_insert_admin_or_citizen_self on public.profiles;
create policy profiles_insert_admin_or_citizen_self
on public.profiles
for insert
to authenticated
with check (
  public.is_active_auth()
  and (
    -- Admin can register any role/scope (official registration)
    public.is_admin()
    or
    -- Citizen self-registration only (role must be citizen and scope barangay-only)
    (
      id = public.current_user_id()
      and role = 'citizen'::public.role_type
      and barangay_id is not null
      and city_id is null
      and municipality_id is null
    )
  )
);

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin
on public.profiles
for update
to authenticated
using (
  public.is_active_auth()
  and (
    id = public.current_user_id()
    or public.is_admin()
  )
)
with check (
  public.is_active_auth()
  and (
    id = public.current_user_id()
    or public.is_admin()
  )
);

drop policy if exists profiles_delete_admin_only on public.profiles;
create policy profiles_delete_admin_only
on public.profiles
for delete
to authenticated
using (public.is_active_auth() and public.is_admin());

-- -----------------------------------------------------------------------------
-- 2.6) Admin ALL policies for geo tables (moved from Phase 1)
-- -----------------------------------------------------------------------------
drop policy if exists regions_admin_all on public.regions;
create policy regions_admin_all
on public.regions
for all
to authenticated
using (public.is_active_auth() and public.is_admin())
with check (public.is_active_auth() and public.is_admin());

drop policy if exists provinces_admin_all on public.provinces;
create policy provinces_admin_all
on public.provinces
for all
to authenticated
using (public.is_active_auth() and public.is_admin())
with check (public.is_active_auth() and public.is_admin());

drop policy if exists cities_admin_all on public.cities;
create policy cities_admin_all
on public.cities
for all
to authenticated
using (public.is_active_auth() and public.is_admin())
with check (public.is_active_auth() and public.is_admin());

drop policy if exists municipalities_admin_all on public.municipalities;
create policy municipalities_admin_all
on public.municipalities
for all
to authenticated
using (public.is_active_auth() and public.is_admin())
with check (public.is_active_auth() and public.is_admin());

drop policy if exists barangays_admin_all on public.barangays;
create policy barangays_admin_all
on public.barangays
for all
to authenticated
using (public.is_active_auth() and public.is_admin())
with check (public.is_active_auth() and public.is_admin());

commit;

begin;

-- =============================================================================
-- Phase 3 (REVISED) — AIPs (multi-scope) + indexes + lifecycle timestamps + public status view
-- Revisions per request:
-- 1) City/municipal officials can ONLY see their OWN drafts (no cross-draft visibility)
-- 2) Do NOT revoke anon access to base table public.aips
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3.1) AIP status enum
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'aip_status') then
    create type public.aip_status as enum (
      'draft',
      'pending_review',
      'under_review',
      'for_revision',
      'published'
    );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3.2) AIPs table (exactly one scope: barangay OR city OR municipality)
-- -----------------------------------------------------------------------------
create table if not exists public.aips (
  id uuid primary key default extensions.gen_random_uuid(),

  fiscal_year int not null
    check (fiscal_year >= 2000 and fiscal_year <= 2100),

  -- Exactly one scope column must be non-null
  barangay_id uuid null references public.barangays(id) on delete restrict,
  city_id uuid null references public.cities(id) on delete restrict,
  municipality_id uuid null references public.municipalities(id) on delete restrict,

  status public.aip_status not null default 'draft',
  status_updated_at timestamptz not null default now(),
  submitted_at timestamptz null,
  published_at timestamptz null,

  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_aips_exactly_one_scope check (
    (barangay_id is not null and city_id is null and municipality_id is null)
    or
    (barangay_id is null and city_id is not null and municipality_id is null)
    or
    (barangay_id is null and city_id is null and municipality_id is not null)
  ),

  constraint chk_aips_published_at check (
    status <> 'published' or published_at is not null
  )
);

-- Uniqueness per scope + fiscal_year (partial uniques)
create unique index if not exists uq_aips_barangay_year
  on public.aips (barangay_id, fiscal_year)
  where barangay_id is not null;

create unique index if not exists uq_aips_city_year
  on public.aips (city_id, fiscal_year)
  where city_id is not null;

create unique index if not exists uq_aips_municipality_year
  on public.aips (municipality_id, fiscal_year)
  where municipality_id is not null;

-- Query indexes
create index if not exists idx_aips_status
  on public.aips(status);

create index if not exists idx_aips_fiscal_year
  on public.aips(fiscal_year);

create index if not exists idx_aips_barangay_id
  on public.aips(barangay_id);

create index if not exists idx_aips_city_id
  on public.aips(city_id);

create index if not exists idx_aips_municipality_id
  on public.aips(municipality_id);

create index if not exists idx_aips_status_updated_at
  on public.aips(status_updated_at);

create index if not exists idx_aips_created_at
  on public.aips(created_at);

-- -----------------------------------------------------------------------------
-- 3.3) Timestamp trigger for updated_at/status_updated_at/submitted_at/published_at
-- -----------------------------------------------------------------------------
create or replace function public.aips_set_timestamps()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();

  if tg_op = 'INSERT' then
    if new.status_updated_at is null then
      new.status_updated_at = now();
    end if;

    if new.created_by is null then
      new.created_by = (select auth.uid());
    end if;

    if new.submitted_at is null and new.status in ('pending_review','under_review','for_revision','published') then
      new.submitted_at = now();
    end if;

    if new.status = 'published' and new.published_at is null then
      new.published_at = now();
    end if;

    return new;
  end if;

  -- UPDATE
  if new.status is distinct from old.status then
    new.status_updated_at = now();

    if new.status = 'pending_review' then
      new.submitted_at = now();
    elsif new.submitted_at is null and new.status in ('under_review','for_revision','published') then
      new.submitted_at = now();
    end if;

    if new.status = 'published' and new.published_at is null then
      new.published_at = now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_aips_set_timestamps on public.aips;
create trigger trg_aips_set_timestamps
before insert or update on public.aips
for each row
execute function public.aips_set_timestamps();

-- -----------------------------------------------------------------------------
-- 3.4) RLS policies (single policy per action; explicit TO)
-- - anon can read AIP status (public transparency): allow non-draft rows
-- - drafts: only owner (barangay/city/municipality) or admin
-- -----------------------------------------------------------------------------
alter table public.aips enable row level security;

drop policy if exists aips_select_policy on public.aips;
create policy aips_select_policy
on public.aips
for select
to anon, authenticated
using (
  -- Public transparency: all non-draft rows visible to anon/authenticated
  status <> 'draft'

  -- Drafts: only admin or the owning official (scope-bound)
  or (
    public.is_active_auth()
    and status = 'draft'
    and (
      public.is_admin()

      or (
        public.is_barangay_official()
        and barangay_id is not null
        and barangay_id = public.current_barangay_id()
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
);

-- INSERT:
-- - admin can insert any
-- - officials can insert within their own scope
-- - citizens cannot insert
drop policy if exists aips_insert_policy on public.aips;
create policy aips_insert_policy
on public.aips
for insert
to authenticated
with check (
  public.is_active_auth()
  and (
    public.is_admin()

    or (
      public.is_barangay_official()
      and barangay_id is not null
      and barangay_id = public.current_barangay_id()
      and city_id is null and municipality_id is null
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

-- UPDATE:
-- Baseline write rules (state-machine tightening can be added later if desired):
-- - admin: any
-- - owners: update own AIP
-- - reviewers: update barangay AIPs under their jurisdiction (city/municipal review rules)
drop policy if exists aips_update_policy on public.aips;
create policy aips_update_policy
on public.aips
for update
to authenticated
using (
  public.is_active_auth()
  and (
    public.is_admin()

    -- Owners
    or (
      public.is_barangay_official()
      and barangay_id is not null
      and barangay_id = public.current_barangay_id()
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

    -- Reviewers (barangay AIPs only, strict jurisdiction)
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

    -- Owners (scope must remain consistent)
    or (
      public.is_barangay_official()
      and barangay_id is not null
      and barangay_id = public.current_barangay_id()
      and city_id is null and municipality_id is null
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

    -- Reviewers (barangay AIPs only, strict jurisdiction)
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

-- DELETE: admin only (hardening)
drop policy if exists aips_delete_policy on public.aips;
create policy aips_delete_policy
on public.aips
for delete
to authenticated
using (public.is_active_auth() and public.is_admin());

-- -----------------------------------------------------------------------------
-- 3.5) Public status view (SECURITY INVOKER)
-- - No revokes on base table (per request)
-- - View is still useful as a stable public projection
-- -----------------------------------------------------------------------------
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
where a.status <> 'draft';

grant select on public.v_aip_public_status to anon, authenticated;

commit;

begin;

-- =============================================================================
-- Phase 4 (REVISED) — Uploaded files metadata + helpers + RLS (NO storage.objects policies)
-- Rationale: avoid "must be owner of table objects" on hosted Supabase Storage tables.
-- Storage access will be enforced via Next.js Route Handlers (service role) using:
-- - uploads: server route
-- - downloads: signed URLs gated by AIP status
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 4.1) uploaded_files table (application-level metadata + linkage to AIP)
-- -----------------------------------------------------------------------------
create table if not exists public.uploaded_files (
  id uuid primary key default extensions.gen_random_uuid(),

  aip_id uuid not null references public.aips(id) on delete cascade,

  -- Storage pointer (maps to storage.objects, but we won't manage storage.objects via SQL here)
  bucket_id text not null default 'aip-pdfs',
  object_name text not null, -- e.g. "<aip_id>/<uuid>.pdf"

  original_file_name text null,
  mime_type text not null default 'application/pdf',
  size_bytes bigint null check (size_bytes is null or size_bytes >= 0),
  sha256_hex text null check (sha256_hex is null or sha256_hex ~ '^[0-9a-f]{64}$'),

  -- Versioning / current pointer
  is_current boolean not null default true,

  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint chk_uploaded_files_bucket check (bucket_id = 'aip-pdfs'),
  constraint chk_uploaded_files_pdf check (
    mime_type = 'application/pdf'
    and lower(right(object_name, 4)) = '.pdf'
  )
);

-- Only one "current" file per AIP
create unique index if not exists uq_uploaded_files_current_per_aip
  on public.uploaded_files(aip_id)
  where is_current = true;

create unique index if not exists uq_uploaded_files_bucket_object
  on public.uploaded_files(bucket_id, object_name);

create index if not exists idx_uploaded_files_aip_id
  on public.uploaded_files(aip_id);

create index if not exists idx_uploaded_files_uploaded_by
  on public.uploaded_files(uploaded_by);

create index if not exists idx_uploaded_files_created_at
  on public.uploaded_files(created_at);

-- -----------------------------------------------------------------------------
-- 4.2) Trigger: when inserting a new current file, demote prior currents
-- -----------------------------------------------------------------------------
create or replace function public.uploaded_files_set_single_current()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.is_current then
    update public.uploaded_files uf
      set is_current = false
    where uf.aip_id = new.aip_id
      and uf.id <> new.id
      and uf.is_current = true;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_uploaded_files_single_current on public.uploaded_files;
create trigger trg_uploaded_files_single_current
after insert or update of is_current
on public.uploaded_files
for each row
execute function public.uploaded_files_set_single_current();

-- -----------------------------------------------------------------------------
-- 4.3) Storage cleanup: best-effort delete of underlying object
-- Note: hosted Supabase may block direct writes to storage.objects.
--       This hook must never fail parent deletes for that platform guard.
-- -----------------------------------------------------------------------------
create or replace function public.uploaded_files_delete_storage_object()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  v_bucket_id text;
  v_object_name text;
begin
  v_bucket_id := nullif(btrim(old.bucket_id), '');
  v_object_name := nullif(btrim(old.object_name), '');

  if v_bucket_id is not null and v_object_name is not null then
    begin
      delete from storage.objects
      where bucket_id = v_bucket_id
        and name = v_object_name;
    exception
      when others then
        if position('Direct deletion from storage tables is not allowed' in sqlerrm) > 0 then
          null;
        else
          raise;
        end if;
    end;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_uploaded_files_delete_storage_object on public.uploaded_files;
create trigger trg_uploaded_files_delete_storage_object
after delete on public.uploaded_files
for each row
execute function public.uploaded_files_delete_storage_object();

-- -----------------------------------------------------------------------------
-- 4.4) Helper: can current user upload/replace PDF for an AIP?
-- - Officials upload only while AIP is draft/for_revision
-- - Admin always allowed
-- -----------------------------------------------------------------------------
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
            (public.is_barangay_official() and a.barangay_id is not null and a.barangay_id = public.current_barangay_id())
            or
            (public.is_city_official() and a.city_id is not null and a.city_id = public.current_city_id())
            or
            (public.is_municipal_official() and a.municipality_id is not null and a.municipality_id = public.current_municipality_id())
          )
        )
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- 4.5) RLS: uploaded_files
-- - Public can see metadata for non-draft AIPs (transparency)
-- - Authenticated owners/admin can see draft uploads
-- - Insert allowed only if user can upload for that AIP
-- -----------------------------------------------------------------------------
alter table public.uploaded_files enable row level security;

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
          and (
            public.is_admin()
            or public.can_upload_aip_pdf(a.id)
          )
        )
      )
  )
);

drop policy if exists uploaded_files_insert_policy on public.uploaded_files;
create policy uploaded_files_insert_policy
on public.uploaded_files
for insert
to authenticated
with check (
  public.is_active_auth()
  and uploaded_by = public.current_user_id()
  and bucket_id = 'aip-pdfs'
  and public.can_upload_aip_pdf(aip_id)
);

-- Keep metadata immutable; admin only updates/deletes
drop policy if exists uploaded_files_update_policy on public.uploaded_files;
create policy uploaded_files_update_policy
on public.uploaded_files
for update
to authenticated
using (public.is_active_auth() and public.is_admin())
with check (public.is_active_auth() and public.is_admin());

drop policy if exists uploaded_files_delete_policy on public.uploaded_files;
create policy uploaded_files_delete_policy
on public.uploaded_files
for delete
to authenticated
using (public.is_active_auth() and public.is_admin());

grant select on public.uploaded_files to anon, authenticated;
grant insert on public.uploaded_files to authenticated;

commit;

begin;

-- =============================================================================
-- Phase 5 (COMPLETE + REVISED) — Extraction pipeline + embeddings (3072)
-- - pipeline_stage includes: extract -> validate -> summarize -> categorize -> embed
-- - Public transparency:
--     * anon/authenticated can read extraction_runs for non-draft AIPs
--     * anon/authenticated can read ONLY summarize/categorize artifacts for non-draft AIPs
-- - Private/server-only:
--     * aip_chunks and aip_chunk_embeddings have NO SELECT policies (RLS private)
-- - Writes are server-only by default (no INSERT/UPDATE/DELETE policies)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 5.1) Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'pipeline_stage') then
    create type public.pipeline_stage as enum (
      'extract',
      'validate',
      'summarize',
      'categorize',
      'embed'
    );
  else
    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'pipeline_stage'
        and e.enumlabel = 'categorize'
    ) then
      alter type public.pipeline_stage add value 'categorize';
    end if;
  end if;

  if not exists (select 1 from pg_type where typname = 'pipeline_status') then
    create type public.pipeline_status as enum (
      'queued',
      'running',
      'succeeded',
      'failed'
    );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5.2) Helper: can a session read an AIP (mirrors public.aips select intent)
-- - Public: non-draft
-- - Authenticated: admin or owning official can read drafts
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
        a.status <> 'draft'
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
              and a.city_id is not null
              and a.city_id = public.current_city_id()
            )
            or (
              public.is_municipal_official()
              and a.municipality_id is not null
              and a.municipality_id = public.current_municipality_id()
            )
          )
        )
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- 5.3) Extraction runs (one row per pipeline execution)
-- -----------------------------------------------------------------------------
create table if not exists public.extraction_runs (
  id uuid primary key default extensions.gen_random_uuid(),

  aip_id uuid not null references public.aips(id) on delete cascade,
  uploaded_file_id uuid null references public.uploaded_files(id) on delete set null,

  stage public.pipeline_stage not null default 'extract',
  status public.pipeline_status not null default 'queued',

  model_name text null,
  model_version text null,
  temperature numeric null check (temperature is null or (temperature >= 0 and temperature <= 2)),
  prompt_version text null,

  started_at timestamptz null,
  finished_at timestamptz null,

  error_code text null,
  error_message text null,

  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint chk_extraction_runs_time_order check (
    started_at is null
    or finished_at is null
    or finished_at >= started_at
  )
);

-- Backfill fields added after initial extraction_runs rollout.
alter table public.extraction_runs
  add column if not exists overall_progress_pct smallint null,
  add column if not exists stage_progress_pct smallint null,
  add column if not exists progress_message text null,
  add column if not exists progress_updated_at timestamptz null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'extraction_runs_overall_progress_pct_range_chk'
  ) then
    alter table public.extraction_runs
      add constraint extraction_runs_overall_progress_pct_range_chk
      check (
        overall_progress_pct is null
        or (overall_progress_pct >= 0 and overall_progress_pct <= 100)
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'extraction_runs_stage_progress_pct_range_chk'
  ) then
    alter table public.extraction_runs
      add constraint extraction_runs_stage_progress_pct_range_chk
      check (
        stage_progress_pct is null
        or (stage_progress_pct >= 0 and stage_progress_pct <= 100)
      );
  end if;
end
$$;

create index if not exists idx_extraction_runs_aip_id
  on public.extraction_runs(aip_id);

create index if not exists idx_extraction_runs_uploaded_file_id
  on public.extraction_runs(uploaded_file_id);

create index if not exists idx_extraction_runs_status
  on public.extraction_runs(status);

create index if not exists idx_extraction_runs_stage
  on public.extraction_runs(stage);

create index if not exists idx_extraction_runs_created_at
  on public.extraction_runs(created_at);

-- Ensure extraction_runs updates are available in Supabase Realtime.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'extraction_runs'
  ) then
    alter publication supabase_realtime add table public.extraction_runs;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 5.4) Extraction artifacts (JSON + optional text) per stage
-- - Public sees only summarize/categorize for non-draft AIPs
-- -----------------------------------------------------------------------------
create table if not exists public.extraction_artifacts (
  id uuid primary key default extensions.gen_random_uuid(),

  run_id uuid not null references public.extraction_runs(id) on delete cascade,
  aip_id uuid not null references public.aips(id) on delete cascade,

  artifact_type public.pipeline_stage not null, -- extract/validate/summarize/categorize/embed
  artifact_json jsonb null,
  artifact_text text null,

  created_at timestamptz not null default now()
);

create index if not exists idx_extraction_artifacts_run_id
  on public.extraction_artifacts(run_id);

create index if not exists idx_extraction_artifacts_aip_id
  on public.extraction_artifacts(aip_id);

create index if not exists idx_extraction_artifacts_type
  on public.extraction_artifacts(artifact_type);

-- -----------------------------------------------------------------------------
-- 5.5) Storage cleanup: delete staged artifact payload when row is removed
-- -----------------------------------------------------------------------------
create or replace function public.extraction_artifacts_delete_storage_object()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  v_storage_path text;
  v_bucket_id text;
begin
  if old.artifact_json is null or jsonb_typeof(old.artifact_json) <> 'object' then
    return old;
  end if;

  v_storage_path := nullif(btrim(old.artifact_json ->> 'storage_path'), '');
  if v_storage_path is null then
    return old;
  end if;

  v_bucket_id := coalesce(
    nullif(btrim(old.artifact_json ->> 'storage_bucket'), ''),
    nullif(btrim(old.artifact_json ->> 'storage_bucket_id'), ''),
    nullif(btrim(old.artifact_json ->> 'bucket_id'), ''),
    nullif(btrim(old.artifact_json ->> 'bucket'), ''),
    'aip-artifacts'
  );

  begin
    delete from storage.objects
    where bucket_id = v_bucket_id
      and name = v_storage_path;
  exception
    when others then
      if position('Direct deletion from storage tables is not allowed' in sqlerrm) > 0 then
        null;
      else
        raise;
      end if;
  end;

  return old;
end;
$$;

drop trigger if exists trg_extraction_artifacts_delete_storage_object on public.extraction_artifacts;
create trigger trg_extraction_artifacts_delete_storage_object
after delete on public.extraction_artifacts
for each row
execute function public.extraction_artifacts_delete_storage_object();

-- -----------------------------------------------------------------------------
-- 5.6) Document chunks (PRIVATE) — server-only
-- -----------------------------------------------------------------------------
create table if not exists public.aip_chunks (
  id uuid primary key default extensions.gen_random_uuid(),

  aip_id uuid not null references public.aips(id) on delete cascade,
  uploaded_file_id uuid null references public.uploaded_files(id) on delete set null,
  run_id uuid null references public.extraction_runs(id) on delete set null,

  chunk_index int not null check (chunk_index >= 0),
  chunk_text text not null,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint uq_aip_chunks_unique_per_run unique (aip_id, run_id, chunk_index)
);

create index if not exists idx_aip_chunks_aip_id
  on public.aip_chunks(aip_id);

create index if not exists idx_aip_chunks_run_id
  on public.aip_chunks(run_id);

-- -----------------------------------------------------------------------------
-- 5.7) Chunk embeddings (PRIVATE) — pgvector 3072 dims
-- -----------------------------------------------------------------------------
create table if not exists public.aip_chunk_embeddings (
  id uuid primary key default extensions.gen_random_uuid(),

  chunk_id uuid not null references public.aip_chunks(id) on delete cascade,
  aip_id uuid not null references public.aips(id) on delete cascade,

  embedding extensions.vector(3072) not null,
  embedding_model text not null default 'text-embedding-3-large',

  created_at timestamptz not null default now(),

  constraint uq_chunk_embeddings_chunk unique (chunk_id)
);

create index if not exists idx_aip_chunk_embeddings_aip_id
  on public.aip_chunk_embeddings(aip_id);

-- OPTIONAL vector index (tune lists for your dataset; requires ANALYZE)
-- create index if not exists idx_aip_chunk_embeddings_vec_ivfflat
--   on public.aip_chunk_embeddings
--   using ivfflat (embedding extensions.vector_cosine_ops)
--   with (lists = 100);

-- -----------------------------------------------------------------------------
-- 5.8) RLS
-- -----------------------------------------------------------------------------
alter table public.extraction_runs enable row level security;
alter table public.extraction_artifacts enable row level security;
alter table public.aip_chunks enable row level security;
alter table public.aip_chunk_embeddings enable row level security;

-- extraction_runs: public can see runs only if AIP is readable (non-draft public; drafts owner/admin)
drop policy if exists extraction_runs_select_policy on public.extraction_runs;
create policy extraction_runs_select_policy
on public.extraction_runs
for select
to anon, authenticated
using (public.can_read_aip(aip_id));

-- extraction_artifacts: public can see ONLY summarize/categorize for non-draft
-- authenticated owners/admin can see ALL artifact types (including draft)
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
          a.status <> 'draft'
          and extraction_artifacts.artifact_type in ('summarize','categorize')
        )
        or
        (
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
              and a.city_id is not null
              and a.city_id = public.current_city_id()
            )
            or (
              public.is_municipal_official()
              and a.municipality_id is not null
              and a.municipality_id = public.current_municipality_id()
            )
          )
        )
      )
  )
);

-- PRIVATE tables: NO SELECT policies (server-only via service role)
drop policy if exists aip_chunks_select_policy on public.aip_chunks;
drop policy if exists aip_chunk_embeddings_select_policy on public.aip_chunk_embeddings;

-- NOTE: No INSERT/UPDATE/DELETE policies are created in Phase 5.
-- Writes should be performed by server/service role pipelines.

commit;

begin;

-- =============================================================================
-- PATCH: Fix "Multiple Permissive Policies" on geo master tables
-- Reason: *_admin_all uses FOR ALL (includes SELECT), causing 2 permissive SELECT
-- policies per table together with *_select_active.
--
-- Strategy:
-- 1) Replace SELECT policies with ONE consolidated policy:
--    - anon/authenticated: is_active = true
--    - admin: can see all rows (active or inactive)
-- 2) Replace admin FOR ALL with admin INSERT/UPDATE/DELETE only (no SELECT)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- REGIONS
-- -----------------------------------------------------------------------------
drop policy if exists regions_select_active on public.regions;
drop policy if exists regions_admin_all on public.regions;

create policy regions_select_policy
on public.regions
for select
to anon, authenticated
using (
  is_active = true
  or (public.is_active_auth() and public.is_admin())
);

create policy regions_admin_insert
on public.regions
for insert
to authenticated
with check (public.is_active_auth() and public.is_admin());

create policy regions_admin_update
on public.regions
for update
to authenticated
using (public.is_active_auth() and public.is_admin())
with check (public.is_active_auth() and public.is_admin());

create policy regions_admin_delete
on public.regions
for delete
to authenticated
using (public.is_active_auth() and public.is_admin());

-- -----------------------------------------------------------------------------
-- PROVINCES
-- -----------------------------------------------------------------------------
drop policy if exists provinces_select_active on public.provinces;
drop policy if exists provinces_admin_all on public.provinces;

create policy provinces_select_policy
on public.provinces
for select
to anon, authenticated
using (
  is_active = true
  or (public.is_active_auth() and public.is_admin())
);

create policy provinces_admin_insert
on public.provinces
for insert
to authenticated
with check (public.is_active_auth() and public.is_admin());

create policy provinces_admin_update
on public.provinces
for update
to authenticated
using (public.is_active_auth() and public.is_admin())
with check (public.is_active_auth() and public.is_admin());

create policy provinces_admin_delete
on public.provinces
for delete
to authenticated
using (public.is_active_auth() and public.is_admin());

-- -----------------------------------------------------------------------------
-- CITIES
-- -----------------------------------------------------------------------------
drop policy if exists cities_select_active on public.cities;
drop policy if exists cities_admin_all on public.cities;

create policy cities_select_policy
on public.cities
for select
to anon, authenticated
using (
  is_active = true
  or (public.is_active_auth() and public.is_admin())
);

create policy cities_admin_insert
on public.cities
for insert
to authenticated
with check (public.is_active_auth() and public.is_admin());

create policy cities_admin_update
on public.cities
for update
to authenticated
using (public.is_active_auth() and public.is_admin())
with check (public.is_active_auth() and public.is_admin());

create policy cities_admin_delete
on public.cities
for delete
to authenticated
using (public.is_active_auth() and public.is_admin());

-- -----------------------------------------------------------------------------
-- MUNICIPALITIES
-- -----------------------------------------------------------------------------
drop policy if exists municipalities_select_active on public.municipalities;
drop policy if exists municipalities_admin_all on public.municipalities;

create policy municipalities_select_policy
on public.municipalities
for select
to anon, authenticated
using (
  is_active = true
  or (public.is_active_auth() and public.is_admin())
);

create policy municipalities_admin_insert
on public.municipalities
for insert
to authenticated
with check (public.is_active_auth() and public.is_admin());

create policy municipalities_admin_update
on public.municipalities
for update
to authenticated
using (public.is_active_auth() and public.is_admin())
with check (public.is_active_auth() and public.is_admin());

create policy municipalities_admin_delete
on public.municipalities
for delete
to authenticated
using (public.is_active_auth() and public.is_admin());

-- -----------------------------------------------------------------------------
-- BARANGAYS
-- -----------------------------------------------------------------------------
drop policy if exists barangays_select_active on public.barangays;
drop policy if exists barangays_admin_all on public.barangays;

create policy barangays_select_policy
on public.barangays
for select
to anon, authenticated
using (
  is_active = true
  or (public.is_active_auth() and public.is_admin())
);

create policy barangays_admin_insert
on public.barangays
for insert
to authenticated
with check (public.is_active_auth() and public.is_admin());

create policy barangays_admin_update
on public.barangays
for update
to authenticated
using (public.is_active_auth() and public.is_admin())
with check (public.is_active_auth() and public.is_admin());

create policy barangays_admin_delete
on public.barangays
for delete
to authenticated
using (public.is_active_auth() and public.is_admin());

commit;

begin;

-- =============================================================================
-- Phase 6A (REVISED) — Sectors table (v1 reference) + seed data
-- =============================================================================

create table if not exists public.sectors (
  code text primary key, -- 1000 / 3000 / 8000 / 9000
  label text not null
);

insert into public.sectors (code, label) values
  ('1000', 'General Services'),
  ('3000', 'Social Services'),
  ('8000', 'Economic Services'),
  ('9000', 'Other Services')
on conflict do nothing;

-- RLS + policies
alter table public.sectors enable row level security;

drop policy if exists sectors_select_policy on public.sectors;
create policy sectors_select_policy
on public.sectors
for select
to anon, authenticated
using (true);

drop policy if exists sectors_admin_all on public.sectors;
create policy sectors_admin_all
on public.sectors
for all
to authenticated
using (public.is_active_auth() and public.is_admin())
with check (public.is_active_auth() and public.is_admin());

grant select on public.sectors to anon, authenticated;

commit;

begin;

-- =============================================================================
-- Phase 6B (REVISED) — Projects + manual detail tables (health/infrastructure) + RLS
-- - Uses sectors.code ('1000','3000','8000','9000') as FK via generated sector_code
-- - Projects contain the 14 extracted AIP columns (per your v1 reference)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 6B.1) Enum: project_category (health/infrastructure/other only)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_category') then
    create type public.project_category as enum ('health','infrastructure','other');
  else
    if not exists (
      select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'project_category' and e.enumlabel = 'health'
    ) then
      alter type public.project_category add value 'health';
    end if;

    if not exists (
      select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'project_category' and e.enumlabel = 'infrastructure'
    ) then
      alter type public.project_category add value 'infrastructure';
    end if;

    if not exists (
      select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'project_category' and e.enumlabel = 'other'
    ) then
      alter type public.project_category add value 'other';
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 6B.2) Helper: can current user edit under this AIP?
-- -----------------------------------------------------------------------------
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
            (public.is_barangay_official() and a.barangay_id is not null and a.barangay_id = public.current_barangay_id())
            or
            (public.is_city_official() and a.city_id is not null and a.city_id = public.current_city_id())
            or
            (public.is_municipal_official() and a.municipality_id is not null and a.municipality_id = public.current_municipality_id())
          )
        )
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- 6B.3) Projects table (14 extracted cols) + audit + sector FK
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default extensions.gen_random_uuid(),
  aip_id uuid not null references public.aips(id) on delete cascade,

  -- v2 reference: artifact that produced this data (usually artifact_type='extract' or 'validate')
  extraction_artifact_id uuid null references public.extraction_artifacts(id) on delete set null,

  -- 14 AIP-extracted columns
  aip_ref_code text not null,
  program_project_description text not null,
  implementing_agency text null,
  start_date text null,
  completion_date text null,
  expected_output text null,
  source_of_funds text null,

  personal_services numeric(18,2) null check (personal_services is null or personal_services >= 0),
  maintenance_and_other_operating_expenses numeric(18,2) null
    check (maintenance_and_other_operating_expenses is null or maintenance_and_other_operating_expenses >= 0),
  capital_outlay numeric(18,2) null check (capital_outlay is null or capital_outlay >= 0),
  total numeric(18,2) null check (total is null or total >= 0),

  climate_change_adaptation text null,
  climate_change_mitigation text null,
  cc_topology_code text null,
  prm_ncr_lgu_rm_objective_results_indicator text null,

  errors jsonb null,

  category public.project_category not null default 'other',

  -- Sector derived from ref code:
  -- v1: code is 1000/3000/8000/9000 => use first 4 chars of aip_ref_code
  sector_code text generated always as (substring(aip_ref_code from 1 for 4)) stored,
  constraint fk_projects_sector foreign key (sector_code) references public.sectors(code),

  is_human_edited boolean not null default false,
  edited_by uuid null references public.profiles(id) on delete set null,
  edited_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_projects_ref unique (aip_id, aip_ref_code),

  constraint chk_projects_edit_consistency check (
    (is_human_edited = false and edited_by is null and edited_at is null)
    or
    (is_human_edited = true and edited_by is not null and edited_at is not null)
  )
);

-- Backfill fields added after initial projects rollout.
alter table public.projects
  add column if not exists financial_expenses numeric(18,2) null;

alter table public.projects
  drop constraint if exists chk_projects_financial_expenses_non_negative;

alter table public.projects
  add constraint chk_projects_financial_expenses_non_negative
  check (financial_expenses is null or financial_expenses >= 0);

create index if not exists idx_projects_aip_id
  on public.projects(aip_id);

create index if not exists idx_projects_sector
  on public.projects(sector_code);

create index if not exists idx_projects_category
  on public.projects(category);

create index if not exists idx_projects_total
  on public.projects(total);

create index if not exists idx_projects_extraction_artifact
  on public.projects(extraction_artifact_id);

create index if not exists idx_projects_human_edited
  on public.projects(is_human_edited);

create index if not exists idx_projects_created_at
  on public.projects(created_at);

drop trigger if exists trg_projects_set_updated_at on public.projects;
create trigger trg_projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6B.4) Manual details (LGU-entered, not from AIP) — v1-aligned
-- -----------------------------------------------------------------------------
create table if not exists public.health_project_details (
  project_id uuid primary key references public.projects(id) on delete cascade,

  -- Manual fields entered by LGU (not from AIP)
  program_name text not null,
  description text null,
  target_participants text null,
  total_target_participants int null
    check (total_target_participants is null or total_target_participants >= 0),

  -- Audit fields
  updated_by uuid null references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_health_details_updated_at
  on public.health_project_details(updated_at);

drop trigger if exists trg_health_project_details_set_updated_at on public.health_project_details;
create trigger trg_health_project_details_set_updated_at
before update on public.health_project_details
for each row execute function public.set_updated_at();

create table if not exists public.infrastructure_project_details (
  project_id uuid primary key references public.projects(id) on delete cascade,

  -- Manual fields entered by LGU (not from AIP)
  project_name text not null,
  contractor_name text null,
  contract_cost numeric(18,2) null check (contract_cost is null or contract_cost >= 0),
  start_date date null,
  target_completion_date date null,

  constraint chk_infra_dates_valid
    check (
      start_date is null
      or target_completion_date is null
      or target_completion_date >= start_date
    ),

  -- Audit fields
  updated_by uuid null references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_infra_details_updated_at
  on public.infrastructure_project_details(updated_at);

drop trigger if exists trg_infra_project_details_set_updated_at on public.infrastructure_project_details;
create trigger trg_infra_project_details_set_updated_at
before update on public.infrastructure_project_details
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6B.5) Helper functions for project-level read/edit via AIP rules
-- -----------------------------------------------------------------------------
create or replace function public.can_read_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.projects pr
    where pr.id = p_project_id
      and public.can_read_aip(pr.aip_id)
  );
$$;

create or replace function public.can_edit_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.projects pr
    where pr.id = p_project_id
      and public.can_edit_aip(pr.aip_id)
  );
$$;

create or replace function public.can_write_published_aip(p_aip_id uuid)
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
      and a.status = 'published'
      and public.is_active_auth()
      and (
        public.is_admin()
        or (
          public.is_barangay_official()
          and a.barangay_id is not null
          and a.barangay_id = public.current_barangay_id()
        )
        or (
          public.is_city_official()
          and a.city_id is not null
          and a.city_id = public.current_city_id()
        )
      )
  );
$$;

create or replace function public.can_write_published_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.projects pr
    where pr.id = p_project_id
      and public.can_write_published_aip(pr.aip_id)
  );
$$;

create or replace function public.can_write_published_project_update(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.can_write_published_project(p_project_id);
$$;

-- -----------------------------------------------------------------------------
-- 6B.6) RLS
-- - Public can read projects for non-draft AIPs (can_read_aip)
-- - Drafts only readable to owner/admin via can_read_aip (already)
-- - Writes allowed in edit window (can_edit_aip) or published add-info window
--   for in-scope barangay/city officials and admin.
-- -----------------------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.health_project_details enable row level security;
alter table public.infrastructure_project_details enable row level security;

-- Projects SELECT
drop policy if exists projects_select_policy on public.projects;
create policy projects_select_policy
on public.projects
for select
to anon, authenticated
using (public.can_read_aip(aip_id));

-- Projects INSERT
drop policy if exists projects_insert_policy on public.projects;
create policy projects_insert_policy
on public.projects
for insert
to authenticated
with check (
  public.is_active_auth()
  and public.can_edit_aip(aip_id)
);

-- Projects UPDATE
drop policy if exists projects_update_policy on public.projects;
create policy projects_update_policy
on public.projects
for update
to authenticated
using (
  public.is_active_auth()
  and (
    public.can_edit_aip(aip_id)
    or public.can_write_published_aip(aip_id)
  )
)
with check (
  public.is_active_auth()
  and (
    public.can_edit_aip(aip_id)
    or public.can_write_published_aip(aip_id)
  )
);

-- Projects DELETE (allowed only in edit window; tighten to admin-only if preferred)
drop policy if exists projects_delete_policy on public.projects;
create policy projects_delete_policy
on public.projects
for delete
to authenticated
using (
  public.is_active_auth()
  and public.can_edit_aip(aip_id)
);

grant select on public.projects to anon, authenticated;
grant insert, update, delete on public.projects to authenticated;

-- Health details SELECT
drop policy if exists health_details_select_policy on public.health_project_details;
create policy health_details_select_policy
on public.health_project_details
for select
to anon, authenticated
using (public.can_read_project(project_id));

-- Health details INSERT/UPDATE/DELETE
drop policy if exists health_details_insert_policy on public.health_project_details;
create policy health_details_insert_policy
on public.health_project_details
for insert
to authenticated
with check (
  public.is_active_auth()
  and (
    public.can_edit_project(project_id)
    or public.can_write_published_project(project_id)
  )
  and (updated_by is null or updated_by = public.current_user_id())
);

drop policy if exists health_details_update_policy on public.health_project_details;
create policy health_details_update_policy
on public.health_project_details
for update
to authenticated
using (
  public.is_active_auth()
  and (
    public.can_edit_project(project_id)
    or public.can_write_published_project(project_id)
  )
)
with check (
  public.is_active_auth()
  and (
    public.can_edit_project(project_id)
    or public.can_write_published_project(project_id)
  )
);

drop policy if exists health_details_delete_policy on public.health_project_details;
create policy health_details_delete_policy
on public.health_project_details
for delete
to authenticated
using (public.is_active_auth() and public.can_edit_project(project_id));

grant select on public.health_project_details to anon, authenticated;
grant insert, update, delete on public.health_project_details to authenticated;

-- Infrastructure details SELECT
drop policy if exists infra_details_select_policy on public.infrastructure_project_details;
create policy infra_details_select_policy
on public.infrastructure_project_details
for select
to anon, authenticated
using (public.can_read_project(project_id));

-- Infrastructure details INSERT/UPDATE/DELETE
drop policy if exists infra_details_insert_policy on public.infrastructure_project_details;
create policy infra_details_insert_policy
on public.infrastructure_project_details
for insert
to authenticated
with check (
  public.is_active_auth()
  and (
    public.can_edit_project(project_id)
    or public.can_write_published_project(project_id)
  )
  and (updated_by is null or updated_by = public.current_user_id())
);

drop policy if exists infra_details_update_policy on public.infrastructure_project_details;
create policy infra_details_update_policy
on public.infrastructure_project_details
for update
to authenticated
using (
  public.is_active_auth()
  and (
    public.can_edit_project(project_id)
    or public.can_write_published_project(project_id)
  )
)
with check (
  public.is_active_auth()
  and (
    public.can_edit_project(project_id)
    or public.can_write_published_project(project_id)
  )
);

drop policy if exists infra_details_delete_policy on public.infrastructure_project_details;
create policy infra_details_delete_policy
on public.infrastructure_project_details
for delete
to authenticated
using (public.is_active_auth() and public.can_edit_project(project_id));

grant select on public.infrastructure_project_details to anon, authenticated;
grant insert, update, delete on public.infrastructure_project_details to authenticated;

commit;

begin;

-- 1) Drop the overlapping admin "FOR ALL" policy (it includes SELECT, causing overlap)
drop policy if exists sectors_admin_all on public.sectors;

-- 2) Ensure there is exactly ONE permissive SELECT policy (public read)
drop policy if exists sectors_select_policy on public.sectors;
drop policy if exists sectors_select_public on public.sectors;

create policy sectors_select_public
on public.sectors
for select
to anon, authenticated
using (true);

-- 3) Admin-only write policies (no FOR ALL -> avoids SELECT overlap)
drop policy if exists sectors_insert_admin on public.sectors;
create policy sectors_insert_admin
on public.sectors
for insert
to authenticated
with check (public.is_active_auth() and public.is_admin());

drop policy if exists sectors_update_admin on public.sectors;
create policy sectors_update_admin
on public.sectors
for update
to authenticated
using (public.is_active_auth() and public.is_admin())
with check (public.is_active_auth() and public.is_admin());

drop policy if exists sectors_delete_admin on public.sectors;
create policy sectors_delete_admin
on public.sectors
for delete
to authenticated
using (public.is_active_auth() and public.is_admin());

commit;

begin;

-- =============================================================================
-- Phase 7 (COMPLETE, FINAL) — Feedback (AI + Human + Replies) + AIP Reviews + RLS
-- - feedback_kind: question, suggestion, concern, lgu_note, ai_finding, commend
-- - review_action: claim_review, approve, request_revision
-- - No dispute/ack/resolve flow (no status / dispute_note)
-- - LGU owners/admin can write AIP feedback even in draft
-- - City/Municipal reviewers can write feedback ONLY on AIP targets (not project),
--   ONLY when AIP is non-draft, and ONLY within their review jurisdiction
-- - Reviewers ARE allowed to create feedback kind 'lgu_note'
-- - Citizens can write BOTH AIP-level and Project-level feedback ONLY when the parent AIP is published
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 7.1) Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'feedback_target_type') then
    create type public.feedback_target_type as enum ('aip','project');
  end if;

  if not exists (select 1 from pg_type where typname = 'feedback_source') then
    create type public.feedback_source as enum ('human','ai');
  end if;

  if not exists (select 1 from pg_type where typname = 'feedback_kind') then
    create type public.feedback_kind as enum (
      'question',
      'suggestion',
      'concern',
      'lgu_note',
      'ai_finding',
      'commend'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'review_action') then
    create type public.review_action as enum ('approve','request_revision','claim_review');
  elsif not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'review_action'
      and e.enumlabel = 'claim_review'
  ) then
    alter type public.review_action add value 'claim_review';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 7.2) Public-read gates (used for anon/public transparency)
-- - Public can only read feedback once AIP is non-draft
-- -----------------------------------------------------------------------------
create or replace function public.can_public_read_aip_feedback(p_aip_id uuid)
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
      and a.status <> 'draft'
      and public.can_read_aip(a.id)
  );
$$;

create or replace function public.can_public_read_project_feedback(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.projects pr
    join public.aips a on a.id = pr.aip_id
    where pr.id = p_project_id
      and a.status <> 'draft'
      and public.can_read_aip(a.id)
  );
$$;

-- -----------------------------------------------------------------------------
-- 7.3) Write gates
-- -----------------------------------------------------------------------------
-- A) Owner/admin can write AIP feedback even in draft
create or replace function public.can_owner_write_aip_feedback(p_aip_id uuid)
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
      and public.is_active_auth()
      and (
        public.is_admin()

        or (
          public.is_barangay_official()
          and a.barangay_id is not null
          and a.barangay_id = public.current_barangay_id()
        )
        or (
          public.is_city_official()
          and a.city_id is not null
          and a.city_id = public.current_city_id()
        )
        or (
          public.is_municipal_official()
          and a.municipality_id is not null
          and a.municipality_id = public.current_municipality_id()
        )
      )
  );
$$;

-- B) Reviewers (city/municipal) can write AIP feedback only for non-draft and in-scope
create or replace function public.can_reviewer_write_aip_feedback(p_aip_id uuid)
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
      and public.is_active_auth()
      and a.status <> 'draft'
      and (
        (
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
  );
$$;

-- C) Owner/admin can write project feedback (any status)
create or replace function public.can_owner_write_project_feedback(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.projects pr
    join public.aips a on a.id = pr.aip_id
    where pr.id = p_project_id
      and public.is_active_auth()
      and (
        public.is_admin()

        or (
          public.is_barangay_official()
          and a.barangay_id is not null
          and a.barangay_id = public.current_barangay_id()
        )
        or (
          public.is_city_official()
          and a.city_id is not null
          and a.city_id = public.current_city_id()
        )
        or (
          public.is_municipal_official()
          and a.municipality_id is not null
          and a.municipality_id = public.current_municipality_id()
        )
      )
  );
$$;

-- D) Citizens can write AIP feedback only when published
create or replace function public.can_citizen_write_aip_feedback(p_aip_id uuid)
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
      and public.is_active_auth()
      and public.is_citizen()
      and a.status = 'published'
      and public.can_read_aip(a.id)
  );
$$;

-- E) Citizens can write PROJECT feedback only when parent AIP is published
create or replace function public.can_citizen_write_project_feedback(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.projects pr
    join public.aips a on a.id = pr.aip_id
    where pr.id = p_project_id
      and public.is_active_auth()
      and public.is_citizen()
      and a.status = 'published'
      and public.can_read_aip(a.id)
  );
$$;

-- -----------------------------------------------------------------------------
-- 7.4) FEEDBACK table
-- -----------------------------------------------------------------------------
create table if not exists public.feedback (
  id uuid primary key default extensions.gen_random_uuid(),

  target_type public.feedback_target_type not null,
  aip_id uuid null references public.aips(id) on delete cascade,
  project_id uuid null references public.projects(id) on delete cascade,

  parent_feedback_id uuid null references public.feedback(id) on delete cascade,

  source public.feedback_source not null default 'human',
  kind public.feedback_kind not null default 'suggestion',

  extraction_run_id uuid null references public.extraction_runs(id) on delete set null,
  extraction_artifact_id uuid null references public.extraction_artifacts(id) on delete set null,

  field_key text null,
  severity int null check (severity is null or (severity >= 1 and severity <= 5)),

  body text not null check (length(body) <= 4000),
  is_public boolean not null default true,

  author_id uuid null references public.profiles(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_feedback_target_xor check (
    (target_type = 'aip' and aip_id is not null and project_id is null)
    or
    (target_type = 'project' and project_id is not null and aip_id is null)
  ),

  constraint chk_feedback_ai_author check (
    (source = 'ai' and author_id is null)
    or
    (source = 'human' and author_id is not null)
  )
);

create index if not exists idx_feedback_aip_id
  on public.feedback(aip_id)
  where aip_id is not null;

create index if not exists idx_feedback_project_id
  on public.feedback(project_id)
  where project_id is not null;

create index if not exists idx_feedback_parent
  on public.feedback(parent_feedback_id)
  where parent_feedback_id is not null;

create index if not exists idx_feedback_kind
  on public.feedback(kind);

create index if not exists idx_feedback_created_at
  on public.feedback(created_at);

drop trigger if exists trg_feedback_set_updated_at on public.feedback;
create trigger trg_feedback_set_updated_at
before update on public.feedback
for each row execute function public.set_updated_at();

create or replace function public.feedback_enforce_parent_target()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  p record;
begin
  if new.parent_feedback_id is null then
    return new;
  end if;

  select target_type, aip_id, project_id
    into p
  from public.feedback
  where id = new.parent_feedback_id;

  if not found then
    raise exception 'parent_feedback_id does not exist';
  end if;

  if new.target_type is distinct from p.target_type
     or new.aip_id is distinct from p.aip_id
     or new.project_id is distinct from p.project_id then
    raise exception 'reply feedback must match parent target';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_feedback_enforce_parent_target on public.feedback;
create trigger trg_feedback_enforce_parent_target
before insert or update of parent_feedback_id, target_type, aip_id, project_id
on public.feedback
for each row
execute function public.feedback_enforce_parent_target();

-- -----------------------------------------------------------------------------
-- 7.5) AIP reviews (claim_review / approve / request_revision)
-- -----------------------------------------------------------------------------
create table if not exists public.aip_reviews (
  id uuid primary key default extensions.gen_random_uuid(),

  aip_id uuid not null references public.aips(id) on delete cascade,

  action public.review_action not null,
  note text null check (note is null or length(note) <= 4000),

  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_aip_reviews_aip_id
  on public.aip_reviews(aip_id);

create index if not exists idx_aip_reviews_reviewer_id
  on public.aip_reviews(reviewer_id);

create index if not exists idx_aip_reviews_created_at
  on public.aip_reviews(created_at);

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

  if not (public.is_admin() or public.is_city_official()) then
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

  if not public.is_admin() and not public.barangay_in_my_city(v_aip.barangay_id) then
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

-- -----------------------------------------------------------------------------
-- 7.6) RLS
-- -----------------------------------------------------------------------------
alter table public.feedback enable row level security;
alter table public.aip_reviews enable row level security;

drop policy if exists feedback_select_policy on public.feedback;
create policy feedback_select_policy
on public.feedback
for select
to anon, authenticated
using (
  (
    is_public = true
    and (
      (target_type = 'aip' and aip_id is not null and public.can_public_read_aip_feedback(aip_id))
      or
      (target_type = 'project' and project_id is not null and public.can_public_read_project_feedback(project_id))
    )
  )
  or (
    public.is_active_auth()
    and (
      public.is_admin()
      or (target_type = 'aip' and aip_id is not null and public.can_read_aip(aip_id))
      or (target_type = 'project' and project_id is not null and public.can_read_project(project_id))
    )
  )
);

drop policy if exists feedback_insert_policy on public.feedback;
create policy feedback_insert_policy
on public.feedback
for insert
to authenticated
with check (
  public.is_active_auth()
  and source = 'human'
  and author_id = public.current_user_id()
  and (
    (
      target_type = 'aip'
      and aip_id is not null
      and (
        public.can_owner_write_aip_feedback(aip_id)
        or public.can_reviewer_write_aip_feedback(aip_id)
        or public.can_citizen_write_aip_feedback(aip_id)
      )
    )
    or
    (
      target_type = 'project'
      and project_id is not null
      and (
        public.can_owner_write_project_feedback(project_id)
        or public.can_citizen_write_project_feedback(project_id)
      )
    )
  )
);

drop policy if exists feedback_update_policy on public.feedback;
create policy feedback_update_policy
on public.feedback
for update
to authenticated
using (
  public.is_active_auth()
  and (
    public.is_admin()
    or author_id = public.current_user_id()
  )
)
with check (
  public.is_active_auth()
  and (
    public.is_admin()
    or author_id = public.current_user_id()
  )
);

drop policy if exists feedback_delete_policy on public.feedback;
create policy feedback_delete_policy
on public.feedback
for delete
to authenticated
using (
  public.is_active_auth()
  and (
    public.is_admin()
    or (source = 'human' and author_id = public.current_user_id())
  )
);

grant select on public.feedback to anon, authenticated;
grant insert, update, delete on public.feedback to authenticated;

drop policy if exists aip_reviews_select_policy on public.aip_reviews;
create policy aip_reviews_select_policy
on public.aip_reviews
for select
to anon, authenticated
using (public.can_read_aip(aip_id));

drop policy if exists aip_reviews_insert_policy on public.aip_reviews;
create policy aip_reviews_insert_policy
on public.aip_reviews
for insert
to authenticated
with check (
  public.is_active_auth()
  and reviewer_id = public.current_user_id()
  and exists (
    select 1
    from public.aips a
    where a.id = aip_reviews.aip_id
      and a.status <> 'draft'
      and (
        public.is_admin()
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
);

drop policy if exists aip_reviews_update_policy on public.aip_reviews;
create policy aip_reviews_update_policy
on public.aip_reviews
for update
to authenticated
using (public.is_active_auth() and public.is_admin())
with check (public.is_active_auth() and public.is_admin());

drop policy if exists aip_reviews_delete_policy on public.aip_reviews;
create policy aip_reviews_delete_policy
on public.aip_reviews
for delete
to authenticated
using (public.is_active_auth() and public.is_admin());

grant select on public.aip_reviews to anon, authenticated;
grant insert on public.aip_reviews to authenticated;
grant execute on function public.claim_aip_review(uuid) to authenticated;

commit;

begin;

-- -----------------------------------------------------------------------------
-- 1) Public-read gates: anon can read feedback ONLY when AIP is published
-- -----------------------------------------------------------------------------
create or replace function public.can_public_read_aip_feedback(p_aip_id uuid)
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
      and a.status = 'published'
      and public.can_read_aip(a.id)
  );
$$;

create or replace function public.can_public_read_project_feedback(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.projects pr
    join public.aips a on a.id = pr.aip_id
    where pr.id = p_project_id
      and a.status = 'published'
      and public.can_read_aip(a.id)
  );
$$;

-- -----------------------------------------------------------------------------
-- 2) Replace feedback_insert_policy to enforce kind restrictions:
--    - admin: any kind
--    - citizens: question/suggestion/concern/commend (published-only gates already enforced)
--    - officials/reviewers: lgu_note only
-- -----------------------------------------------------------------------------
drop policy if exists feedback_insert_policy on public.feedback;

create policy feedback_insert_policy
on public.feedback
for insert
to authenticated
with check (
  public.is_active_auth()
  and source = 'human'
  and author_id = public.current_user_id()
  and (
    -- AIP target
    (
      target_type = 'aip'
      and aip_id is not null
      and (
        -- Admin can do anything
        (
          public.is_admin()
        )
        -- Citizens: published-only + limited kinds
        or (
          public.is_citizen()
          and public.can_citizen_write_aip_feedback(aip_id)
          and kind in ('question','suggestion','concern','commend')
        )
        -- Officials/reviewers: jurisdiction gates + lgu_note only
        or (
          (public.can_owner_write_aip_feedback(aip_id) or public.can_reviewer_write_aip_feedback(aip_id))
          and kind = 'lgu_note'
        )
      )
    )
    -- Project target
    or
    (
      target_type = 'project'
      and project_id is not null
      and (
        -- Admin can do anything
        (
          public.is_admin()
        )
        -- Citizens: parent AIP must be published + limited kinds
        or (
          public.is_citizen()
          and public.can_citizen_write_project_feedback(project_id)
          and kind in ('question','suggestion','concern','commend')
        )
        -- Owning officials: lgu_note only (reviewers cannot post on projects by design)
        or (
          public.can_owner_write_project_feedback(project_id)
          and kind = 'lgu_note'
        )
      )
    )
  )
);

-- -----------------------------------------------------------------------------
-- 3) Tighten feedback_update_policy so users can't edit into disallowed kinds
--    (admin still can edit anything)
-- -----------------------------------------------------------------------------
drop policy if exists feedback_update_policy on public.feedback;

create policy feedback_update_policy
on public.feedback
for update
to authenticated
using (
  public.is_active_auth()
  and (
    public.is_admin()
    or author_id = public.current_user_id()
  )
)
with check (
  public.is_active_auth()
  and (
    -- admin can update anything
    public.is_admin()

    -- otherwise: must remain compliant with role + target + scope rules
    or (
      author_id = public.current_user_id()
      and source = 'human'
      and (
        (
          target_type = 'aip'
          and aip_id is not null
          and (
            (
              public.is_citizen()
              and public.can_citizen_write_aip_feedback(aip_id)
              and kind in ('question','suggestion','concern','commend')
            )
            or (
              (public.can_owner_write_aip_feedback(aip_id) or public.can_reviewer_write_aip_feedback(aip_id))
              and kind = 'lgu_note'
            )
          )
        )
        or
        (
          target_type = 'project'
          and project_id is not null
          and (
            (
              public.is_citizen()
              and public.can_citizen_write_project_feedback(project_id)
              and kind in ('question','suggestion','concern','commend')
            )
            or (
              public.can_owner_write_project_feedback(project_id)
              and kind = 'lgu_note'
            )
          )
        )
      )
    )
  )
);

commit;

begin;

-- =============================================================================
-- Phase 8 — Chat sessions/messages (RAG chatbot storage) + RLS (REVISED ORDER)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 8.1) chat_sessions
-- -----------------------------------------------------------------------------
create table if not exists public.chat_sessions (
  id uuid primary key default extensions.gen_random_uuid(),

  -- Owner (must exist in profiles; profiles.id == auth.users.id in Phase 2)
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- Optional UI helpers
  title text null check (title is null or length(title) <= 200),

  -- Optional: store UI/system context for the session (filters, last used AIP, etc.)
  context jsonb not null default '{}'::jsonb,

  last_message_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chat_sessions_user_id
  on public.chat_sessions(user_id);

create index if not exists idx_chat_sessions_created_at
  on public.chat_sessions(created_at);

create index if not exists idx_chat_sessions_last_message_at
  on public.chat_sessions(last_message_at);

drop trigger if exists trg_chat_sessions_set_updated_at on public.chat_sessions;
create trigger trg_chat_sessions_set_updated_at
before update on public.chat_sessions
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 8.2) chat_messages
-- -----------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id uuid primary key default extensions.gen_random_uuid(),

  session_id uuid not null references public.chat_sessions(id) on delete cascade,

  -- Client inserts restricted via RLS to role='user'
  role text not null check (role in ('user','assistant','system')),

  content text not null check (length(content) <= 12000),

  citations jsonb null,
  retrieval_meta jsonb null,

  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_session_id
  on public.chat_messages(session_id);

create index if not exists idx_chat_messages_created_at
  on public.chat_messages(created_at);

-- -----------------------------------------------------------------------------
-- 8.3) Helper: can_access_chat_session(session_id)
-- -----------------------------------------------------------------------------
drop function if exists public.can_access_chat_session(uuid);

create or replace function public.can_access_chat_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.chat_sessions s
    where s.id = p_session_id
      and public.is_active_auth()
      and (
        public.is_admin()
        or s.user_id = public.current_user_id()
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- 8.4) Trigger: keep chat_sessions.last_message_at fresh on message insert
-- -----------------------------------------------------------------------------
drop function if exists public.chat_sessions_touch_last_message_at();

create or replace function public.chat_sessions_touch_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.chat_sessions
     set last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at),
         updated_at = now()
   where id = new.session_id;
  return new;
end;
$$;

drop trigger if exists trg_chat_messages_touch_session on public.chat_messages;
create trigger trg_chat_messages_touch_session
after insert on public.chat_messages
for each row
execute function public.chat_sessions_touch_last_message_at();

-- -----------------------------------------------------------------------------
-- 8.5) RLS: chat_sessions
-- -----------------------------------------------------------------------------
alter table public.chat_sessions enable row level security;

drop policy if exists chat_sessions_select_policy on public.chat_sessions;
create policy chat_sessions_select_policy
on public.chat_sessions
for select
to authenticated
using (
  public.is_active_auth()
  and (
    public.is_admin()
    or user_id = public.current_user_id()
  )
);

drop policy if exists chat_sessions_insert_policy on public.chat_sessions;
create policy chat_sessions_insert_policy
on public.chat_sessions
for insert
to authenticated
with check (
  public.is_active_auth()
  and user_id = public.current_user_id()
);

drop policy if exists chat_sessions_update_policy on public.chat_sessions;
create policy chat_sessions_update_policy
on public.chat_sessions
for update
to authenticated
using (
  public.is_active_auth()
  and (
    public.is_admin()
    or user_id = public.current_user_id()
  )
)
with check (
  public.is_active_auth()
  and (
    public.is_admin()
    or user_id = public.current_user_id()
  )
);

drop policy if exists chat_sessions_delete_policy on public.chat_sessions;
create policy chat_sessions_delete_policy
on public.chat_sessions
for delete
to authenticated
using (
  public.is_active_auth()
  and (
    public.is_admin()
    or user_id = public.current_user_id()
  )
);

grant select, insert, update, delete on public.chat_sessions to authenticated;

-- -----------------------------------------------------------------------------
-- 8.6) RLS: chat_messages
-- -----------------------------------------------------------------------------
alter table public.chat_messages enable row level security;

drop policy if exists chat_messages_select_policy on public.chat_messages;
create policy chat_messages_select_policy
on public.chat_messages
for select
to authenticated
using (
  public.is_active_auth()
  and public.can_access_chat_session(session_id)
);

-- INSERT:
-- - authenticated + owns parent session (or admin)
-- - client-side inserts limited to role='user'
drop policy if exists chat_messages_insert_policy on public.chat_messages;
create policy chat_messages_insert_policy
on public.chat_messages
for insert
to authenticated
with check (
  public.is_active_auth()
  and public.can_access_chat_session(session_id)
  and role = 'user'
);

-- UPDATE/DELETE: none (append-only). Service role can still manage if needed.

grant select, insert on public.chat_messages to authenticated;

commit;

begin;

-- =============================================================================
-- Phase 9 — Activity Log (server-only writes) + RLS
-- Requirements:
-- - Admin: can read all rows
-- - Officials (barangay/city/municipal): can read only their own rows (actor_id = current_user_id())
-- - Citizens: cannot read
-- - Anon: cannot read
-- - Writes: server-only via service role (no insert/update/delete policies for authenticated)
-- - Avoid Advisor warnings: no auth.uid() per-row, functions set search_path, consolidated policies
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 9.1) activity_log table
-- -----------------------------------------------------------------------------
create table if not exists public.activity_log (
  id uuid primary key default extensions.gen_random_uuid(),

  actor_id uuid null references public.profiles(id) on delete set null,
  actor_role text null, -- snapshot of role at time of action (optional)

  action text not null check (length(action) <= 80),

  -- flexible subject
  entity_table text null check (entity_table is null or length(entity_table) <= 80),
  entity_id uuid null,

  -- scope snapshot (optional but useful for filtering/admin audits)
  region_id uuid null references public.regions(id) on delete set null,
  province_id uuid null references public.provinces(id) on delete set null,
  city_id uuid null references public.cities(id) on delete set null,
  municipality_id uuid null references public.municipalities(id) on delete set null,
  barangay_id uuid null references public.barangays(id) on delete set null,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_activity_log_created_at
  on public.activity_log(created_at);

create index if not exists idx_activity_log_actor_id
  on public.activity_log(actor_id);

create index if not exists idx_activity_log_entity
  on public.activity_log(entity_table, entity_id);

create index if not exists idx_activity_log_city_id
  on public.activity_log(city_id)
  where city_id is not null;

create index if not exists idx_activity_log_municipality_id
  on public.activity_log(municipality_id)
  where municipality_id is not null;

create index if not exists idx_activity_log_barangay_id
  on public.activity_log(barangay_id)
  where barangay_id is not null;

-- -----------------------------------------------------------------------------
-- 9.2) RLS
-- -----------------------------------------------------------------------------
alter table public.activity_log enable row level security;

-- SELECT:
-- - Admin can read all
-- - Officials can read only their own rows (actor_id = current_user_id())
-- - Citizens/anon: no access (no policy covers them)
drop policy if exists activity_log_select_policy on public.activity_log;
create policy activity_log_select_policy
on public.activity_log
for select
to authenticated
using (
  public.is_active_auth()
  and (
    public.is_admin()
    or (
      (public.is_barangay_official() or public.is_city_official() or public.is_municipal_official())
      and actor_id = public.current_user_id()
    )
  )
);

-- No INSERT/UPDATE/DELETE policies for authenticated => server-only writes via service role.

-- Optional: explicitly grant SELECT to authenticated for PostgREST exposure (still governed by RLS)
grant select on public.activity_log to authenticated;

commit;

begin;

-- =============================================================================
-- Phase 10 — Hardening + Ops Helpers
-- 10A) public.log_activity(...) RPC (SECURITY DEFINER) for server-side logging
-- 10B) Explicit privilege hardening (revoke PUBLIC; keep intended grants)
-- 10C) Retention helper for activity_log
--
-- Notes:
-- - This phase is designed to avoid Supabase Advisor warnings:
--   * SECURITY DEFINER functions specify: set search_path = pg_catalog, public
--   * RLS still protects reads; function is for controlled inserts
-- - This does NOT require client write policies on activity_log.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 10A.1) Helper: get actor role snapshot (best-effort)
-- -----------------------------------------------------------------------------
create or replace function public.current_role_code()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.role::text
  from public.profiles p
  where p.id = public.current_user_id();
$$;

-- -----------------------------------------------------------------------------
-- 10A.2) RPC: log_activity
-- - Intended usage: Next.js Route Handlers call via supabase.rpc('log_activity', {...})
-- - Allows service role OR admin OR officials to log.
-- - Citizens are blocked from logging (adjust if you want citizen logs later).
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
  -- Basic validation
  if p_action is null or length(p_action) = 0 or length(p_action) > 80 then
    raise exception 'invalid action (1..80 chars required)';
  end if;

  if p_entity_table is not null and length(p_entity_table) > 80 then
    raise exception 'invalid entity_table (<= 80 chars)';
  end if;

  -- Determine actor (can be null if service role is used without a user context)
  v_actor := public.current_user_id();
  v_actor_role := public.current_role_code();

  -- Authorization gate:
  -- - Must be authenticated and active
  -- - Admin or any official role may log
  -- - Citizens may NOT log (as requested)
  if not public.is_active_auth() then
    raise exception 'not authorized';
  end if;

  if not (
    public.is_admin()
    or public.is_barangay_official()
    or public.is_city_official()
    or public.is_municipal_official()
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

-- Allow PostgREST RPC execution (still gated inside the function)
grant execute on function public.log_activity(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, jsonb
) to authenticated;

-- -----------------------------------------------------------------------------
-- 10B) Explicit privilege hardening
-- - Revoke default PUBLIC privileges on schema/tables (safe; does not affect owner/service role)
-- - Keep intended grants already established in previous phases.
-- -----------------------------------------------------------------------------

-- Schema hardening: prevent PUBLIC from creating in public schema
revoke create on schema public from public;
revoke usage on schema public from public;

-- Restore minimum schema usage for roles that need it via API
grant usage on schema public to anon, authenticated;

-- Revoke all on sensitive tables from PUBLIC (if any exist)
-- (These are idempotent and safe even if already revoked.)
revoke all on table public.chat_sessions from public;
revoke all on table public.chat_messages from public;
revoke all on table public.activity_log from public;

revoke all on table public.feedback from public;
revoke all on table public.aip_reviews from public;

-- NOTE: we intentionally do NOT revoke select from anon/authenticated where you granted it earlier,
-- because those are explicit grants and RLS will govern access. These revokes only target PUBLIC.

-- -----------------------------------------------------------------------------
-- 10C) Retention helper: purge_activity_log_older_than(days)
-- - Intended to be called by a server cron/job (service role) periodically
-- - Returns number of rows deleted
-- -----------------------------------------------------------------------------
drop function if exists public.purge_activity_log_older_than(int);

create or replace function public.purge_activity_log_older_than(p_days int)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted bigint;
begin
  if p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'p_days must be between 1 and 3650';
  end if;

  -- Only admin/officials can call; prefer service role in practice
  if not public.is_active_auth() then
    raise exception 'not authorized';
  end if;

  if not (public.is_admin()) then
    raise exception 'not authorized';
  end if;

  delete from public.activity_log
  where created_at < now() - make_interval(days => p_days);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function public.purge_activity_log_older_than(int) to authenticated;

commit;

begin;

-- =============================================================================
-- Phase 11 - Embed Dispatch + Config Fallback (2026-02-22, latest effective)
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;

-- Move pg_net out of public schema when needed (hosted-safe; no destructive fallback).
do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_net'
      and n.nspname = 'public'
  ) then
    begin
      execute 'alter extension pg_net set schema extensions';
    exception
      when others then
        raise warning 'could not move extension pg_net to extensions schema: %', sqlerrm;
    end;
  end if;
end
$$;

create schema if not exists app;

create table if not exists app.settings (
  key text primary key,
  value text not null
);

create or replace function app.embed_categorize_url()
returns text
language sql
stable
as $$
  select value from app.settings where key = 'embed_categorize_url'
$$;

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
  v_scope_type text := 'unknown';
  v_scope_id uuid := null;
  v_payload jsonb;
  v_request_id bigint := null;
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
    'published_at', v_aip.published_at,
    'fiscal_year', v_aip.fiscal_year,
    'scope_type', v_scope_type,
    'scope_id', v_scope_id,
    'barangay_id', v_aip.barangay_id,
    'city_id', v_aip.city_id,
    'municipality_id', v_aip.municipality_id
  );

  v_request_id := net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Job-Secret', v_secret
    ),
    body := v_payload
  );

  raise log 'dispatch_embed_categorize_for_aip queued aip %, request_id %', p_aip_id, v_request_id;
  return v_request_id;
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

create or replace function public.on_aip_published_embed_categorize()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
     and old.status is distinct from new.status
     and new.status = 'published' then
    begin
      perform public.dispatch_embed_categorize_for_aip(new.id);
    exception
      when others then
        raise warning 'on_aip_published_embed_categorize dispatch failed for aip %: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_aip_published_embed_categorize on public.aips;
create trigger trg_aip_published_embed_categorize
after update of status
on public.aips
for each row
execute function public.on_aip_published_embed_categorize();

commit;

begin;

-- =============================================================================
-- Phase 12 - Chatbot Hardening + Global Retrieval + Quota/Retention (2026-02-24)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 12.1) Enforce citations for assistant messages (including refusals)
-- ---------------------------------------------------------------------------
alter table public.chat_messages
  drop constraint if exists chk_chat_messages_assistant_citations_required;

alter table public.chat_messages
  add constraint chk_chat_messages_assistant_citations_required check (
    role <> 'assistant'
    or (
      citations is not null
      and jsonb_typeof(citations) = 'array'
      and jsonb_array_length(citations) > 0
    )
  );

-- ---------------------------------------------------------------------------
-- 12.2) Retrieval RPC over published AIP chunks
-- ---------------------------------------------------------------------------
drop function if exists public.match_published_aip_chunks(
  extensions.vector,
  int,
  double precision,
  text,
  uuid,
  jsonb
);

create or replace function public.match_published_aip_chunks(
  query_embedding extensions.vector(3072),
  match_count int default 8,
  min_similarity double precision default 0.0,
  scope_mode text default 'global',
  own_barangay_id uuid default null,
  scope_targets jsonb default '[]'::jsonb
)
returns table (
  source_id text,
  chunk_id uuid,
  content text,
  similarity double precision,
  aip_id uuid,
  fiscal_year int,
  published_at timestamptz,
  scope_type text,
  scope_id uuid,
  scope_name text,
  metadata jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
with params as (
  select
    greatest(1, least(coalesce(match_count, 8), 30)) as k,
    coalesce(min_similarity, 0.0) as sim_floor,
    lower(coalesce(scope_mode, 'global')) as mode
),
targets as (
  select
    lower(nullif(item ->> 'scope_type', '')) as scope_type,
    nullif(item ->> 'scope_id', '')::uuid as scope_id
  from jsonb_array_elements(coalesce(scope_targets, '[]'::jsonb)) item
  where nullif(item ->> 'scope_id', '') is not null
),
rows_scoped as (
  select
    c.id as chunk_id,
    c.chunk_text as content,
    c.metadata,
    a.id as aip_id,
    a.fiscal_year,
    a.published_at,
    case
      when a.barangay_id is not null then 'barangay'
      when a.city_id is not null then 'city'
      when a.municipality_id is not null then 'municipality'
      else 'unknown'
    end as scope_type,
    case
      when a.barangay_id is not null then a.barangay_id
      when a.city_id is not null then a.city_id
      when a.municipality_id is not null then a.municipality_id
      else null
    end as scope_id,
    coalesce(b.name, ci.name, m.name, 'Unknown Scope') as scope_name,
    1 - (e.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.aip_chunks c
  join public.aip_chunk_embeddings e on e.chunk_id = c.id
  join public.aips a on a.id = c.aip_id
  left join public.barangays b on b.id = a.barangay_id
  left join public.cities ci on ci.id = a.city_id
  left join public.municipalities m on m.id = a.municipality_id
  cross join params p
  where a.status = 'published'
    and (
      p.mode = 'global'
      or (
        p.mode = 'own_barangay'
        and own_barangay_id is not null
        and a.barangay_id = own_barangay_id
      )
      or (
        p.mode = 'named_scopes'
        and exists (
          select 1
          from targets t
          where
            (t.scope_type = 'barangay' and a.barangay_id = t.scope_id)
            or (t.scope_type = 'city' and a.city_id = t.scope_id)
            or (t.scope_type = 'municipality' and a.municipality_id = t.scope_id)
        )
      )
    )
),
ranked as (
  select *
  from rows_scoped
  where similarity >= (select sim_floor from params)
  order by similarity desc, chunk_id
  limit (select k from params)
)
select
  'S' || row_number() over (order by similarity desc, chunk_id) as source_id,
  chunk_id,
  content,
  similarity,
  aip_id,
  fiscal_year,
  published_at,
  scope_type,
  scope_id,
  scope_name,
  metadata
from ranked;
$$;

revoke all on function public.match_published_aip_chunks(
  extensions.vector,
  int,
  double precision,
  text,
  uuid,
  jsonb
) from public;
revoke all on function public.match_published_aip_chunks(
  extensions.vector,
  int,
  double precision,
  text,
  uuid,
  jsonb
) from anon;
revoke all on function public.match_published_aip_chunks(
  extensions.vector,
  int,
  double precision,
  text,
  uuid,
  jsonb
) from authenticated;
grant execute on function public.match_published_aip_chunks(
  extensions.vector,
  int,
  double precision,
  text,
  uuid,
  jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- 12.3) DB-backed rate-limit event log
-- ---------------------------------------------------------------------------
create table if not exists public.chat_rate_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  route text not null default 'barangay_chat_message',
  event_status text not null check (
    event_status in ('accepted', 'rejected_minute', 'rejected_hour', 'rejected_day')
  ),
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_rate_events_user_created_at
  on public.chat_rate_events(user_id, created_at desc);

create index if not exists idx_chat_rate_events_created_at
  on public.chat_rate_events(created_at desc);

alter table public.chat_rate_events enable row level security;

drop policy if exists chat_rate_events_select_admin_only on public.chat_rate_events;
create policy chat_rate_events_select_admin_only
on public.chat_rate_events
for select
to authenticated
using (
  public.is_active_auth()
  and public.is_admin()
);

grant select on public.chat_rate_events to authenticated;

-- ---------------------------------------------------------------------------
-- 12.4) Atomic chat quota function (service role)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 12.5) Retention helper (default 90 days)
-- ---------------------------------------------------------------------------
drop function if exists public.purge_chat_data_older_than(int);

create or replace function public.purge_chat_data_older_than(p_days int default 90)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted bigint;
begin
  if p_days < 1 or p_days > 3650 then
    raise exception 'p_days must be between 1 and 3650';
  end if;

  delete from public.chat_sessions
  where updated_at < now() - make_interval(days => p_days);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_chat_data_older_than(int) from public;
revoke all on function public.purge_chat_data_older_than(int) from anon;
revoke all on function public.purge_chat_data_older_than(int) from authenticated;
grant execute on function public.purge_chat_data_older_than(int) to service_role;

commit;

begin;

-- =============================================================================
-- Phase 13 - AIP Totals Table + Policy (2026-02-24)
-- =============================================================================

create table if not exists public.aip_totals (
  id uuid primary key default extensions.gen_random_uuid(),
  aip_id uuid not null references public.aips(id) on delete cascade,
  fiscal_year int not null,
  barangay_id uuid null references public.barangays(id) on delete set null,
  city_id uuid null references public.cities(id) on delete set null,
  municipality_id uuid null references public.municipalities(id) on delete set null,
  total_investment_program numeric not null,
  currency text not null default 'PHP',
  page_no int null,
  evidence_text text not null,
  source_label text not null default 'pdf_total_line',
  created_at timestamptz not null default now(),
  constraint uq_aip_totals_aip_source unique (aip_id, source_label),
  constraint chk_aip_totals_exactly_one_scope check (
    ((barangay_id is not null)::int + (city_id is not null)::int + (municipality_id is not null)::int) = 1
  )
);

create index if not exists idx_aip_totals_aip_id
  on public.aip_totals(aip_id);

create index if not exists idx_aip_totals_scope_fiscal
  on public.aip_totals(barangay_id, city_id, municipality_id, fiscal_year);

alter table public.aip_totals enable row level security;

drop policy if exists aip_totals_select_policy on public.aip_totals;
create policy aip_totals_select_policy
on public.aip_totals
for select
to authenticated
using (
  public.is_active_auth()
);

grant select on public.aip_totals to authenticated;

commit;


begin;

-- =============================================================================
-- Barangay audit logging completion: CRUD trigger coverage + barangay feed RLS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) AIP CRUD audit trigger (barangay officials only)
-- -----------------------------------------------------------------------------
create or replace function public.trg_aips_activity_log_crud()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_actor_name text;
  v_action text;
  v_details text;
  v_entity_id uuid;
  v_fiscal_year int;
  v_status text;
  v_previous_status text;
  v_barangay_id uuid;
  v_city_id uuid;
  v_municipality_id uuid;
begin
  v_actor_id := public.current_user_id();
  v_actor_role := public.current_role_code();

  if v_actor_id is null or v_actor_role is null or v_actor_role <> 'barangay_official' then
    return coalesce(new, old);
  end if;

  select nullif(trim(p.full_name), '')
    into v_actor_name
  from public.profiles p
  where p.id = v_actor_id;

  if tg_op = 'INSERT' then
    v_action := 'aip_created';
    v_entity_id := new.id;
    v_fiscal_year := new.fiscal_year;
    v_status := new.status::text;
    v_previous_status := null;
    v_barangay_id := new.barangay_id;
    v_city_id := new.city_id;
    v_municipality_id := new.municipality_id;
    v_details := format('Created AIP record for fiscal year %s.', coalesce(new.fiscal_year::text, 'unknown'));
  elsif tg_op = 'UPDATE' then
    v_action := 'aip_updated';
    v_entity_id := new.id;
    v_fiscal_year := new.fiscal_year;
    v_status := new.status::text;
    v_previous_status := old.status::text;
    v_barangay_id := new.barangay_id;
    v_city_id := new.city_id;
    v_municipality_id := new.municipality_id;

    if new.status is distinct from old.status then
      v_details := format(
        'Updated AIP record for fiscal year %s (status: %s -> %s).',
        coalesce(new.fiscal_year::text, 'unknown'),
        coalesce(old.status::text, 'unknown'),
        coalesce(new.status::text, 'unknown')
      );
    else
      v_details := format('Updated AIP record for fiscal year %s.', coalesce(new.fiscal_year::text, 'unknown'));
    end if;
  else
    v_action := 'aip_deleted';
    v_entity_id := old.id;
    v_fiscal_year := old.fiscal_year;
    v_status := old.status::text;
    v_previous_status := null;
    v_barangay_id := old.barangay_id;
    v_city_id := old.city_id;
    v_municipality_id := old.municipality_id;
    v_details := format('Deleted AIP record for fiscal year %s.', coalesce(old.fiscal_year::text, 'unknown'));
  end if;

  perform public.log_activity(
    p_action => v_action,
    p_entity_table => 'aips',
    p_entity_id => v_entity_id,
    p_region_id => null,
    p_province_id => null,
    p_city_id => v_city_id,
    p_municipality_id => v_municipality_id,
    p_barangay_id => v_barangay_id,
    p_metadata => jsonb_build_object(
      'source', 'crud',
      'actor_name', coalesce(v_actor_name, 'Unknown'),
      'actor_position', 'Barangay Official',
      'details', v_details,
      'fiscal_year', v_fiscal_year,
      'status', v_status,
      'previous_status', v_previous_status
    )
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_aips_activity_log_crud on public.aips;
create trigger trg_aips_activity_log_crud
after insert or update or delete
on public.aips
for each row
execute function public.trg_aips_activity_log_crud();

-- -----------------------------------------------------------------------------
-- B) Project CRUD audit trigger (barangay officials only)
-- -----------------------------------------------------------------------------
create or replace function public.trg_projects_activity_log_crud()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_actor_name text;
  v_action text;
  v_details text;
  v_project_id uuid;
  v_aip_id uuid;
  v_aip_ref_code text;
  v_category text;
  v_barangay_id uuid;
  v_city_id uuid;
  v_municipality_id uuid;
begin
  v_actor_id := public.current_user_id();
  v_actor_role := public.current_role_code();

  if v_actor_id is null or v_actor_role is null or v_actor_role <> 'barangay_official' then
    return coalesce(new, old);
  end if;

  select nullif(trim(p.full_name), '')
    into v_actor_name
  from public.profiles p
  where p.id = v_actor_id;

  if tg_op = 'INSERT' then
    v_action := 'project_record_created';
    v_project_id := new.id;
    v_aip_id := new.aip_id;
    v_aip_ref_code := new.aip_ref_code;
    v_category := new.category::text;
    v_details := format('Created project record %s.', coalesce(new.aip_ref_code, new.id::text));
  elsif tg_op = 'UPDATE' then
    v_action := 'project_record_updated';
    v_project_id := new.id;
    v_aip_id := new.aip_id;
    v_aip_ref_code := new.aip_ref_code;
    v_category := new.category::text;
    v_details := format('Updated project record %s.', coalesce(new.aip_ref_code, new.id::text));
  else
    v_action := 'project_record_deleted';
    v_project_id := old.id;
    v_aip_id := old.aip_id;
    v_aip_ref_code := old.aip_ref_code;
    v_category := old.category::text;
    v_details := format('Deleted project record %s.', coalesce(old.aip_ref_code, old.id::text));
  end if;

  select a.barangay_id, a.city_id, a.municipality_id
    into v_barangay_id, v_city_id, v_municipality_id
  from public.aips a
  where a.id = v_aip_id;

  perform public.log_activity(
    p_action => v_action,
    p_entity_table => 'projects',
    p_entity_id => v_project_id,
    p_region_id => null,
    p_province_id => null,
    p_city_id => v_city_id,
    p_municipality_id => v_municipality_id,
    p_barangay_id => v_barangay_id,
    p_metadata => jsonb_build_object(
      'source', 'crud',
      'actor_name', coalesce(v_actor_name, 'Unknown'),
      'actor_position', 'Barangay Official',
      'details', v_details,
      'aip_id', v_aip_id,
      'aip_ref_code', v_aip_ref_code,
      'project_category', v_category
    )
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_projects_activity_log_crud on public.projects;
create trigger trg_projects_activity_log_crud
after insert or update or delete
on public.projects
for each row
execute function public.trg_projects_activity_log_crud();

-- -----------------------------------------------------------------------------
-- C) Feedback CRUD audit trigger (barangay officials only)
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

  if v_actor_id is null or v_actor_role is null or v_actor_role <> 'barangay_official' then
    return coalesce(new, old);
  end if;

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
      'actor_position', 'Barangay Official',
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

-- -----------------------------------------------------------------------------
-- D) Barangay-official activity feed visibility
-- -----------------------------------------------------------------------------
drop policy if exists activity_log_select_policy on public.activity_log;
create policy activity_log_select_policy
on public.activity_log
for select
to authenticated
using (
  public.is_active_auth()
  and (
    public.is_admin()
    or (
      public.is_barangay_official()
      and actor_role = 'barangay_official'
      and barangay_id is not null
      and barangay_id = public.current_barangay_id()
    )
    or (
      (public.is_city_official() or public.is_municipal_official())
      and actor_id = public.current_user_id()
    )
  )
);

commit;

begin;

-- =============================================================================
-- City audit logging completion: CRUD trigger coverage + city feed RLS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) AIP CRUD audit trigger (barangay + city officials)
-- -----------------------------------------------------------------------------
create or replace function public.trg_aips_activity_log_crud()
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
  v_entity_id uuid;
  v_fiscal_year int;
  v_status text;
  v_previous_status text;
  v_barangay_id uuid;
  v_city_id uuid;
  v_municipality_id uuid;
begin
  v_actor_id := public.current_user_id();
  v_actor_role := public.current_role_code();

  if v_actor_id is null
     or v_actor_role is null
     or v_actor_role not in ('barangay_official', 'city_official') then
    return coalesce(new, old);
  end if;

  v_actor_position :=
    case
      when v_actor_role = 'city_official' then 'City Official'
      else 'Barangay Official'
    end;

  select nullif(trim(p.full_name), '')
    into v_actor_name
  from public.profiles p
  where p.id = v_actor_id;

  if tg_op = 'INSERT' then
    v_action := 'aip_created';
    v_entity_id := new.id;
    v_fiscal_year := new.fiscal_year;
    v_status := new.status::text;
    v_previous_status := null;
    v_barangay_id := new.barangay_id;
    v_city_id := new.city_id;
    v_municipality_id := new.municipality_id;
    v_details := format('Created AIP record for fiscal year %s.', coalesce(new.fiscal_year::text, 'unknown'));
  elsif tg_op = 'UPDATE' then
    v_action := 'aip_updated';
    v_entity_id := new.id;
    v_fiscal_year := new.fiscal_year;
    v_status := new.status::text;
    v_previous_status := old.status::text;
    v_barangay_id := new.barangay_id;
    v_city_id := new.city_id;
    v_municipality_id := new.municipality_id;

    if new.status is distinct from old.status then
      v_details := format(
        'Updated AIP record for fiscal year %s (status: %s -> %s).',
        coalesce(new.fiscal_year::text, 'unknown'),
        coalesce(old.status::text, 'unknown'),
        coalesce(new.status::text, 'unknown')
      );
    else
      v_details := format('Updated AIP record for fiscal year %s.', coalesce(new.fiscal_year::text, 'unknown'));
    end if;
  else
    v_action := 'aip_deleted';
    v_entity_id := old.id;
    v_fiscal_year := old.fiscal_year;
    v_status := old.status::text;
    v_previous_status := null;
    v_barangay_id := old.barangay_id;
    v_city_id := old.city_id;
    v_municipality_id := old.municipality_id;
    v_details := format('Deleted AIP record for fiscal year %s.', coalesce(old.fiscal_year::text, 'unknown'));
  end if;

  if v_actor_role = 'city_official' and v_city_id is null then
    v_city_id := public.current_city_id();
  end if;

  perform public.log_activity(
    p_action => v_action,
    p_entity_table => 'aips',
    p_entity_id => v_entity_id,
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
      'fiscal_year', v_fiscal_year,
      'status', v_status,
      'previous_status', v_previous_status
    )
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_aips_activity_log_crud on public.aips;
create trigger trg_aips_activity_log_crud
after insert or update or delete
on public.aips
for each row
execute function public.trg_aips_activity_log_crud();

-- -----------------------------------------------------------------------------
-- B) Project CRUD audit trigger (barangay + city officials)
-- -----------------------------------------------------------------------------
create or replace function public.trg_projects_activity_log_crud()
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
  v_project_id uuid;
  v_aip_id uuid;
  v_aip_ref_code text;
  v_category text;
  v_barangay_id uuid;
  v_city_id uuid;
  v_municipality_id uuid;
begin
  v_actor_id := public.current_user_id();
  v_actor_role := public.current_role_code();

  if v_actor_id is null
     or v_actor_role is null
     or v_actor_role not in ('barangay_official', 'city_official') then
    return coalesce(new, old);
  end if;

  v_actor_position :=
    case
      when v_actor_role = 'city_official' then 'City Official'
      else 'Barangay Official'
    end;

  select nullif(trim(p.full_name), '')
    into v_actor_name
  from public.profiles p
  where p.id = v_actor_id;

  if tg_op = 'INSERT' then
    v_action := 'project_record_created';
    v_project_id := new.id;
    v_aip_id := new.aip_id;
    v_aip_ref_code := new.aip_ref_code;
    v_category := new.category::text;
    v_details := format('Created project record %s.', coalesce(new.aip_ref_code, new.id::text));
  elsif tg_op = 'UPDATE' then
    v_action := 'project_record_updated';
    v_project_id := new.id;
    v_aip_id := new.aip_id;
    v_aip_ref_code := new.aip_ref_code;
    v_category := new.category::text;
    v_details := format('Updated project record %s.', coalesce(new.aip_ref_code, new.id::text));
  else
    v_action := 'project_record_deleted';
    v_project_id := old.id;
    v_aip_id := old.aip_id;
    v_aip_ref_code := old.aip_ref_code;
    v_category := old.category::text;
    v_details := format('Deleted project record %s.', coalesce(old.aip_ref_code, old.id::text));
  end if;

  select a.barangay_id, a.city_id, a.municipality_id
    into v_barangay_id, v_city_id, v_municipality_id
  from public.aips a
  where a.id = v_aip_id;

  if v_actor_role = 'city_official' and v_city_id is null then
    v_city_id := public.current_city_id();
  end if;

  perform public.log_activity(
    p_action => v_action,
    p_entity_table => 'projects',
    p_entity_id => v_project_id,
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
      'aip_id', v_aip_id,
      'aip_ref_code', v_aip_ref_code,
      'project_category', v_category
    )
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_projects_activity_log_crud on public.projects;
create trigger trg_projects_activity_log_crud
after insert or update or delete
on public.projects
for each row
execute function public.trg_projects_activity_log_crud();

-- -----------------------------------------------------------------------------
-- C) Feedback CRUD audit trigger (barangay + city officials)
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
     or v_actor_role not in ('barangay_official', 'city_official') then
    return coalesce(new, old);
  end if;

  v_actor_position :=
    case
      when v_actor_role = 'city_official' then 'City Official'
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

-- -----------------------------------------------------------------------------
-- D) AIP review CRUD audit trigger (city officials only)
-- -----------------------------------------------------------------------------
create or replace function public.trg_aip_reviews_activity_log_crud()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_actor_name text;
  v_action text;
  v_details text;
  v_review_id uuid;
  v_review_action text;
  v_reviewer_id uuid;
  v_note text;
  v_aip_id uuid;
  v_aip_status text;
  v_barangay_id uuid;
  v_city_id uuid;
  v_municipality_id uuid;
begin
  v_actor_id := public.current_user_id();
  v_actor_role := public.current_role_code();

  if v_actor_id is null or v_actor_role is null or v_actor_role <> 'city_official' then
    return coalesce(new, old);
  end if;

  select nullif(trim(p.full_name), '')
    into v_actor_name
  from public.profiles p
  where p.id = v_actor_id;

  if tg_op = 'INSERT' then
    v_action := 'aip_review_record_created';
    v_review_id := new.id;
    v_aip_id := new.aip_id;
    v_review_action := new.action::text;
    v_reviewer_id := new.reviewer_id;
    v_note := new.note;
  elsif tg_op = 'UPDATE' then
    v_action := 'aip_review_record_updated';
    v_review_id := new.id;
    v_aip_id := new.aip_id;
    v_review_action := new.action::text;
    v_reviewer_id := new.reviewer_id;
    v_note := new.note;
  else
    v_action := 'aip_review_record_deleted';
    v_review_id := old.id;
    v_aip_id := old.aip_id;
    v_review_action := old.action::text;
    v_reviewer_id := old.reviewer_id;
    v_note := old.note;
  end if;

  if v_aip_id is not null then
    select a.status::text, a.barangay_id, a.city_id, a.municipality_id
      into v_aip_status, v_barangay_id, v_city_id, v_municipality_id
    from public.aips a
    where a.id = v_aip_id;

    if v_city_id is null and v_barangay_id is not null then
      select b.city_id
        into v_city_id
      from public.barangays b
      where b.id = v_barangay_id;
    end if;
  end if;

  if v_city_id is null then
    v_city_id := public.current_city_id();
  end if;

  if v_action = 'aip_review_record_created' then
    v_details := format('Created AIP review record (%s).', coalesce(v_review_action, 'unknown'));
  elsif v_action = 'aip_review_record_updated' then
    v_details := format('Updated AIP review record (%s).', coalesce(v_review_action, 'unknown'));
  else
    v_details := format('Deleted AIP review record (%s).', coalesce(v_review_action, 'unknown'));
  end if;

  perform public.log_activity(
    p_action => v_action,
    p_entity_table => 'aip_reviews',
    p_entity_id => v_review_id,
    p_region_id => null,
    p_province_id => null,
    p_city_id => v_city_id,
    p_municipality_id => v_municipality_id,
    p_barangay_id => v_barangay_id,
    p_metadata => jsonb_build_object(
      'source', 'crud',
      'actor_name', coalesce(v_actor_name, 'Unknown'),
      'actor_position', 'City Official',
      'details', v_details,
      'aip_id', v_aip_id,
      'aip_status', v_aip_status,
      'review_action', v_review_action,
      'reviewer_id', v_reviewer_id,
      'note', v_note
    )
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_aip_reviews_activity_log_crud on public.aip_reviews;
create trigger trg_aip_reviews_activity_log_crud
after insert or update or delete
on public.aip_reviews
for each row
execute function public.trg_aip_reviews_activity_log_crud();

-- -----------------------------------------------------------------------------
-- E) City-official activity feed visibility
-- -----------------------------------------------------------------------------
drop policy if exists activity_log_select_policy on public.activity_log;
create policy activity_log_select_policy
on public.activity_log
for select
to authenticated
using (
  public.is_active_auth()
  and (
    public.is_admin()
    or (
      public.is_barangay_official()
      and actor_role = 'barangay_official'
      and barangay_id is not null
      and barangay_id = public.current_barangay_id()
    )
    or (
      public.is_city_official()
      and actor_role = 'city_official'
      and city_id is not null
      and city_id = public.current_city_id()
    )
    or (
      public.is_municipal_official()
      and actor_id = public.current_user_id()
    )
  )
);

commit;

