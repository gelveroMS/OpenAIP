# Account Feature Guide

## A. Purpose
Provide authenticated LGU users with:
- read-only account/profile details, and
- password update capability.

## B. UI Surfaces
Routes:
- `app/(lgu)/barangay/(authenticated)/account/page.tsx`
- `app/(lgu)/city/(authenticated)/account/page.tsx`

Feature files:
- `features/account/account-view.tsx`
- `features/account/update-password-form.tsx`

## C. Data Flow
`app/(lgu)/.../account/page.tsx`
-> `getUser()` from `lib/actions/auth.actions`
-> `features/account/account-view.tsx`
-> `features/account/update-password-form.tsx`
-> `POST /auth/update-password`

## D. databasev2 Alignment
Relevant DBV2 objects:
- `public.profiles`
- `public.role_type`

Constraints that matter to this feature:
- Roles are limited to `citizen`, `barangay_official`, `city_official`, `municipal_official`, `admin`.
- Scope binding is enforced by `chk_profiles_scope_binding`.

Enforcement boundaries:
- Profile data should ultimately be read from `public.profiles` under RLS.
- Password updates remain in Supabase Auth, but are now enforced via server route:
  - `POST /auth/update-password` (policy validation + session cookie refresh).

## E. Current Implementation
- Account pages currently map data from `getUser()`.
- There is no feature-local `ProfilesRepo` yet.

## F. Future Extraction (Optional)
If this feature moves fully to DB-backed profile reads:
1. Add `features/account/data/profiles.repo.ts`.
2. Add `features/account/data/profiles.repo.supabase.ts`.
3. Keep password updates in auth-layer APIs.

## G. Testing Checklist
Manual:
- Verify both barangay and city account pages render profile fields.
- Verify password update flow succeeds and redirects correctly.

Automated:
- Add component tests if domain logic is introduced in this feature.

## H. Pitfalls
- Do not mix UI route role labels with DB role values; keep mapping centralized.
- Do not model password state in `public.profiles`.
