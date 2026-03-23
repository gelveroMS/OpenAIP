# Lighthouse CI Scripts

This folder contains Lighthouse CI tooling for collecting staging performance evidence for the `website/` app.

## Required environment variables

- `LHCI_BASE_URL`: Staging origin to audit (for example `https://staging.example.com`).
- `E2E_BARANGAY_EMAIL`
- `E2E_BARANGAY_PASSWORD`
- `E2E_CITY_EMAIL`
- `E2E_CITY_PASSWORD`
- `E2E_ADMIN_EMAIL`
- `E2E_ADMIN_PASSWORD`

Role credentials are required because these audited pages are authentication-protected:

- `/barangay/aips`
- `/city/aips`
- `/admin/usage-controls`

## Audited pages

Public pages:

- `/aips`
- `/budget-allocation`
- `/projects`
- `/ai-assistant`
- `/about` (redirects to `/about-us` in app config)

Role pages:

- `/barangay/aips`
- `/city/aips`
- `/admin/usage-controls`

## Commands (run from `website/`)

- `npm run lhci:healthcheck`
- `npm run lhci:raw`
- `npm run lhci:summary`
- `npm run lhci`

`npm run lhci` uses a cross-platform Node wrapper that:

1. Runs `lhci autorun --config=./lighthouserc.js`
2. Always attempts to generate `summary.md` afterward
3. Auto-loads `website/.env.local` via Next env loader before running LHCI

## Output location

Artifacts are written to:

- `../evidence-pack/02-performance/lighthouse/*.html`
- `../evidence-pack/02-performance/lighthouse/*.json`
- `../evidence-pack/02-performance/lighthouse/summary.md`

## Notes

- This setup is designed for deployed/staging URLs, not local static export.
- Role pages must be reachable and authorized in staging for valid metrics.
