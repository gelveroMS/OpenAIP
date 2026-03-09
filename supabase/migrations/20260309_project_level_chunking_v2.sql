do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'aip_chunk_type'
  ) then
    create type public.aip_chunk_type as enum (
      'project',
      'section_summary',
      'category_summary',
      'legacy_category_group'
    );
  end if;
end
$$;

alter table public.aip_chunks
  add column if not exists chunk_type public.aip_chunk_type,
  add column if not exists ingestion_version smallint,
  add column if not exists document_type text,
  add column if not exists publication_status text,
  add column if not exists fiscal_year integer,
  add column if not exists scope_type text,
  add column if not exists scope_name text,
  add column if not exists office_name text,
  add column if not exists project_ref_code text,
  add column if not exists source_page integer,
  add column if not exists theme_tags text[],
  add column if not exists sector_tags text[];

alter table public.aip_chunks
  alter column chunk_type set default 'legacy_category_group'::public.aip_chunk_type,
  alter column ingestion_version set default 1,
  alter column document_type set default 'AIP',
  alter column publication_status set default 'published',
  alter column theme_tags set default '{}'::text[],
  alter column sector_tags set default '{}'::text[];

update public.aip_chunks c
set
  chunk_type = case
    when lower(coalesce(c.metadata ->> 'chunk_type', '')) = 'project' then 'project'::public.aip_chunk_type
    when lower(coalesce(c.metadata ->> 'chunk_type', '')) = 'section_summary' then 'section_summary'::public.aip_chunk_type
    when lower(coalesce(c.metadata ->> 'chunk_type', '')) = 'category_summary' then 'category_summary'::public.aip_chunk_type
    when lower(coalesce(c.metadata ->> 'chunk_kind', '')) = 'project' then 'project'::public.aip_chunk_type
    when lower(coalesce(c.metadata ->> 'chunk_kind', '')) = 'section_summary' then 'section_summary'::public.aip_chunk_type
    when lower(coalesce(c.metadata ->> 'chunk_kind', '')) = 'category_summary' then 'category_summary'::public.aip_chunk_type
    else 'legacy_category_group'::public.aip_chunk_type
  end,
  ingestion_version = case
    when coalesce(c.metadata ->> 'ingestion_version', '') ~ '^[0-9]+$'
      then greatest(1, (c.metadata ->> 'ingestion_version')::smallint)
    else coalesce(c.ingestion_version, 1)
  end,
  document_type = coalesce(nullif(c.metadata ->> 'document_type', ''), coalesce(c.document_type, 'AIP')),
  publication_status = coalesce(
    nullif(c.metadata ->> 'publication_status', ''),
    a.status::text,
    nullif(c.publication_status, ''),
    'published'
  ),
  fiscal_year = coalesce(
    case when coalesce(c.metadata ->> 'fiscal_year', '') ~ '^[0-9]{4}$'
      then (c.metadata ->> 'fiscal_year')::integer
      else null end,
    c.fiscal_year,
    a.fiscal_year
  ),
  scope_type = coalesce(
    nullif(c.metadata ->> 'scope_type', ''),
    c.scope_type,
    case
      when a.barangay_id is not null then 'barangay'
      when a.city_id is not null then 'city'
      when a.municipality_id is not null then 'municipality'
      else 'unknown'
    end
  ),
  scope_name = coalesce(
    nullif(c.metadata ->> 'scope_name', ''),
    c.scope_name,
    coalesce(b.name, ci.name, m.name, 'Unknown Scope')
  ),
  office_name = coalesce(
    nullif(c.metadata ->> 'office_name', ''),
    nullif(c.metadata ->> 'implementing_agency', ''),
    c.office_name
  ),
  project_ref_code = coalesce(
    nullif(c.metadata ->> 'project_ref_code', ''),
    nullif(c.metadata ->> 'project_ref', ''),
    c.project_ref_code
  ),
  source_page = coalesce(
    case when coalesce(c.metadata ->> 'source_page', '') ~ '^[0-9]+$'
      then (c.metadata ->> 'source_page')::integer
      else null end,
    case when coalesce(c.metadata ->> 'page_no', '') ~ '^[0-9]+$'
      then (c.metadata ->> 'page_no')::integer
      else null end,
    c.source_page
  ),
  theme_tags = coalesce(
    case
      when jsonb_typeof(c.metadata -> 'theme_tags') = 'array' then (
        select array_agg(lower(trim(value)))
        from jsonb_array_elements_text(c.metadata -> 'theme_tags') as value
        where trim(value) <> ''
      )
      else null
    end,
    c.theme_tags,
    '{}'::text[]
  ),
  sector_tags = coalesce(
    case
      when jsonb_typeof(c.metadata -> 'sector_tags') = 'array' then (
        select array_agg(lower(trim(value)))
        from jsonb_array_elements_text(c.metadata -> 'sector_tags') as value
        where trim(value) <> ''
      )
      else null
    end,
    c.sector_tags,
    '{}'::text[]
  )
