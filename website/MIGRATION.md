# Lib + Repo Migration Guide

This repo uses a strict boundary:

- `lib/` is **UI-agnostic** application core + infrastructure (no imports from `app/**`, `features/**`, or `ui/**`).
- UI helpers live outside `lib/` (see `ui/` and feature-local `features/**/utils/**`).
- Mocks/fixtures are not part of `lib/` (see `mocks/fixtures/**`).

## New `lib/` layout (high level)

- `lib/core/` â€” shared errors/utilities used across layers
- `lib/config/` â€” env parsing and runtime flags
- `lib/contracts/databasev2/` â€” DBV2 canonical types (enums + row shapes)
- `lib/domain/` â€” domain helpers (UI-agnostic)
- `lib/formatting/` â€” UI-agnostic formatting helpers (dates/numbers/currency)
- `lib/repos/` â€” repo contracts + adapters + server-only queries
- `lib/supabase/` â€” Supabase clients (SSR cookie pattern via `@supabase/ssr`)

## Mock vs Supabase selection

Selection is centralized in `lib/repos/_shared/selector.ts` and ultimately depends on `lib/config/appEnv.ts`.

Rules:

- `NEXT_PUBLIC_APP_ENV` is required and must be one of `"local"`, `"staging"`, or `"prod"`.
- `NEXT_PUBLIC_USE_MOCKS="true"` forces mock repositories at selector level.
- Security-sensitive bypasses are server-only and local-only (`DEV_BYPASS_ENABLED` + per-feature flags).
- Missing/invalid `NEXT_PUBLIC_APP_ENV` throws a config error (fail closed).

## Repo entrypoints (`repo.ts` vs `repo.server.ts`)

Every repo domain follows the same pattern:

- `lib/repos/<domain>/repo.ts`
  - exports the repo interface(s) and any public surface types
  - exports `getXRepo()` **client-safe selector**:
    - returns mock repo when mocks are enabled
    - otherwise throws a clear error telling you to import `repo.server.ts`
- `lib/repos/<domain>/repo.server.ts`
  - `import "server-only"`
  - exports the same `getXRepo()` name
  - returns mock repo when mocks are enabled; otherwise selects the Supabase adapter
- `lib/repos/<domain>/repo.mock.ts`
  - mock adapter implementation (must preserve current UI flows)
  - reads fixtures from `mocks/fixtures/**` (fixtures are pure data; no repo imports)
- `lib/repos/<domain>/repo.supabase.ts`
  - `import "server-only"`
  - Supabase adapter (may be stubbed, but must reference **only DBV2 tables/columns**)

Optional supporting files (server-side only unless otherwise stated):

- `types.ts` â€” repo surface types used in method signatures
- `db.types.ts` â€” DBV2 snake_case row types (types-only), usually re-exported from `lib/contracts/databasev2`
- `mappers.ts` â€” pure mapping functions (`db.types.ts` â†’ `types.ts`)
- `queries.ts` â€” server-only orchestration/services (`import "server-only"`)

## Supabase access rules

- Server-side modules (repo server entrypoints, queries, Supabase adapters) must be marked server-only via `import "server-only"`.
- Use cookie-based SSR clients from `lib/supabase/server.ts` (built on `@supabase/ssr`).
- Do not expose service-role keys to the client.

## Fixtures

Fixtures moved from `lib/fixtures/**` to `mocks/fixtures/**`.

Rules:

- Fixtures are pure data and may reference other fixtures.
- Fixtures must not import `lib/repos/**` (to avoid circular dependencies and UI coupling).

## Adding a new repo domain (checklist)

1. Create folder `lib/repos/<domain>/`.
2. Add `types.ts` for public surface types.
3. Add `repo.ts`:
   - define `XRepo` interface(s)
   - export `getXRepo()` client-safe selector (mock or throw)
4. Add `repo.server.ts`:
   - `import "server-only"`
   - export `getXRepo()` server selector (mock or supabase)
5. Add `repo.mock.ts` (use `mocks/fixtures/**` if needed).
6. Add `repo.supabase.ts`:
   - `import "server-only"`
   - implement using DBV2 schema from `lib/contracts/databasev2`
7. If mapping is non-trivial, add `db.types.ts` + `mappers.ts`.
8. If you need server orchestration, add `queries.ts` (`import "server-only"`).

## Dashboard Backend Migration (2026-02-27)

Barangay/city dashboard backend access is now migrated to the standard repo domain:

- Removed legacy file: `lib/repo/dashboard-repo.ts`
- Added new domain:
  - `lib/repos/dashboard/types.ts`
  - `lib/repos/dashboard/mappers.ts`
  - `lib/repos/dashboard/repo.ts`
  - `lib/repos/dashboard/repo.server.ts`
  - `lib/repos/dashboard/repo.mock.ts`
  - `lib/repos/dashboard/repo.supabase.ts`
- Dashboard hooks/actions now resolve repositories from `@/lib/repos/dashboard/repo.server`.
- Dashboard mock behavior now follows global selector policy (`NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_USE_MOCKS`).
- Dashboard AIP rows now include uploader metadata from latest `uploaded_files.is_current` joined to `profiles.full_name`.
- Barangay write actions are hardened:
  - draft create validates fiscal year, enforces barangay scope, supports idempotent create
  - reply flow validates body/parent constraints and delegates reply creation to feedback threads repo to preserve audit behavior


