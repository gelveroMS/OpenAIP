begin;

create or replace view public.v_citizen_dashboard_published_rollups
with (security_invoker = true, security_barrier = true)
as
with scoped_aips as (
  select
    a.id as aip_id,
    a.fiscal_year,
    a.published_at,
    a.updated_at,
    a.created_at,
    case
      when a.city_id is not null then 'city'
      when a.barangay_id is not null then 'barangay'
      when a.municipality_id is not null then 'municipality'
      else 'unknown'
    end as scope_type,
    coalesce(a.city_id, a.barangay_id, a.municipality_id) as scope_id,
    coalesce(c.name, b.name, m.name, 'Unknown Scope') as scope_name,
    row_number() over (
      partition by
        case
          when a.city_id is not null then 'city'
          when a.barangay_id is not null then 'barangay'
          when a.municipality_id is not null then 'municipality'
          else 'unknown'
        end,
        coalesce(a.city_id, a.barangay_id, a.municipality_id),
        a.fiscal_year
      order by a.published_at desc nulls last, a.updated_at desc, a.id desc
    ) as scope_year_rank
  from public.aips a
  left join public.cities c on c.id = a.city_id
  left join public.barangays b on b.id = a.barangay_id
  left join public.municipalities m on m.id = a.municipality_id
  where a.status = 'published'
    and (
      a.city_id is not null
      or a.barangay_id is not null
      or a.municipality_id is not null
    )
),
project_rollups as (
  select
    p.aip_id,
    count(*)::int as project_count,
    coalesce(sum(coalesce(p.total, 0)), 0)::numeric as project_total_budget,
    coalesce(sum(case when p.sector_code like '1000%' then coalesce(p.total, 0) else 0 end), 0)::numeric as sector_1000_total,
    coalesce(sum(case when p.sector_code like '3000%' then coalesce(p.total, 0) else 0 end), 0)::numeric as sector_3000_total,
    coalesce(sum(case when p.sector_code like '8000%' then coalesce(p.total, 0) else 0 end), 0)::numeric as sector_8000_total,
    coalesce(sum(case when p.sector_code is null or (p.sector_code not like '1000%' and p.sector_code not like '3000%' and p.sector_code not like '8000%') then coalesce(p.total, 0) else 0 end), 0)::numeric as sector_9000_total,
    count(*) filter (where p.category = 'health')::int as health_project_count,
    coalesce(sum(case when p.category = 'health' then coalesce(p.total, 0) else 0 end), 0)::numeric as health_project_total,
    count(*) filter (where p.category = 'infrastructure')::int as infrastructure_project_count,
    coalesce(sum(case when p.category = 'infrastructure' then coalesce(p.total, 0) else 0 end), 0)::numeric as infrastructure_project_total
  from public.projects p
  group by p.aip_id
),
aip_file_totals as (
  select
    at.aip_id,
    max(at.total_investment_program)::numeric as file_total_investment_program
  from public.aip_totals at
  where at.source_label = 'total_investment_program'
  group by at.aip_id
)
select
  s.aip_id,
  s.fiscal_year,
  s.scope_type,
  s.scope_id,
  s.scope_name,
  s.published_at,
  s.updated_at,
  s.created_at,
  (s.scope_year_rank = 1) as is_latest_scope_year,
  coalesce(pr.project_count, 0)::int as project_count,
  coalesce(pr.health_project_count, 0)::int as health_project_count,
  coalesce(pr.infrastructure_project_count, 0)::int as infrastructure_project_count,
  coalesce(pr.project_total_budget, 0)::numeric as project_total_budget,
  coalesce(pr.health_project_total, 0)::numeric as health_project_total,
  coalesce(pr.infrastructure_project_total, 0)::numeric as infrastructure_project_total,
  coalesce(pr.sector_1000_total, 0)::numeric as sector_1000_total,
  coalesce(pr.sector_3000_total, 0)::numeric as sector_3000_total,
  coalesce(pr.sector_8000_total, 0)::numeric as sector_8000_total,
  coalesce(pr.sector_9000_total, 0)::numeric as sector_9000_total,
  case
    when aft.file_total_investment_program is not null
      and aft.file_total_investment_program > 0
      and coalesce(pr.project_total_budget, 0) > aft.file_total_investment_program
      then coalesce(pr.project_total_budget, 0)::numeric
    else coalesce(aft.file_total_investment_program, pr.project_total_budget, 0)::numeric
  end as total_budget
from scoped_aips s
left join project_rollups pr on pr.aip_id = s.aip_id
left join aip_file_totals aft on aft.aip_id = s.aip_id;

grant select on public.v_citizen_dashboard_published_rollups to anon, authenticated, service_role;

-- Supports citizen published-scope + fiscal year lookups ordered by latest publication metadata.
create index if not exists idx_aips_published_city_fiscal_pub_updated
  on public.aips (city_id, fiscal_year desc, published_at desc, updated_at desc, id desc)
  where status = 'published' and city_id is not null;

-- Supports citizen published barangay scope lookups and fallback resolution by fiscal year recency.
create index if not exists idx_aips_published_barangay_fiscal_pub_updated
  on public.aips (barangay_id, fiscal_year desc, published_at desc, updated_at desc, id desc)
  where status = 'published' and barangay_id is not null;

-- Supports top-N project cards by category for a single AIP without scanning all project rows.
create index if not exists idx_projects_aip_category_total_id
  on public.projects (aip_id, category, total desc, id);

-- Supports paginated project list sorting and ref-code tie breaking for citizen budget allocation.
create index if not exists idx_projects_aip_total_ref_id
  on public.projects (aip_id, total desc, aip_ref_code, id);

-- Supports active citizen counts by barangay for public scope engagement KPIs.
create index if not exists idx_profiles_active_citizen_barangay
  on public.profiles (barangay_id)
  where role = 'citizen' and is_active = true and barangay_id is not null;

commit;
