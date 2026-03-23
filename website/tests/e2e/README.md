# Playwright E2E (ISO Evidence)

This folder contains Playwright end-to-end tests for ISO/IEC 25010 evidence generation:

- Functional Suitability (`evidence-pack/01-functional/playwright-report/`)
- Compatibility (`evidence-pack/03-compatibility/playwright-matrix.md`)

## Prerequisites

- Install dependencies in `website/`
- Staging dataset includes the dedicated e2e fixture tuple (`E2E_AIP_RESET_BARANGAY_ID` + `E2E_AIP_RESET_FISCAL_YEAR`)
- Canonical PDF fixture is available at `tests/e2e/fixtures/aip-chromium.pdf`

## Required Environment Variables

- `E2E_BASE_URL` (example: `https://<vercel-preview-url>`)
- `E2E_CITIZEN_EMAIL`
- `E2E_CITIZEN_PASSWORD`
- `E2E_BARANGAY_EMAIL`
- `E2E_BARANGAY_PASSWORD`
- `E2E_CITY_EMAIL`
- `E2E_CITY_PASSWORD`
- `E2E_ADMIN_EMAIL`
- `E2E_ADMIN_PASSWORD`

Optional:

- `E2E_STORAGE_STATE_DIR` (default: `website/.playwright/.auth`)
- `E2E_COMMIT_SHA` (falls back to `GITHUB_SHA` for matrix)
- `E2E_AIP_RESET_ENDPOINT` (default: `/api/internal/e2e/reset-aip`)

Staging fixture reset variables (required when `E2E_AIP_RESET_ENABLED=true`):

- `E2E_AIP_RESET_ENABLED` (`true` or `false`)
- `E2E_AIP_RESET_TOKEN`
- `E2E_AIP_RESET_BARANGAY_ID`
- `E2E_AIP_RESET_FISCAL_YEAR`

## Project-Specific Inputs

Single shared PDF path (used by all Playwright projects):

- `E2E_AIP_PDF_PATH_CHROMIUM`

Committed fixture (from `website/`):

- `E2E_AIP_PDF_PATH_CHROMIUM=tests/e2e/fixtures/aip-chromium.pdf`

Project scenario JSON paths:

- `E2E_SCENARIO_CHROMIUM`
- `E2E_SCENARIO_FIREFOX`
- `E2E_SCENARIO_PIXEL5`
- `E2E_SCENARIO_IPHONE13`

Use `tests/e2e/scenarios/scenario.example.json` as the schema template.

Shared scenario now (staging snapshot, March 11, 2026):

- `E2E_SCENARIO_CHROMIUM=tests/e2e/scenarios/scenario.staging.shared.json`
- `E2E_SCENARIO_FIREFOX=tests/e2e/scenarios/scenario.staging.shared.json`
- `E2E_SCENARIO_PIXEL5=tests/e2e/scenarios/scenario.staging.shared.json`
- `E2E_SCENARIO_IPHONE13=tests/e2e/scenarios/scenario.staging.shared.json`

Note: this shared scenario is intended for the current staging snapshot and smoke execution.  
The canonical flow includes guarded pre-clean and post-clean against the staging fixture tuple so the same published fixture AIP can be reused between runs.

## Scenario Contract

A scenario file must include:

- `aipWorkflow.uploadFiscalYear`
- `aipWorkflow.revisionComment`
- `aipWorkflow.resubmissionReply`
- `citizen.feedbackMessage`
- `admin.usageControls.chatbotMaxRequests`
- `admin.usageControls.chatbotTimeWindow` (`per_hour` or `per_day`)

## Run Commands

From `website/`:

PowerShell setup example:

```powershell
$env:E2E_AIP_PDF_PATH_CHROMIUM="tests/e2e/fixtures/aip-chromium.pdf"
```

```bash
npm run e2e:install
npm run e2e
npm run e2e:ui
npm run e2e:report
```

`npm run e2e` always attempts matrix generation after the Playwright run and keeps the Playwright exit code.

## Workflows Covered

1. Barangay upload -> extraction complete -> run query clears -> validation visible
2. Barangay submit AIP to city
3. City request revision
4. Barangay sees revision note -> replies -> resubmits
5. City approve/publish AIP
6. Citizen browse published AIP details/projects/budget allocation
7. Citizen submit feedback
8. Admin update chatbot usage controls and verify persisted effect
9. Admin verify audit logs for moderation/publish/feedback/usage-control actions

## Suite Structure

- Canonical serial spec: `tests/e2e/workflows-happy-path.spec.ts`
- Cleanup wiring:
  - `beforeAll`: staging fixture pre-clean (`/api/internal/e2e/reset-aip`)
  - `afterAll`: best-effort staging fixture cleanup after audit-log assertions