from public.aips a
left join public.barangays b on b.id = a.barangay_id
left join public.cities ci on ci.id = a.city_id
left join public.municipalities m on m.id = a.municipality_id
where a.id = c.aip_id;

update public.aip_chunks
set
  chunk_type = coalesce(chunk_type, 'legacy_category_group'::public.aip_chunk_type),
  ingestion_version = greatest(1, coalesce(ingestion_version, 1)),
  document_type = coalesce(nullif(document_type, ''), 'AIP'),
  publication_status = coalesce(nullif(publication_status, ''), 'published'),
  theme_tags = coalesce(theme_tags, '{}'::text[]),
  sector_tags = coalesce(sector_tags, '{}'::text[]);

alter table public.aip_chunks
  alter column chunk_type set not null,
  alter column ingestion_version set not null,
  alter column document_type set not null,
  alter column publication_status set not null,
  alter column theme_tags set not null,
  alter column sector_tags set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'aip_chunks_ingestion_version_check'
  ) then
    alter table public.aip_chunks
      add constraint aip_chunks_ingestion_version_check
      check (ingestion_version >= 1);
  end if;
end
$$;

create index if not exists idx_aip_chunks_prefilter_v2
  on public.aip_chunks (chunk_type, publication_status, fiscal_year, scope_type, scope_name);

create index if not exists idx_aip_chunks_doc_office_v2
  on public.aip_chunks (document_type, office_name);

create index if not exists idx_aip_chunks_project_ref_code
  on public.aip_chunks (project_ref_code)
  where project_ref_code is not null;

create index if not exists idx_aip_chunks_theme_tags
  on public.aip_chunks using gin (theme_tags);

create index if not exists idx_aip_chunks_sector_tags
  on public.aip_chunks using gin (sector_tags);

create index if not exists idx_aips_published_fiscal_year
  on public.aips (fiscal_year)
  where status = 'published';

drop function if exists public.match_published_aip_project_chunks_v2(
  extensions.vector,
  integer,
  double precision,
  text,
  uuid,
  jsonb,
  integer,
  text,
  text,
  text,
  text,
  text,
  text[],
  text[],
  boolean
);

