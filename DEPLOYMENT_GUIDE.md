# OpenAIP Deployment Guide

This guide is the production deployment path for this monorepo:

- Website (`website`) on Vercel
- Pipeline (`aip-intelligence-pipeline`) on Render (Blueprint, API + worker)
- Data/auth/storage on Supabase

It is UI-first (dashboard-first), production + preview aware, and assumes branch `main` is the deployment source of truth.

## 1) Scope and Architecture

### Deployment Targets
- `website` -> Vercel Project (Next.js)
- `aip-intelligence-pipeline` -> Render Blueprint (`render.yaml`) with `web` API service + `worker` background service
- Supabase -> managed Postgres/Auth/Storage + optional Edge Functions used by this repo

### Runtime Flow
```text
Browser
  -> Vercel-hosted Next.js app (website)
  -> Supabase (Auth + DB + Storage + Realtime)
  -> Render FastAPI (chat + run endpoints)
  -> Render Worker (claims and processes queued extraction_runs)
```

### Source-of-Truth Files
- `website/.env.local.example`
- `aip-intelligence-pipeline/.env.example`
- `website/lib/chat/pipeline-client.ts`

## 2) Prerequisites

### Accounts and Access
- GitHub access to this repository with `main` branch deployment rights
- Vercel account/team with repo import access
- Render account/workspace with repo import access
- Supabase project (hosted)
- OpenAI API key
- DNS provider access for custom domains

### Deployment Style
- Primary steps are dashboard-first (Vercel and Render UI)
- CLI notes are optional helpers, not required

### Security Baseline Before You Start
- Do not expose server secrets as `NEXT_PUBLIC_*`
- Keep these secrets server-side only:
- `SUPABASE_SERVICE_ROLE_KEY` (website)
- `SUPABASE_SERVICE_KEY` (pipeline)
- `OPENAI_API_KEY` (pipeline)
- `PIPELINE_HMAC_SECRET` (shared website + pipeline)

## 3) Supabase Setup (Full)

### 3.1 Fresh Project (Greenfield)
1. Open Supabase SQL Editor.
2. Run canonical schema:
- `website/docs/sql/database-v2.sql`
3. Confirm tables and routines are created successfully.

### 3.2 Existing Project (Incremental)
1. Apply dated SQL patches in ascending order listed in root README under:
- `Database & Migrations` section in `README.md`
2. Do not skip ordering of patches.

### 3.3 Required Storage Buckets
Create these buckets in Supabase Storage:
- `aip-pdfs`
- `aip-artifacts`
- `project-media`
- `about-us-docs`

### 3.4 Required `app.settings` Seeds and Access
Confirm `app.settings` exists and service role can access it.
Required seeded keys used by the website include:
- `content.citizen_about_us`
- `content.citizen_dashboard`

