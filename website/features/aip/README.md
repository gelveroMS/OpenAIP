# AIP Feature Guide

## A. Purpose
Manage Annual Investment Plans (AIPs):
- list AIPs by scope (barangay/city),
- view AIP detail (PDF, extracted rows, and feedback),
- upload/replace source PDF,
- monitor extraction runs and retry failed runs,
- support status transitions used by submissions/review workflows.

## B. UI Surfaces
Routes:
- `app/(lgu)/barangay/(authenticated)/aips/page.tsx`
- `app/(lgu)/barangay/(authenticated)/aips/[aipId]/page.tsx`
- `app/(lgu)/city/(authenticated)/aips/page.tsx`
- `app/(lgu)/city/(authenticated)/aips/[aipId]/page.tsx`

Key feature files:
- `features/aip/views/aip-management-view.tsx`
- `features/aip/views/aip-detail-view.tsx`
- `features/aip/views/aip-details-table.tsx`
- `features/aip/dialogs/upload-aip-dialog.tsx`
- `features/aip/hooks/use-extraction-runs-realtime.ts`
- `features/aip/actions/aip-workflow.actions.ts`

Related API routes:
- `app/api/barangay/aips/upload/route.ts`
- `app/api/city/aips/upload/route.ts`
- `app/api/barangay/aips/runs/[runId]/route.ts`
- `app/api/city/aips/runs/[runId]/route.ts`
- `app/api/barangay/aips/[aipId]/embed/retry/route.ts`
- `app/api/city/aips/[aipId]/embed/retry/route.ts`

## C. Data Flow
Page/server actions
-> `getAipRepo()` / `getAipProjectRepo()` from `lib/repos/aip/repo.server.ts`
-> repo selector (`lib/repos/_shared/selector.ts`)
-> adapter:
  - mock: `lib/repos/aip/repo.mock.ts`
  - supabase: `lib/repos/aip/repo.supabase.ts`

Mode selection is controlled by:
- `NEXT_PUBLIC_APP_ENV`
- `NEXT_PUBLIC_USE_MOCKS`

## D. databasev2 Alignment
Primary DBV2 tables:
- `public.aips`
- `public.uploaded_files`
- `public.extraction_runs`
- `public.extraction_artifacts`
- `public.projects`
- `public.aip_reviews`

Primary enums/helpers:
- `public.aip_status` (`draft`, `pending_review`, `under_review`, `for_revision`, `published`)
- `public.can_read_aip(aip_id)`
- `public.can_edit_aip(aip_id)`
- `public.can_upload_aip_pdf(aip_id)`

Important constraints:
- Exactly one scope per AIP (`chk_aips_exactly_one_scope`).
- Draft visibility is restricted to scope owner/admin.
- Uploads are gated by role, scope, and status.

## E. Current Implementation Status
- Mock and Supabase adapters are both implemented for `AipRepo` and `AipProjectRepo`.
- `NEXT_PUBLIC_APP_ENV` must be `local`, `staging`, or `prod` (missing/invalid values throw).
- In local mode, mock data can be forced with `NEXT_PUBLIC_USE_MOCKS=true`.
- In non-mock mode, pages use Supabase-backed repositories.
- Upload and extraction monitoring paths are active in current code.

## F. Testing Checklist
Manual:
- Verify list/detail pages for both barangay and city routes.
- Upload a PDF and confirm extraction status updates appear.
- Verify retry actions and embed retry endpoints are reachable for authorized users.
- Verify draft AIPs are not leaked in public visibility paths.

Automated:
- `features/aip/**/*.test.ts(x)`
- `features/aip/actions/aip-workflow.actions.test.ts`
- `features/aip/hooks/use-extraction-runs-realtime.test.ts`

## G. Pitfalls
- Keep lifecycle and scope checks in sync with DB/RLS behavior.
- Do not bypass upload gating (`can_upload_aip_pdf`) in server routes.
- Avoid introducing alternative project row sources outside `public.projects` + detail tables.
