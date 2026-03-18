# Citizen Dashboard Performance (Phases 1–3)

## Scope

This document covers the public Citizen Dashboard paths:

- `/` (landing dashboard)
- `/budget-allocation`

The goal is to keep first paint focused on summary/aggregated data and avoid loading full project datasets.

## What Changed

### Phase 1: Profiling and Query Shaping

- Added shared timing helper: `website/lib/server/perf/timing.ts`.
- Added timing labels across public dashboard fetch paths, including:
  - `landing-content.available-fiscal-years`
  - `landing-content.citizen-count`
  - `landing-content.current-metrics`
  - `landing-content.previous-metrics`
  - `landing-content.marker-budgets`
  - `landing-content.feedback-metrics`
  - `budget-allocation.filters`
  - `budget-allocation.summary`
  - `budget-allocation.projects-page`
  - `budget-allocation.initial-payload`
- Timing logs are gated by dev mode or `CITIZEN_DASHBOARD_DEBUG_LOGS=true`.
- Budget projects endpoint now resolves a single published AIP first, then paginates by `aip_id` and explicit column projection.
- Initial budget allocation render now uses first-page project rows only.

### Phase 2: Summary-Oriented Data Flow

- Added summary rollup view migration:
  - `public.v_citizen_dashboard_published_rollups`
- Landing and budget summary paths now prefer rollup view data for KPI/chart totals.
- Landing highlights now fetch top project cards per category (`health`, `infrastructure`) instead of scanning all projects for first paint.
- Fallback paths remain in place to preserve behavior if rollup view is unavailable during rollout.

### Phase 3: Next.js Caching and Revalidation

- Added shared cache tags/constants in `website/lib/cache/citizen-dashboard.ts`.
- Public landing data now uses `unstable_cache` via:
  - `website/lib/repos/landing-content/public-cache.server.ts`
- Budget allocation filters/summary/projects now use `unstable_cache` in:
  - `website/lib/repos/citizen-budget-allocation/repo.server.ts`
- Publish flow now triggers targeted invalidation via `revalidateTag(...)`:
  - `landingContent`
  - `budgetFilters`
  - `budgetSummary`
  - `budgetProjects`

## Cache Boundaries

Only public citizen data is cached with shared tags/TTL:

- Summary cards, chart rollups, and filters metadata
- Public project list pages for budget allocation queries

Privileged/admin datasets are not part of these public cache tags.

## Freshness and Revalidation

- Summary/filter/landing cache TTL: `300s`
- Project page cache TTL: `120s`
- Publish action invalidates affected citizen dashboard tags immediately.

## Query-Plan Review Notes

Use these command shapes against production-like data to inspect planner behavior.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT aip_id, fiscal_year, scope_type, scope_id, total_budget, project_count,
       sector_1000_total, sector_3000_total, sector_8000_total, sector_9000_total
FROM public.v_citizen_dashboard_published_rollups
WHERE scope_type = 'city'
  AND scope_id = '<scope_uuid>'
  AND is_latest_scope_year = true
ORDER BY fiscal_year DESC
LIMIT 5;
```

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, aip_ref_code, program_project_description, source_of_funds, total, sector_code
FROM public.projects
WHERE aip_id = '<aip_uuid>'
ORDER BY total DESC NULLS LAST, aip_ref_code ASC
LIMIT 10 OFFSET 0;
```

## Indexes Added

Migration: `supabase/migrations/20260318_citizen_dashboard_rollups_and_indexes.sql`

- Published scope/year recency indexes on `aips` (city + barangay partial indexes)
- Project ordering indexes for top-card and paginated list patterns
- Partial active-citizen profile index for scope KPI count path

## Local Verification Checklist

1. Run app in dev and set `CITIZEN_DASHBOARD_DEBUG_LOGS=true`.
2. Load `/` and confirm perf labels log in server console.
3. Load `/budget-allocation` and confirm first paint renders without initial client waterfall delay.
4. Change year/LGU and confirm filters/summary/projects still update correctly.
5. Publish an AIP and confirm citizen dashboard data refreshes on next request.

## Production Verification Checklist

1. Hit `/` and `/budget-allocation` twice for same query params and compare TTFB.
2. Confirm response headers include public cache directives on citizen API routes.
3. Publish an AIP and verify cache invalidation refreshes landing + budget summaries.
