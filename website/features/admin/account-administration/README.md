# Account Administration (Admin)

This module now supports DBV2-backed account lifecycle management for `profiles`:

- List/search/filter/paginate officials and citizens
- Create official accounts (Supabase email invite)
- Edit `full_name`, `role`, and LGU assignment
- Activate / deactivate (with auth ban / unban)
- Delete account (hard delete user + profile)
- Send reset password email
- Resend invite (blocked for deactivated accounts)

## Required environment variables

Set these in `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BASE_URL`
- `NEXT_PUBLIC_APP_ENV=local|staging|prod` (required; missing/invalid values throw)
- `NEXT_PUBLIC_USE_MOCKS=false` to use Supabase adapters

## DB migration

Apply:

- `website/docs/sql/2026-02-13_account_admin_hardening.sql`

This adds DB-level guardrails preventing deletion/deactivation/demotion of the last active admin.
