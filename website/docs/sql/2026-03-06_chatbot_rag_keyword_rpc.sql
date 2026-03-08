-- -----------------------------------------------------------------------------
-- Phase 2: keyword retrieval RPC for published AIP chunks
-- -----------------------------------------------------------------------------

create index if not exists idx_aip_chunks_textsearch_simple
  on public.aip_chunks
  using gin (to_tsvector('simple', coalesce(chunk_text, '')));

drop function if exists public.match_published_aip_chunks_keyword(
  text,
  int,
  double precision,
  text,
  uuid,
  jsonb
);

create or replace function public.match_published_aip_chunks_keyword(
  query_text text,
  match_count int default 20,
  min_rank double precision default 0.0,
  scope_mode text default 'global',
  own_barangay_id uuid default null,
  scope_targets jsonb default '[]'::jsonb
)
returns table (
  source_id text,
  chunk_id uuid,
  content text,
  similarity double precision,
  keyword_score double precision,
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
    greatest(1, least(coalesce(match_count, 20), 60)) as k,
    greatest(0.0, coalesce(min_rank, 0.0)) as rank_floor,
    lower(coalesce(scope_mode, 'global')) as mode
),
targets as (
  select
    lower(nullif(item ->> 'scope_type', '')) as scope_type,
    nullif(item ->> 'scope_id', '')::uuid as scope_id
  from jsonb_array_elements(coalesce(scope_targets, '[]'::jsonb)) item
  where nullif(item ->> 'scope_id', '') is not null
),
query as (
  select
    case
      when length(trim(coalesce(query_text, ''))) = 0 then null::tsquery
      else websearch_to_tsquery('simple', query_text)
    end as q
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
    coalesce(b.name, ci.name, m.name, 'Unknown Scope') as scope_name
  from public.aip_chunks c
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
  select
    rs.*,
    ts_rank_cd(
      to_tsvector('simple', coalesce(rs.content, '')),
      q.q
    )::double precision as keyword_score
  from rows_scoped rs
  cross join query q
  where q.q is not null
    and to_tsvector('simple', coalesce(rs.content, '')) @@ q.q
),
filtered as (
  select *
  from ranked
  where keyword_score >= (select rank_floor from params)
  order by keyword_score desc, chunk_id
  limit (select k from params)
)
select
  'S' || row_number() over (order by keyword_score desc, chunk_id) as source_id,
  chunk_id,
  content,
  keyword_score as similarity,
  keyword_score,
  aip_id,
  fiscal_year,
  published_at,
  scope_type,
  scope_id,
  scope_name,
  metadata
from filtered;
$$;

revoke all on function public.match_published_aip_chunks_keyword(
  text,
  int,
  double precision,
  text,
  uuid,
  jsonb
) from public;

revoke all on function public.match_published_aip_chunks_keyword(
  text,
  int,
  double precision,
  text,
  uuid,
  jsonb
) from anon;

revoke all on function public.match_published_aip_chunks_keyword(
  text,
  int,
  double precision,
  text,
  uuid,
  jsonb
) from authenticated;

grant execute on function public.match_published_aip_chunks_keyword(
  text,
  int,
  double precision,
  text,
  uuid,
  jsonb
) to service_role;