### 3.5 Supabase Values You Will Reuse in Vercel/Render
Capture and store securely:
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` (same project URL)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and/or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (website)
- `SUPABASE_SERVICE_KEY` (pipeline; service role)

### 3.6 Optional but Explicit: Edge Functions Used by This Repo
If you are enabling these production features, configure function secrets too.

#### `embed_categorize_artifact`
Path:
- `supabase/functions/embed_categorize_artifact/index.ts`

Required function envs:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `EMBED_CATEGORIZE_JOB_SECRET`

Common optional envs:
- `EMBED_CATEGORIZE_JOB_AUDIENCE`
- `EMBED_CATEGORIZE_NONCE_TTL_SECONDS`
- `EMBED_CATEGORIZE_DEDUPE_TTL_SECONDS`

Also set DB config values for dispatcher URL/secret/audience as documented in root README.

#### `send-email-outbox`
Path:
- `supabase/functions/send-email-outbox/index.ts`

Required function envs:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `FROM_EMAIL`
- `APP_BASE_URL`

Optional tuning envs:
- `EMAIL_OUTBOX_BATCH_SIZE`
- `EMAIL_OUTBOX_MAX_ATTEMPTS`
- `EMAIL_OUTBOX_FAILURE_THRESHOLD_PER_HOUR`

## 4) Deploy Website to Vercel

### 4.1 Create Vercel Project (UI)
1. In Vercel Dashboard, click `Add New Project`.
2. Import this GitHub repository.
3. Set **Root Directory** to `website`.
4. Framework should auto-detect as Next.js. Keep default build/output unless you have a reason to override.
5. Set production branch to `main`.

### 4.2 Configure Environment Variables
Set variables for both **Preview** and **Production** scopes.

#### Website Environment Matrix
| Variable | Preview | Production | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Required | Required | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Required* | Required* | Use with or instead of anon key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required* | Required* | At least one public key must be set |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | Required | Server-only |
| `BASE_URL` | Required | Required | Absolute website origin |
| `NEXT_PUBLIC_SITE_URL` | Required | Required | Canonical browser origin for CSRF checks |
| `NEXT_PUBLIC_STAGING_URL` | Optional | Optional | Additional allowed staging origin |
| `NEXT_PUBLIC_APP_ENV` | `staging` | `prod` | Controls adapter behavior |
| `NEXT_PUBLIC_USE_MOCKS` | `false` | `false` | Keep false for real Supabase data |
| `PIPELINE_API_BASE_URL` | Required | Required | Render pipeline API origin |
| `PIPELINE_HMAC_SECRET` | Required | Required | Must match pipeline value |
| `PIPELINE_INTERNAL_TOKEN` | Optional | Optional | Legacy for intent route call path |

\* Set at least one of publishable key or anon key.

### 4.3 Important Build Dependency
This repo's `website` build runs:
- `npm run db:assert-hardening`

That assertion requires, at build/runtime context:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

If those are missing, Vercel build fails before Next.js build completes.

### 4.4 Deploy and Capture URLs
1. Trigger first deploy.
2. Save:
- Preview URL (`*.vercel.app` for preview)
- Production URL (`*.vercel.app` or custom domain)

### Optional CLI Notes
```bash
# from repo root
vercel
vercel --prod
```
(Use only if you intentionally prefer CLI.)

## 5) Deploy Pipeline to Render (Blueprint)

### 5.1 Add `render.yaml` to Repo Root
Create `render.yaml` at repository root with the template below.

```yaml
services:
  - type: web
    name: openaip-pipeline-api
    runtime: python
    plan: free
    branch: main
    autoDeploy: true
    buildCommand: cd aip-intelligence-pipeline && pip install .
    startCommand: cd aip-intelligence-pipeline && uvicorn openaip_pipeline.api.app:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /health
    envVars:
      - key: OPENAI_API_KEY
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_KEY
        sync: false
      - key: SUPABASE_STORAGE_ARTIFACT_BUCKET
        value: aip-artifacts
      - key: PIPELINE_HMAC_SECRET
        sync: false
      - key: PIPELINE_RUNS_HMAC_SECRET
        sync: false
      - key: PIPELINE_RUNS_ALLOWED_AUDIENCES
        value: website-backend
      - key: PIPELINE_MODEL
        value: gpt-5.2
      - key: PIPELINE_EMBEDDING_MODEL
        value: text-embedding-3-large
      - key: PIPELINE_ENABLE_RAG
        value: "false"
      - key: PIPELINE_DEV_ROUTES
        value: "false"

  - type: worker
    name: openaip-pipeline-worker
    runtime: python
    plan: free
    branch: main
    autoDeploy: true
    buildCommand: cd aip-intelligence-pipeline && pip install .
    startCommand: cd aip-intelligence-pipeline && openaip-worker
    envVars:
      - key: OPENAI_API_KEY
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_KEY
        sync: false
      - key: SUPABASE_STORAGE_ARTIFACT_BUCKET
        value: aip-artifacts
      - key: PIPELINE_HMAC_SECRET
        sync: false
      - key: PIPELINE_RUNS_HMAC_SECRET
        sync: false
      - key: PIPELINE_RUNS_ALLOWED_AUDIENCES
        value: website-backend
      - key: PIPELINE_WORKER_POLL_SECONDS
        value: "3"
      - key: PIPELINE_WORKER_RUN_ONCE
        value: "false"
      - key: PIPELINE_EXTRACT_MAX_PAGES
        value: "200"
      - key: PIPELINE_PARSE_TIMEOUT_SECONDS
        value: "20"
      - key: PIPELINE_EXTRACT_TIMEOUT_SECONDS
        value: "1800"
      - key: PIPELINE_EMBED_TIMEOUT_SECONDS
        value: "300"
      - key: PIPELINE_RETRY_FAILURE_THRESHOLD
        value: "5"
      - key: PIPELINE_RETRY_FAILURE_WINDOW_SECONDS
        value: "21600"
      - key: PIPELINE_SUPABASE_HTTP_TIMEOUT_SECONDS
        value: "120"
      - key: PIPELINE_SUPABASE_DOWNLOAD_TIMEOUT_SECONDS
        value: "120"
      - key: PIPELINE_SOURCE_PDF_MAX_BYTES
        value: "15728640"
