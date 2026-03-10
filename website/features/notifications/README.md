# Notifications Feature Guide

## A. Purpose
Provide in-app and email notification delivery for citizen/LGU/admin users, including read-state management and safe "open related page" redirects.

## B. UI Surfaces
Bell + badge:
- `features/notifications/components/notifications-bell.tsx`

Inbox:
- `features/notifications/components/notifications-inbox.tsx`
- `features/notifications/realtime-listener.tsx`

Role routes:
- Citizen: `app/(citizen)/notifications/page.tsx`
- Barangay: `app/(lgu)/barangay/(authenticated)/notifications/page.tsx`
- City: `app/(lgu)/city/(authenticated)/notifications/page.tsx`
- Admin: `app/admin/(authenticated)/notifications/page.tsx`

## C. Event Model and Dedupe
Event source of truth:
- `lib/notifications/events.ts`
- `NOTIFICATION_EVENT_TYPES`

Current event types:
- `AIP_CLAIMED`
- `AIP_REVISION_REQUESTED`
- `AIP_PUBLISHED`
- `AIP_SUBMITTED`
- `AIP_RESUBMITTED`
- `AIP_EXTRACTION_SUCCEEDED`
- `AIP_EXTRACTION_FAILED`
- `AIP_EMBED_SUCCEEDED`
- `AIP_EMBED_FAILED`
- `FEEDBACK_CREATED`
- `FEEDBACK_VISIBILITY_CHANGED`
- `PROJECT_UPDATE_STATUS_CHANGED`
- `OUTBOX_FAILURE_THRESHOLD_REACHED`
- `MODERATION_ACTION_AUDIT`
- `PIPELINE_JOB_FAILED`

Dedupe:
- Key builder: `lib/notifications/dedupe.ts`
- In-app dedupe constraint: `notifications(recipient_user_id, dedupe_key)`
- Email dedupe constraint: `email_outbox(to_email, dedupe_key)`

## D. API Contract
List and counts:
- `GET /api/notifications`
- `GET /api/notifications/unread-count`

Mutations:
- `PATCH /api/notifications/[notificationId]/read`
- `POST /api/notifications/read-all`

Tracked-open redirect:
- `GET /api/notifications/open?next=...&notificationId=...|dedupe=...`
- Marks rows as read and issues `307` to internal `next` path.

## E. Security Boundaries
Ownership and auth:
- API routes resolve current user from Supabase session and scope updates/selects to `recipient_user_id`.

CSRF:
- Mutating routes require CSRF checks via `lib/security/csrf.ts`.

Redirect safety:
- Tracked-open validates `next` via `lib/notifications/open-link.ts` (`isSafeInternalPath`).
- Unsafe redirects fall back to `/`.

DB policy layer:
- RLS for notifications/preferences is defined in `docs/sql/2026-03-03_notifications_outbox_tables_rls.sql`.

## F. Database Alignment
Canonical DB objects:
- `public.notifications`
- `public.notification_preferences`
- `public.email_outbox`

DB contract types:
- `lib/contracts/databasev2/rows/notifications.ts`
- `lib/contracts/databasev2/rows/notification_preferences.ts`
- `lib/contracts/databasev2/rows/email_outbox.ts`

## G. Outbox Integration
Outbox processor:
- `supabase/functions/send-email-outbox/index.ts`

Behavior:
- Pulls `queued` rows from `public.email_outbox`
- Sends email via Resend
- Updates status/attempt counters
- Emits admin in-app alerts when hourly failure threshold is exceeded

Required env for outbox function:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `FROM_EMAIL`
- `APP_BASE_URL`

## H. Tests
Website tests:
- `features/notifications/notifications-api.test.ts`
- `features/notifications/notify.test.ts`
- `features/notifications/dedupe.test.ts`
- `features/notifications/action-url.test.ts`

Outbox function tests:
- `supabase/functions/send-email-outbox/index.test.ts`
