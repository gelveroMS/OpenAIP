# Citizen Auth Flow (Email + OTP + Mandatory Profile Completion)

## Scope
- Citizen authentication uses Supabase Auth with SSR cookie-aware route handlers.
- Sign in and sign up use email + password.
- Email verification uses OTP code entry in the modal (6 digits).
- New users complete profile only after OTP verification.
- Users are redirected to a safe `returnTo` path after auth/profile completion.

## Supabase Dashboard Prerequisites
- Enable **Confirm email** for email/password signups.
- Configure the confirmation email template to include the OTP token placeholder so users can enter the code in-app.
- Configure **Site URL** and **Redirect URLs** for:
  - Local domain (example: `http://localhost:3000`)
  - Production domain (your deployed URL)
- Follow Supabase email template and OTP guidance so confirmation emails contain OTP-capable data.

## Runtime Endpoints
- `POST /auth/sign-up`
- `POST /auth/sign-in`
- `POST /auth/staff-sign-in`
- `POST /auth/verify-otp`
- `POST /auth/resend-otp`
- `POST /auth/sign-out`
- `POST /auth/update-password`
- `POST /auth/session/activity`
- `GET /api/system/security-policy`
- `GET /api/system/banner`
- `GET /profile/status`
- `GET /profile/me`
- `POST /profile/complete`

All new endpoints return:
- Success: `{ ok: true, ... }`
- Failure: `{ ok: false, error: { message } }`

## Security Hardening
- Password policy is enforced server-side in `POST /auth/sign-up` and `POST /auth/update-password`.
- Citizen and staff sign-in flows enforce global login-attempt lockout by normalized email.
- Lockout responses return HTTP `429`.
- Successful sign-in clears accumulated failures for that email.
- Staff sign-in uses `POST /auth/staff-sign-in` for `admin`, `city`, and `barangay`.
- Session inactivity policy is enforced with:
  - `oa_session_timeout_ms`
  - `oa_session_warning_ms`
  - `oa_last_activity_at`
- `POST /auth/session/activity` refreshes inactivity cookies and returns policy timing for the warning modal.
- Middleware expires idle sessions, signs users out, returns `401` JSON for `/api/*`, and redirects protected pages to role sign-in routes.

## Profile Completion Rules
- Profile is complete only when:
  - Profile row exists
  - `role = citizen`
  - `full_name` is non-empty
  - `barangay_id` is non-null
- Profile completion form requires all fields:
  - full name
  - barangay
  - city
  - province
- Server validates barangay/city/province consistency against existing geo tables before insert/update.
- Existing citizen users can edit and re-save their own profile scope through account settings.
- Citizen profile scope remains barangay-bound in `profiles` (`city_id` and `municipality_id` stay null for citizen rows); city/province are inferred from geo relations.

## Protected Behavior
- `/ai-assistant`:
  - unauthenticated users are redirected to same path with auth modal trigger query
  - authenticated but incomplete users are redirected to same path with `completeProfile=1`
  - assistant usage is blocked until profile is complete
- Feedback:
  - viewing remains public
  - submitting feedback/replies requires authenticated + complete citizen profile
  - server enforces this in feedback POST handlers

## Citizen Nav Account State
- Signed-out users see `Sign In` in the top nav.
- After successful sign in/sign up + profile completion, top nav switches to:
  - citizen full name
  - citizen barangay
  - account icon trigger
- Account icon opens a citizen account modal that supports:
  - read-only profile view (full name, email, province, city, barangay)
  - edit/save toggle (email stays read-only)
  - save enabled only when actual profile changes exist
  - logout (session ends and nav returns to `Sign In` on the same page)

## Return-To Safety
- `returnTo` is captured as relative path and persisted in session storage key `openAip:returnTo`.
- Redirect only allows safe relative paths:
  - must start with `/`
  - must not start with `//`
  - must not include protocol prefix
- Fallback:
  - browser back when available
  - otherwise `/`

## Manual Test Checklist
1. New user flow:
   - Open a project feedback page.
   - Click submit/add feedback.
   - Sign up with email + password.
   - Enter OTP code from email.
   - Complete profile (all required fields).
   - Confirm user returns to same feedback page and can submit.
2. Existing user with complete profile:
   - Open `/ai-assistant`.
   - Sign in when prompted.
   - Confirm redirect back and assistant is usable.
3. Existing user with incomplete profile:
   - Sign in.
   - Confirm profile completion is mandatory before redirect/use.
4. Public browsing:
   - Confirm projects and feedback lists are visible without login.
5. OTP errors:
   - Enter wrong code and expired code.
   - Confirm clear errors are shown.
   - Use resend code and retry.
   - Confirm no redirect happens until profile completion succeeds when required.

## Additional Verification
- `returnTo` open-redirect attempts are rejected.
- Session cookies are established after `POST /auth/verify-otp`.
- Session policy cookies are refreshed after sign-in, OTP verify, update-password, and heartbeat.
- Feedback POST/reply APIs return forbidden for incomplete profiles.
- `/ai-assistant` route and `/api/citizen/chat/reply` enforce profile completion server-side.
