# Projects Feature

## Overview
The Projects feature renders health and infrastructure project lists/details and project update timelines.

## Data Boundaries
Projects are modeled in the Projects repo layer (`lib/repos/projects/*`) and are not sourced from AIP feature-local fixtures.

Use:
- `lib/repos/projects/repo.server.ts`
- `lib/repos/projects/queries.ts`
- `mocks/fixtures/projects/*` for mock data mode

## Architecture
```text
Page/View
  -> projectService (lib/repos/projects/queries.ts)
  -> getProjectsRepo() (lib/repos/projects/repo.server.ts)
  -> selector (mock or supabase)
  -> adapter implementation
```

## Current Adapter Status
- Mock adapter: implemented (`lib/repos/projects/repo.mock.ts`).
- Supabase adapter: deferred (`lib/repos/projects/repo.supabase.ts` currently throws `NotImplementedError`).

In practice:
- `NEXT_PUBLIC_APP_ENV=local` (or `NEXT_PUBLIC_USE_MOCKS=true`) keeps this feature on mock data.

## Usage
Example:
```ts
import { projectService } from "@/lib/repos/projects/queries";

const healthProjects = await projectService.getHealthProjects();
const project = await projectService.getHealthProjectById("PROJ-H-2026-001");
```

## Pages
Barangay:
- `app/(lgu)/barangay/(authenticated)/projects/health/page.tsx`
- `app/(lgu)/barangay/(authenticated)/projects/infrastructure/page.tsx`

City:
- `app/(lgu)/city/(authenticated)/projects/health/page.tsx`
- `app/(lgu)/city/(authenticated)/projects/infrastructure/page.tsx`

## Notes
- Mock fixtures are deterministic and live in `mocks/fixtures/projects/*`.
- Monetary values are stored as numbers and formatted in UI.
- Canonical project repository types are in `lib/repos/projects/repo.ts`.
