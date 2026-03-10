begin;

-- Support nullable/nonstandard AIP reference codes while keeping idempotent upserts.
alter table if exists public.projects
  add column if not exists project_key text;

update public.projects
set project_key = coalesce(nullif(btrim(aip_ref_code), ''), 'legacy:' || id::text)
where project_key is null
   or btrim(project_key) = '';

alter table if exists public.projects
  alter column project_key set not null;

alter table if exists public.projects
  alter column aip_ref_code drop not null;

alter table if exists public.projects
  drop constraint if exists uq_projects_ref;

alter table if exists public.projects
  drop constraint if exists uq_projects_key;

alter table if exists public.projects
  add constraint uq_projects_key unique (aip_id, project_key);

-- Regenerate sector code so only canonical prefixes produce a sector.
alter table if exists public.projects
  drop constraint if exists fk_projects_sector;

alter table if exists public.projects
  drop column if exists sector_code;

alter table if exists public.projects
  add column sector_code text generated always as (
    case
      when aip_ref_code is not null and left(aip_ref_code, 4) in ('1000', '3000', '8000', '9000')
        then left(aip_ref_code, 4)
      else null
    end
  ) stored;

alter table if exists public.projects
  add constraint fk_projects_sector foreign key (sector_code) references public.sectors(code);

create index if not exists idx_projects_sector
  on public.projects(sector_code);

commit;
