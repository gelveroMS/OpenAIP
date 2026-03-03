# OpenAIP Website

Next.js 16 web app for citizen, barangay, city, and admin portals.

For full monorepo setup (pipeline, database, and deployment), use the root guide:
- `../README.md`

## Quickstart

1. Install dependencies:
```bash
npm install
```

2. Create local env file:
```powershell
Copy-Item .env.local.example .env.local
```

3. Start dev server:
```bash
npm run dev
```

4. Open `http://localhost:3000`.

## Environment Flags

- `NEXT_PUBLIC_APP_ENV`
  - Allowed: `dev`, `staging`, `prod`
  - Default: `dev`
- `NEXT_PUBLIC_USE_MOCKS`
  - `true` forces mock repositories
  - If unset, mock mode is enabled when `NEXT_PUBLIC_APP_ENV=dev`
- `NEXT_PUBLIC_SITE_URL`
  - Canonical site origin used by CSRF Origin/Referer checks for state-changing API routes
  - Example: `https://openaip.example.gov`
- `NEXT_PUBLIC_STAGING_URL`
  - Optional staging origin allowed by CSRF Origin/Referer checks
  - Leave blank when no staging domain is deployed
- `AIP_UPLOAD_MAX_BYTES`
  - Default: `15728640` (15MB)
  - Max upload size for barangay/city AIP PDF upload routes
- `AIP_UPLOAD_FAILURE_THRESHOLD`
  - Default: `5`
  - Number of recent failed extraction runs before uploader cooldown applies
- `AIP_UPLOAD_FAILURE_WINDOW_MINUTES`
  - Default: `60`
  - Lookback window used to count failed runs for upload throttling
- `AIP_UPLOAD_FAILURE_COOLDOWN_MINUTES`
  - Default: `15`
  - Cooldown period returned as HTTP `429` + `Retry-After` after repeated failures

Repository selection is centralized in:
- `lib/config/appEnv.ts`
- `lib/repos/_shared/selector.ts`

## Dashboard Backend Notes

- Dashboard backend uses repo-domain architecture at `lib/repos/dashboard/*`.
- Reads are server-side and scope-filtered (`barangay` / `city`) using existing tables (`aips`, `projects`, `feedback`, `extraction_runs`, `aip_reviews`, `uploaded_files`, `profiles`).
- Dashboard AIP rows include uploader metadata from the latest `uploaded_files.is_current` record plus uploader `profiles.full_name`.
- Barangay write actions are strict:
  - draft create validates FY (`2000..2100`), enforces barangay scope, and is idempotent on duplicate FY
  - feedback reply validates body/length and parent eligibility, and routes reply creation through feedback threads repo for invariant + audit preservation
- Dashboard mock mode does not use a dashboard-only toggle; it follows global flags only (`NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_USE_MOCKS`).

## Notifications

UI routes:
- Citizen: `app/(citizen)/notifications/page.tsx`
- Barangay: `app/(lgu)/barangay/(authenticated)/notifications/page.tsx`
- City: `app/(lgu)/city/(authenticated)/notifications/page.tsx`
- Admin: `app/admin/(authenticated)/notifications/page.tsx`

API routes:
- `GET /api/notifications`
- `GET /api/notifications/unread-count`
- `PATCH /api/notifications/[notificationId]/read`
- `POST /api/notifications/read-all`
- `GET /api/notifications/open?next=...&notificationId=...|dedupe=...`

Primary components:
- `features/notifications/components/notifications-bell.tsx`
- `features/notifications/components/notifications-inbox.tsx`
- `features/notifications/realtime-listener.tsx`

## Quality Checks

```bash
npm run lint
npm run test:ui
npx tsc --noEmit
node scripts/repo-smoke/run.js
```

## Admin Auth Regression Checklist

1. Fresh admin sign-up/confirm (if applicable in your environment):
   - Complete staff/admin sign-up and confirmation flow.
   - Navigate to `/admin` and confirm dashboard data is visible immediately without manual refresh.
2. Fresh admin sign-in:
   - Sign in at `/admin/sign-in`.
   - Confirm `/admin` dashboard data is visible immediately on first load without manual refresh.
3. First client-side nav to dashboard:
   - From any authenticated admin page, click `Dashboard` in the admin sidebar.
   - Confirm dashboard data appears on first render without manual refresh.
4. Role guard:
   - Sign in as non-admin and request `/admin`.
   - Confirm redirect to the unauthorized page.
5. Refresh parity:
   - Hard refresh `/admin` and confirm values remain consistent with first-load values.
6. Console/runtime:
   - Confirm no new client or server errors during the above scenarios.
7. Session heartbeat scope:
   - Visit a public route (for example `/`) while signed out.
   - Confirm the server log is not spammed with repeated `POST /auth/session/activity`.
   - Visit `/admin` while signed in and confirm heartbeat calls resume.
8. Admin sign-up policy:
   - Request `/admin/sign-up`.
   - Confirm redirect to `/admin/sign-in`.

## Notes

- Database schema and SQL patches are in `docs/sql`.
- Canonical schema file is `docs/sql/database-v2.sql`.
- The mirrored copy `docs/databasev2.txt` is kept synchronized with the canonical SQL file.
- Notifications/outbox baseline depends on March 3 SQL patches:
  - `docs/sql/2026-03-03_notifications_outbox_tables_rls.sql`
  - `docs/sql/2026-03-03_notifications_admin_pipeline_outbox_alerts.sql`
- Citizen landing/about-us seeded app settings depend on:
  - `docs/sql/2026-03-01_citizen_about_us_content_settings.sql`
  - `docs/sql/2026-03-01_citizen_dashboard_content_settings.sql`