create or replace function public.match_published_aip_project_chunks_v2(
  query_embedding extensions.vector,
  match_count integer default 4,
  min_similarity double precision default 0.0,
  scope_mode text default 'global',
  own_barangay_id uuid default null,
  scope_targets jsonb default '[]'::jsonb,
  filter_fiscal_year integer default null,
  filter_scope_type text default null,
  filter_scope_name text default null,
  filter_document_type text default null,
  filter_publication_status text default 'published',
  filter_office_name text default null,
  filter_theme_tags text[] default null,
  filter_sector_tags text[] default null,
  include_summary_chunks boolean default false
) returns table(
  source_id text,
  chunk_id uuid,
  content text,
  similarity double precision,
  aip_id uuid,
  fiscal_year integer,
  published_at timestamp with time zone,
  scope_type text,
  scope_id uuid,
  scope_name text,
  chunk_type text,
  document_type text,
  publication_status text,
  office_name text,
  project_ref_code text,
  source_page integer,
  theme_tags text[],
  sector_tags text[],
  metadata jsonb
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
with params as (
  select
    greatest(1, least(coalesce(match_count, 4), 30)) as k,
    coalesce(min_similarity, 0.0) as sim_floor,
    lower(coalesce(scope_mode, 'global')) as mode,
    filter_fiscal_year as filter_fiscal_year,
    lower(nullif(trim(filter_scope_type), '')) as filter_scope_type,
    lower(nullif(trim(filter_scope_name), '')) as filter_scope_name,
    lower(nullif(trim(filter_document_type), '')) as filter_document_type,
    lower(coalesce(nullif(trim(filter_publication_status), ''), 'published')) as filter_publication_status,
    lower(nullif(trim(filter_office_name), '')) as filter_office_name,
    (
      select array_agg(lower(trim(tag)))
      from unnest(filter_theme_tags) tag
      where trim(tag) <> ''
    ) as filter_theme_tags,
    (
      select array_agg(lower(trim(tag)))
      from unnest(filter_sector_tags) tag
      where trim(tag) <> ''
    ) as filter_sector_tags,
    coalesce(include_summary_chunks, false) as include_summary_chunks
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
    c.chunk_type::text as chunk_type,
    c.document_type,
    c.publication_status,
    c.office_name,
    c.project_ref_code,
    c.source_page,
    c.theme_tags,
    c.sector_tags,
    a.id as aip_id,
    coalesce(c.fiscal_year, a.fiscal_year) as fiscal_year,
    a.published_at,
    coalesce(
      nullif(c.scope_type, ''),
      case
        when a.barangay_id is not null then 'barangay'
        when a.city_id is not null then 'city'
        when a.municipality_id is not null then 'municipality'
        else 'unknown'
      end
    ) as scope_type,
    case
      when a.barangay_id is not null then a.barangay_id
      when a.city_id is not null then a.city_id
      when a.municipality_id is not null then a.municipality_id
      else null
    end as scope_id,
    coalesce(nullif(c.scope_name, ''), b.name, ci.name, m.name, 'Unknown Scope') as scope_name,
    1 - (e.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.aip_chunks c
  join public.aip_chunk_embeddings e on e.chunk_id = c.id
  join public.aips a on a.id = c.aip_id
  left join public.barangays b on b.id = a.barangay_id
  left join public.cities ci on ci.id = a.city_id
  left join public.municipalities m on m.id = a.municipality_id
  cross join params p
  where
    lower(coalesce(a.status::text, nullif(c.publication_status, ''), 'published')) = p.filter_publication_status
    and (
      c.chunk_type = 'project'::public.aip_chunk_type
      or (
        p.include_summary_chunks
        and c.chunk_type in ('section_summary'::public.aip_chunk_type, 'category_summary'::public.aip_chunk_type)
      )
    )
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
    and (
      p.filter_fiscal_year is null
      or coalesce(c.fiscal_year, a.fiscal_year) = p.filter_fiscal_year
    )
    and (
      p.filter_scope_type is null
      or lower(
        coalesce(
          nullif(c.scope_type, ''),
          case
            when a.barangay_id is not null then 'barangay'
            when a.city_id is not null then 'city'
            when a.municipality_id is not null then 'municipality'
            else 'unknown'
          end
        )
      ) = p.filter_scope_type
    )
    and (
      p.filter_scope_name is null
      or lower(coalesce(nullif(c.scope_name, ''), b.name, ci.name, m.name, 'Unknown Scope')) = p.filter_scope_name
    )
    and (
      p.filter_document_type is null
      or lower(coalesce(nullif(c.document_type, ''), 'AIP')) = p.filter_document_type
    )
    and (
      p.filter_office_name is null
      or lower(coalesce(c.office_name, '')) = p.filter_office_name
    )
    and (
      p.filter_theme_tags is null
      or cardinality(p.filter_theme_tags) = 0
      or coalesce(c.theme_tags, '{}'::text[]) && p.filter_theme_tags
    )
    and (
      p.filter_sector_tags is null
      or cardinality(p.filter_sector_tags) = 0
      or coalesce(c.sector_tags, '{}'::text[]) && p.filter_sector_tags
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
  chunk_type,
  document_type,
  publication_status,
  office_name,
  project_ref_code,
  source_page,
  theme_tags,
  sector_tags,
  metadata
from ranked;
$$;

alter function public.match_published_aip_project_chunks_v2(
  extensions.vector,
  integer,
  double precision,
  text,
  uuid,
  jsonb,
  integer,
  text,
  text,
  text,
  text,
  text,
  text[],
  text[],
  boolean
) owner to postgres;

revoke all on function public.match_published_aip_project_chunks_v2(
  extensions.vector,
  integer,
  double precision,
  text,
  uuid,
  jsonb,
  integer,
  text,
  text,
  text,
  text,
  text,
  text[],
  text[],
  boolean
) from public;

grant execute on function public.match_published_aip_project_chunks_v2(
  extensions.vector,
  integer,
  double precision,
  text,
  uuid,
  jsonb,
  integer,
  text,
  text,
  text,
  text,
  text,
  text[],
  text[],
  boolean
) to anon, authenticated, service_role;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'aip_chunk_type'
  ) then
    create type public.aip_chunk_type as enum (
      'project',
      'section_summary',
      'category_summary',
      'legacy_category_group'
    );
  end if;
end
$$;

alter table public.aip_chunks
  add column if not exists chunk_type public.aip_chunk_type,
  add column if not exists ingestion_version smallint,
  add column if not exists document_type text,
  add column if not exists publication_status text,
  add column if not exists fiscal_year integer,
  add column if not exists scope_type text,
  add column if not exists scope_name text,
  add column if not exists office_name text,
  add column if not exists project_ref_code text,
  add column if not exists source_page integer,
  add column if not exists theme_tags text[],
  add column if not exists sector_tags text[];

alter table public.aip_chunks
  alter column chunk_type set default 'legacy_category_group'::public.aip_chunk_type,
  alter column ingestion_version set default 1,
  alter column document_type set default 'AIP',
  alter column publication_status set default 'published',
  alter column theme_tags set default '{}'::text[],
  alter column sector_tags set default '{}'::text[];

update public.aip_chunks c
set
  chunk_type = case
    when lower(coalesce(c.metadata ->> 'chunk_type', '')) = 'project' then 'project'::public.aip_chunk_type
    when lower(coalesce(c.metadata ->> 'chunk_type', '')) = 'section_summary' then 'section_summary'::public.aip_chunk_type
    when lower(coalesce(c.metadata ->> 'chunk_type', '')) = 'category_summary' then 'category_summary'::public.aip_chunk_type
    when lower(coalesce(c.metadata ->> 'chunk_kind', '')) = 'project' then 'project'::public.aip_chunk_type
    when lower(coalesce(c.metadata ->> 'chunk_kind', '')) = 'section_summary' then 'section_summary'::public.aip_chunk_type
    when lower(coalesce(c.metadata ->> 'chunk_kind', '')) = 'category_summary' then 'category_summary'::public.aip_chunk_type
    else 'legacy_category_group'::public.aip_chunk_type
  end,
  ingestion_version = case
    when coalesce(c.metadata ->> 'ingestion_version', '') ~ '^[0-9]+$'
      then greatest(1, (c.metadata ->> 'ingestion_version')::smallint)
    else coalesce(c.ingestion_version, 1)
  end,
  document_type = coalesce(nullif(c.metadata ->> 'document_type', ''), coalesce(c.document_type, 'AIP')),
  publication_status = coalesce(
    nullif(c.metadata ->> 'publication_status', ''),
    a.status::text,
    nullif(c.publication_status, ''),
    'published'
  ),
  fiscal_year = coalesce(
    case when coalesce(c.metadata ->> 'fiscal_year', '') ~ '^[0-9]{4}$'
      then (c.metadata ->> 'fiscal_year')::integer
      else null end,
    c.fiscal_year,
    a.fiscal_year
  ),
  scope_type = coalesce(
    nullif(c.metadata ->> 'scope_type', ''),
    c.scope_type,
    case
      when a.barangay_id is not null then 'barangay'
      when a.city_id is not null then 'city'
      when a.municipality_id is not null then 'municipality'
      else 'unknown'
    end
  ),
  scope_name = coalesce(
    nullif(c.metadata ->> 'scope_name', ''),
    c.scope_name,
    coalesce(b.name, ci.name, m.name, 'Unknown Scope')
  ),
  office_name = coalesce(
    nullif(c.metadata ->> 'office_name', ''),
    nullif(c.metadata ->> 'implementing_agency', ''),
    c.office_name
  ),
  project_ref_code = coalesce(
    nullif(c.metadata ->> 'project_ref_code', ''),
    nullif(c.metadata ->> 'project_ref', ''),
    c.project_ref_code
  ),
  source_page = coalesce(
    case when coalesce(c.metadata ->> 'source_page', '') ~ '^[0-9]+$'
      then (c.metadata ->> 'source_page')::integer
      else null end,
    case when coalesce(c.metadata ->> 'page_no', '') ~ '^[0-9]+$'
      then (c.metadata ->> 'page_no')::integer
      else null end,
    c.source_page
  ),
  theme_tags = coalesce(
    case
      when jsonb_typeof(c.metadata -> 'theme_tags') = 'array' then (
        select array_agg(lower(trim(value)))
        from jsonb_array_elements_text(c.metadata -> 'theme_tags') as value
        where trim(value) <> ''
      )
      else null
    end,
    c.theme_tags,
    '{}'::text[]
  ),
  sector_tags = coalesce(
    case
      when jsonb_typeof(c.metadata -> 'sector_tags') = 'array' then (
        select array_agg(lower(trim(value)))
        from jsonb_array_elements_text(c.metadata -> 'sector_tags') as value
        where trim(value) <> ''
      )
      else null
    end,
    c.sector_tags,
    '{}'::text[]
  )
from public.aips a
left join public.barangays b on b.id = a.barangay_id
left join public.cities ci on ci.id = a.city_id
left join public.municipalities m on m.id = a.municipality_id
where a.id = c.aip_id;

update public.aip_chunks
set
  chunk_type = coalesce(chunk_type, 'legacy_category_group'::public.aip_chunk_type),
  ingestion_version = greatest(1, coalesce(ingestion_version, 1)),
  document_type = coalesce(nullif(document_type, ''), 'AIP'),
  publication_status = coalesce(nullif(publication_status, ''), 'published'),
  theme_tags = coalesce(theme_tags, '{}'::text[]),
  sector_tags = coalesce(sector_tags, '{}'::text[]);

alter table public.aip_chunks
  alter column chunk_type set not null,
  alter column ingestion_version set not null,
  alter column document_type set not null,
  alter column publication_status set not null,
  alter column theme_tags set not null,
  alter column sector_tags set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'aip_chunks_ingestion_version_check'
  ) then
    alter table public.aip_chunks
      add constraint aip_chunks_ingestion_version_check
      check (ingestion_version >= 1);
  end if;
end
$$;

create index if not exists idx_aip_chunks_prefilter_v2
  on public.aip_chunks (chunk_type, publication_status, fiscal_year, scope_type, scope_name);

create index if not exists idx_aip_chunks_doc_office_v2
  on public.aip_chunks (document_type, office_name);

create index if not exists idx_aip_chunks_project_ref_code
  on public.aip_chunks (project_ref_code)
  where project_ref_code is not null;

create index if not exists idx_aip_chunks_theme_tags
  on public.aip_chunks using gin (theme_tags);

create index if not exists idx_aip_chunks_sector_tags
  on public.aip_chunks using gin (sector_tags);

create index if not exists idx_aips_published_fiscal_year
  on public.aips (fiscal_year)
  where status = 'published';

drop function if exists public.match_published_aip_project_chunks_v2(
  extensions.vector,
  integer,
  double precision,
  text,
  uuid,
  jsonb,
  integer,
  text,
  text,
  text,
  text,
  text,
  text[],
  text[],
  boolean
);

create or replace function public.match_published_aip_project_chunks_v2(
  query_embedding extensions.vector,
  match_count integer default 4,
  min_similarity double precision default 0.0,
  scope_mode text default 'global',
  own_barangay_id uuid default null,
  scope_targets jsonb default '[]'::jsonb,
  filter_fiscal_year integer default null,
  filter_scope_type text default null,
  filter_scope_name text default null,
  filter_document_type text default null,
  filter_publication_status text default 'published',
  filter_office_name text default null,
  filter_theme_tags text[] default null,
  filter_sector_tags text[] default null,
  include_summary_chunks boolean default false
) returns table(
  source_id text,
  chunk_id uuid,
  content text,
  similarity double precision,
  aip_id uuid,
  fiscal_year integer,
  published_at timestamp with time zone,
  scope_type text,
  scope_id uuid,
  scope_name text,
  chunk_type text,
  document_type text,
  publication_status text,
  office_name text,
  project_ref_code text,
  source_page integer,
  theme_tags text[],
  sector_tags text[],
  metadata jsonb
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
with params as (
  select
    greatest(1, least(coalesce(match_count, 4), 30)) as k,
    coalesce(min_similarity, 0.0) as sim_floor,
    lower(coalesce(scope_mode, 'global')) as mode,
    filter_fiscal_year as filter_fiscal_year,
    lower(nullif(trim(filter_scope_type), '')) as filter_scope_type,
    lower(nullif(trim(filter_scope_name), '')) as filter_scope_name,
    lower(nullif(trim(filter_document_type), '')) as filter_document_type,
    lower(coalesce(nullif(trim(filter_publication_status), ''), 'published')) as filter_publication_status,
    lower(nullif(trim(filter_office_name), '')) as filter_office_name,
    (
      select array_agg(lower(trim(tag)))
      from unnest(filter_theme_tags) tag
      where trim(tag) <> ''
    ) as filter_theme_tags,
    (
      select array_agg(lower(trim(tag)))
      from unnest(filter_sector_tags) tag
      where trim(tag) <> ''
    ) as filter_sector_tags,
    coalesce(include_summary_chunks, false) as include_summary_chunks
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
    c.chunk_type::text as chunk_type,
    c.document_type,
    c.publication_status,
    c.office_name,
    c.project_ref_code,
    c.source_page,
    c.theme_tags,
    c.sector_tags,
    a.id as aip_id,
    coalesce(c.fiscal_year, a.fiscal_year) as fiscal_year,
    a.published_at,
    coalesce(
      nullif(c.scope_type, ''),
      case
        when a.barangay_id is not null then 'barangay'
        when a.city_id is not null then 'city'
        when a.municipality_id is not null then 'municipality'
        else 'unknown'
      end
    ) as scope_type,
    case
      when a.barangay_id is not null then a.barangay_id
      when a.city_id is not null then a.city_id
      when a.municipality_id is not null then a.municipality_id
      else null
    end as scope_id,
    coalesce(nullif(c.scope_name, ''), b.name, ci.name, m.name, 'Unknown Scope') as scope_name,
    1 - (e.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.aip_chunks c
  join public.aip_chunk_embeddings e on e.chunk_id = c.id
  join public.aips a on a.id = c.aip_id
  left join public.barangays b on b.id = a.barangay_id
  left join public.cities ci on ci.id = a.city_id
  left join public.municipalities m on m.id = a.municipality_id
  cross join params p
  where
    lower(coalesce(a.status::text, nullif(c.publication_status, ''), 'published')) = p.filter_publication_status
    and (
      c.chunk_type = 'project'::public.aip_chunk_type
      or (
        p.include_summary_chunks
        and c.chunk_type in ('section_summary'::public.aip_chunk_type, 'category_summary'::public.aip_chunk_type)
      )
    )
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
    and (
      p.filter_fiscal_year is null
      or coalesce(c.fiscal_year, a.fiscal_year) = p.filter_fiscal_year
    )
    and (
      p.filter_scope_type is null
      or lower(
        coalesce(
          nullif(c.scope_type, ''),
          case
            when a.barangay_id is not null then 'barangay'
            when a.city_id is not null then 'city'
            when a.municipality_id is not null then 'municipality'
            else 'unknown'
          end
        )
      ) = p.filter_scope_type
    )
    and (
      p.filter_scope_name is null
      or lower(coalesce(nullif(c.scope_name, ''), b.name, ci.name, m.name, 'Unknown Scope')) = p.filter_scope_name
    )
    and (
      p.filter_document_type is null
      or lower(coalesce(nullif(c.document_type, ''), 'AIP')) = p.filter_document_type
    )
    and (
      p.filter_office_name is null
      or lower(coalesce(c.office_name, '')) = p.filter_office_name
    )
    and (
      p.filter_theme_tags is null
      or cardinality(p.filter_theme_tags) = 0
      or coalesce(c.theme_tags, '{}'::text[]) && p.filter_theme_tags
    )
    and (
      p.filter_sector_tags is null
      or cardinality(p.filter_sector_tags) = 0
      or coalesce(c.sector_tags, '{}'::text[]) && p.filter_sector_tags
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
  chunk_type,
  document_type,
  publication_status,
  office_name,
  project_ref_code,
  source_page,
  theme_tags,
  sector_tags,
  metadata
from ranked;
$$;

alter function public.match_published_aip_project_chunks_v2(
  extensions.vector,
  integer,
  double precision,
  text,
  uuid,
  jsonb,
  integer,
  text,
  text,
  text,
  text,
  text,
  text[],
  text[],
  boolean
) owner to postgres;

revoke all on function public.match_published_aip_project_chunks_v2(
  extensions.vector,
  integer,
  double precision,
  text,
  uuid,
  jsonb,
  integer,
  text,
  text,
  text,
  text,
  text,
  text[],
  text[],
  boolean
) from public;

grant execute on function public.match_published_aip_project_chunks_v2(
  extensions.vector,
  integer,
  double precision,
  text,
  uuid,
  jsonb,
  integer,
  text,
  text,
  text,
  text,
  text,
  text[],
  text[],
  boolean
) to anon, authenticated, service_role;