```

### 5.2 Apply Blueprint in Render (UI)
1. Commit and push `render.yaml` to `main`.
2. In Render Dashboard, create Blueprint deployment from this repo.
3. Fill all `sync: false` secrets.
4. Apply Blueprint.
5. Wait for both services to become healthy.

### 5.3 Required Pipeline Variables
Required for production operation:
- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `PIPELINE_HMAC_SECRET`
- `PIPELINE_RUNS_HMAC_SECRET`
- `PIPELINE_RUNS_ALLOWED_AUDIENCES`

Recommended guardrails (set explicitly):
- `PIPELINE_EXTRACT_MAX_PAGES`
- `PIPELINE_PARSE_TIMEOUT_SECONDS`
- `PIPELINE_EXTRACT_TIMEOUT_SECONDS`
- `PIPELINE_EMBED_TIMEOUT_SECONDS`
- `PIPELINE_RETRY_FAILURE_THRESHOLD`
- `PIPELINE_RETRY_FAILURE_WINDOW_SECONDS`
- `PIPELINE_SUPABASE_HTTP_TIMEOUT_SECONDS`
- `PIPELINE_SUPABASE_DOWNLOAD_TIMEOUT_SECONDS`
- `PIPELINE_SOURCE_PDF_MAX_BYTES`

## 6) Integrate Vercel + Render

### 6.1 Wire API URL
Set Vercel `PIPELINE_API_BASE_URL` to your Render API URL (or Render custom domain once configured).

### 6.2 Wire Shared Signing Secret
Set the exact same `PIPELINE_HMAC_SECRET` in:
- Vercel website project envs
- Render API service envs
- Render worker service envs

### 6.3 Enforce Production Data Path
Use:
- `NEXT_PUBLIC_USE_MOCKS=false`
- `NEXT_PUBLIC_APP_ENV=prod`

### 6.4 Redeploy After Env Changes
After updating env vars:
1. Redeploy Vercel project.
2. Trigger Render service redeploys (or wait for auto deploy from commit).

### 6.5 Public Deployment Contracts
These are the critical cross-service contracts:
- `PIPELINE_API_BASE_URL`: website -> pipeline origin
- `PIPELINE_HMAC_SECRET`: shared HMAC signing secret for `/v1/chat/*`
- Render Blueprint service contract: API `web` + processing `worker`
- Vercel project root contract: `website` subdirectory

## 7) Custom Domains and Final URL Wiring

### 7.1 Vercel Website Domain
1. Add custom domain in Vercel Project Settings.
2. Apply DNS records at your DNS provider.
3. Verify domain is active and SSL is issued.

### 7.2 Render API Domain
1. Add custom domain to Render API web service.
2. Apply DNS records.
3. Verify domain points to healthy API service.

### 7.3 Final Environment Rewire Checklist
After DNS propagates, update:
- `BASE_URL`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_STAGING_URL` (if used)
- `PIPELINE_API_BASE_URL`

### 7.4 Redeploy
Perform redeploys on Vercel and Render so final domain values are active.

## 8) Preview vs Production Behavior

| Concern | Preview | Production |
|---|---|---|
| Vercel deploy source | PR/preview deploys | `main` |
| Website env scope | Preview env vars | Production env vars |
| `NEXT_PUBLIC_APP_ENV` | `staging` | `prod` |
| `NEXT_PUBLIC_USE_MOCKS` | `false` | `false` |
| Pipeline target | Shared primary Render API by default | Shared primary Render API |

Default in this guide: one shared Render pipeline environment. If you need strict isolation, add separate staging Render services and point preview `PIPELINE_API_BASE_URL` to staging API.

## 9) Free vs Paid Path

### Decision Triggers and Impact
| Signal | Free-First Impact | Move to Paid When |
|---|---|---|
| API responsiveness degrades | More frequent cold starts and slower first request | User-facing latency is consistently unacceptable |
| Queue backlog grows | Worker throughput can lag during bursts | Runs remain queued for operationally significant periods |
| Reliability expectations increase | Free plans are less suitable for strict uptime SLOs | You need stronger uptime and predictable performance |
| Build/runtime limits become frequent | Resource ceilings are easier to hit | You repeatedly hit memory/CPU/time constraints |

### Free-First Path
- Start both Render services on `plan: free`.
- Monitor cold start behavior and queue time.
- Keep guardrail env vars explicit.

### Paid Baseline Path
- Upgrade API and/or worker plan first (do not upgrade blindly).
- Prioritize worker plan upgrade when queue latency is the primary issue.
- Prioritize API plan upgrade when chatbot/API latency is the primary issue.

## 10) Smoke Tests and Acceptance Checks

Run these checks after deployment and after major config changes.

### 10.1 Website and Auth
- Open website root and role-specific sign-in pages.
- Confirm no runtime `BASE_URL` errors.

### 10.2 Pipeline Health
- `GET <PIPELINE_API_BASE_URL>/health`
- Expected: HTTP 200 with status/version payload.

### 10.3 Upload and Queue Processing
1. Upload a valid PDF from website flow.
2. Confirm run enters `queued` then gets claimed by worker.
3. Confirm run progresses and completes (or fails with explicit error code).

### 10.4 Chatbot Path
- Submit a chatbot query from website.
- Confirm response returns and includes citation-backed payload path.

### 10.5 Realtime Progress
- Confirm extraction progress updates in UI (realtime/polling path).

### 10.6 Guide Validation Scenarios
Use these scenarios when reviewing this guide itself:
1. Greenfield: new Supabase + first deploy.
2. Incremental: existing Supabase + patch path.
3. Preview: PR deploy separation.
4. Custom domain cutover.
5. Wrong `PIPELINE_HMAC_SECRET` intentionally returns 401 for signed endpoints.
6. Worker stopped vs worker running queue behavior.
7. Missing website build assertion envs reproduces expected build failure then fix.

## 11) Troubleshooting

Use root README troubleshooting as primary issue catalog, then run platform checks below.

### 11.1 Repo-Mapped Issues (Examples)
- Missing Supabase website envs -> runtime startup errors.
- `runs` stuck in `queued` -> worker unavailable or pipeline Supabase credentials invalid.
- `/v1/chat/*` 401 -> bad/missing HMAC headers or mismatched `PIPELINE_HMAC_SECRET`.
- `Invalid schema: app` -> `app` schema not exposed/migrated correctly.

Primary reference:
- Root `README.md` -> `Troubleshooting` table.

### 11.2 Platform Quick Checks

#### Vercel
- Check latest deployment logs for build/runtime env failures.
- Confirm env vars exist in correct scope (Preview vs Production).

#### Render
- Check API service logs for auth/signature errors and startup failures.
- Check worker logs for claim/process loops and Supabase/OpenAI errors.
- Confirm API health check path `/health` remains green.

#### Supabase
- Validate required SQL objects/migrations are present.
- Confirm required buckets exist.
- Confirm service keys used by Vercel/Render are current and valid.

## 12) Known Risk Notes

### 12.1 `/intent/classify` Authentication Gap
Current implementation in:
- `aip-intelligence-pipeline/src/openaip_pipeline/api/routes/intent.py`

The `/intent/classify` route currently has no server-side auth dependency. Website currently sends `x-pipeline-token`, but the pipeline route does not enforce token/HMAC there.

This is documented risk, not a deployment blocker for this guide.

### 12.2 Recommended Mitigation (Non-Blocking)
- Add server-side auth enforcement for `/intent/classify` (HMAC or equivalent).
- Optionally rate-limit and/or IP restrict route exposure.
- Keep endpoint observability for abnormal traffic.

### 12.3 Monitoring Recommendation
- Track request volume and source patterns for `/intent/classify`.
- Alert on unusual spikes or unknown caller patterns.

## External Documentation Baseline
- Vercel build/root directory docs: https://vercel.com/docs/builds/configure-a-build
- Vercel monorepo (Turborepo): https://vercel.com/docs/monorepos/turborepo
- Vercel monorepo FAQ: https://vercel.com/docs/monorepos/monorepo-faq
- Render FastAPI deploy docs: https://render.com/docs/deploy-fastapi
- Render private networking docs: https://render.com/docs/private-network
- Render multi-service examples (Celery pattern): https://render.com/docs/deploy-celery
