# System Administration API Contract

## Scope
- Security settings management
- System banner draft/publish lifecycle
- Audit log visibility for security and banner changes

## `GET /api/admin/system-administration`
Returns:

```json
{
  "securitySettings": { "...": "..." },
  "systemBannerDraft": { "...": "..." },
  "systemBannerPublished": { "...": "..." },
  "auditLogs": []
}
```

Notes:
- `systemBannerPublished` can be `null` when no active published record exists.
- Notification settings are no longer returned.

## `POST /api/admin/system-administration`
Supported actions:
- `update_security_settings`
- `publish_system_banner`
- `unpublish_system_banner`

Removed action:
- `update_notification_settings`

## Global Public Endpoints
- `GET /api/system/security-policy`: password/session policy payload for UI and guards.
- `GET /api/system/banner`: currently active published banner (`no-store`).

## Banner Lifecycle
- Draft is edited via admin UI and published explicitly.
- Publish writes `system.banner_draft` and `system.banner_published`.
- Unpublish clears `system.banner_published`.
- Banner display is global in root layout across:
  - citizen
  - city
  - barangay
  - admin
  - auth pages

## Settings Keys in Active Use
- `system.security_settings`
- `system.banner_draft`
- `system.banner_published`
- `system.login_attempt_state`

Legacy note:
- Historical `system.notification_settings` rows may still exist in storage but are no longer read/written.

