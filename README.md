# OpenAIP
OpenAIP is a monorepo for a role-based LGU web platform and an AI pipeline that ingests AIP PDFs, extracts structured project data, and writes validated results back to Supabase.

- Multi-portal Next.js app for `citizen`, `barangay`, `city`, and `admin` roles
- AIP PDF upload flow with queueing and live extraction progress
- Python pipeline worker for extraction, validation, summarization, and categorization
- Supabase-backed auth, Postgres, storage, and realtime updates
- Review/revision workflows for AIP and project-level feedback

## Table of Contents
- [Demo / Screenshots](#demo--screenshots)
- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Scripts](#scripts)
- [Database & Migrations](#database--migrations)
- [Notifications & Outbox](#notifications--outbox)
- [Auth & Authorization](#auth--authorization)
- [Storage / File Handling](#storage--file-handling)
- [Testing & Quality](#testing--quality)
- [Deployment](#deployment)
- [Deployment Guide](#deployment-guide)
- [Security](#security)
- [Observability](#observability)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)
- [Maintainers / Contact](#maintainers--contact)

## Demo / Screenshots
![OpenAIP Logo](website/public/brand/logo.svg)

## Tech Stack
| Area | Stack |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Radix UI |
| Web Backend | Next.js Route Handlers + Server Components/Actions |
| Pipeline Backend | FastAPI + Python 3.11 worker/service package (`openaip-pipeline`) |
| Database | Supabase Postgres |
| Auth | Supabase Auth + role-based route gating |
| Storage | Supabase Storage (`aip-pdfs`, `aip-artifacts`, `project-media`, `about-us-docs`) |
| Realtime | Supabase Realtime on `public.extraction_runs` and `public.notifications` |
| AI/ML | OpenAI (`gpt-5.2`, `text-embedding-3-large`), LangChain OpenAI |
| Tooling | npm, Vitest, ESLint, pytest, Ruff, Pyright, Docker Compose |

## Architecture Overview
```text
Browser (Citizen/LGU/Admin)
    |
    v
Next.js app (website/app)
    |-- Supabase session + role gate (website/proxy.ts, lib/supabase/proxy.ts)
    |-- Upload API routes (website/app/api/**/aips/upload/route.ts)
    v
Supabase (Auth + Postgres + Storage)
    |-- uploaded_files, extraction_runs, extraction_artifacts, projects
    |-- storage bucket: aip-pdfs
    v
Python worker (aip-intelligence-pipeline)
    |-- claims queued extraction_runs
    |-- extract -> validate -> summarize -> categorize
    |-- writes artifacts and upserts projects
    |-- optional RAG trace
    v
Web UI reads status + subscribes to realtime progress
```

Core data flow:
1. User uploads a PDF from the web app.
2. Web API stores file metadata and queues a run in `public.extraction_runs`.
3. Worker claims the queued run, downloads the PDF via signed URL, processes stages, and writes outputs to DB/storage.
4. UI reads/polls/subscribes to run progress and displays final AIP/project data.

### Dashboard Backend Architecture
- Dashboard backend is implemented with server-repo adapters in `website/lib/repos/dashboard/*` (`repo.ts`, `repo.server.ts`, `repo.mock.ts`, `repo.supabase.ts`, `types.ts`).
- Reads are scope-filtered and aggregated from existing tables (`aips`, `projects`, `feedback`, `extraction_runs`, `aip_reviews`, `uploaded_files`, `profiles`).
- Barangay write flows are hardened: draft creation is FY-validated and idempotent; feedback replies enforce citizen-root constraints through feedback threads repo.
- Mock behavior follows global selector flags only (`NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_USE_MOCKS`).

## Project Structure
| Path | Responsibility |
|---|---|
| `website/app` | Next.js routes (citizen/LGU/admin) and API route handlers |
| `website/features` | Feature modules (AIP, projects, submissions, audit, feedback, chat, notifications, account, admin) |
| `website/lib` | Repo layer, Supabase clients, domain logic, typed DB contracts |
| `website/docs/sql` | Database schema baseline + incremental SQL patches |
| `website/docs/SUPABASE_MIGRATION.md` | Supabase migration guidance and adapter strategy |
| `website/tests` | Repo-smoke and typecheck tests |
| `aip-intelligence-pipeline/src/openaip_pipeline/api` | FastAPI app and run endpoints |
| `aip-intelligence-pipeline/src/openaip_pipeline/worker` | Queue polling and stage processor |
| `aip-intelligence-pipeline/src/openaip_pipeline/services` | Extraction/validation/summarization/categorization/RAG logic |
| `aip-intelligence-pipeline/src/openaip_pipeline/adapters/supabase` | Supabase REST/storage adapters and repository |
| `aip-intelligence-pipeline/src/openaip_pipeline/resources` | Prompts, schemas, rules, version manifest |
| `aip-intelligence-pipeline/tests` | Python unit/smoke tests |
| `aip-intelligence-pipeline/docker-compose.yml` | API + worker container orchestration |

## Getting Started
### Prerequisites
- Node.js (Next.js 16-compatible; Node 20+ recommended)
- npm (repo includes `website/package-lock.json`)
- Python 3.11+
- Supabase project (URL, publishable/anon key, service role key)
- OpenAI API key (for worker processing)
- Docker Desktop (optional, for containerized pipeline)

### Installation
```bash
# 1) Clone and enter repo
git clone https://github.com/CjPadua/open-aip.git
cd open-aip

# 2) Install website dependencies
cd website
npm install
cd ..

# 3) Install pipeline dependencies (with dev tools)
cd aip-intelligence-pipeline
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
cd ..
```

### Environment Variables
Copy template files:
```bash
# macOS/Linux
cp website/.env.local.example website/.env.local
cp aip-intelligence-pipeline/.env.example aip-intelligence-pipeline/.env
```

```powershell
# Windows PowerShell
Copy-Item website/.env.local.example website/.env.local
Copy-Item aip-intelligence-pipeline/.env.example aip-intelligence-pipeline/.env
```

`website/.env.local` (safe example):
```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<supabase-publishable-or-anon-key>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<optional-fallback-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
SUPABASE_STORAGE_ARTIFACT_BUCKET=aip-artifacts
SUPABASE_STORAGE_PROJECT_MEDIA_BUCKET=project-media
AIP_UPLOAD_MAX_BYTES=15728640
AIP_UPLOAD_FAILURE_THRESHOLD=5
AIP_UPLOAD_FAILURE_WINDOW_MINUTES=60
AIP_UPLOAD_FAILURE_COOLDOWN_MINUTES=15

BASE_URL=http://localhost:3000
NEXT_PUBLIC_APP_ENV=dev
NEXT_PUBLIC_USE_MOCKS=true
NEXT_PUBLIC_FEEDBACK_DEBUG=0
NEXT_PUBLIC_TEMP_ADMIN_BYPASS=false
NEXT_PUBLIC_API_BASE_URL=
PIPELINE_API_BASE_URL=http://localhost:8000
PIPELINE_HMAC_SECRET=<shared-hmac-secret>
# Legacy/unused for chat s2s auth.
PIPELINE_INTERNAL_TOKEN=<shared-internal-token>
```

`aip-intelligence-pipeline/.env` (safe example):
```env
OPENAI_API_KEY=<openai-api-key>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_KEY=<supabase-service-role-key>
SUPABASE_STORAGE_ARTIFACT_BUCKET=aip-artifacts

PIPELINE_MODEL=gpt-5.2
PIPELINE_EMBEDDING_MODEL=text-embedding-3-large
PIPELINE_BATCH_SIZE=25
PIPELINE_WORKER_POLL_SECONDS=3
PIPELINE_WORKER_RUN_ONCE=false
PIPELINE_PROGRESS_HEARTBEAT_SECONDS=5
PIPELINE_SUMMARIZE_EXPECTED_SECONDS=60
PIPELINE_SUMMARIZE_CONTEXT_WINDOW_TOKENS=128000
PIPELINE_SUMMARIZE_RESPONSE_BUFFER_TOKENS=2000
PIPELINE_SUMMARIZE_PROJECT_FIELD_CHAR_LIMIT=500
PIPELINE_VALIDATE_CONTEXT_WINDOW_TOKENS=128000
PIPELINE_VALIDATE_RESPONSE_BUFFER_TOKENS=2000
PIPELINE_VALIDATE_PROJECT_FIELD_CHAR_LIMIT=500
PIPELINE_CATEGORIZE_CONTEXT_WINDOW_TOKENS=128000
PIPELINE_CATEGORIZE_RESPONSE_BUFFER_TOKENS=2000
PIPELINE_CATEGORIZE_PROJECT_FIELD_CHAR_LIMIT=500
PIPELINE_EXTRACT_MAX_PAGES=200
PIPELINE_PARSE_TIMEOUT_SECONDS=20
PIPELINE_EXTRACT_TIMEOUT_SECONDS=1800
PIPELINE_EMBED_TIMEOUT_SECONDS=300
PIPELINE_RETRY_FAILURE_THRESHOLD=5
PIPELINE_RETRY_FAILURE_WINDOW_SECONDS=21600
PIPELINE_SUPABASE_HTTP_TIMEOUT_SECONDS=120
PIPELINE_SUPABASE_DOWNLOAD_TIMEOUT_SECONDS=120
PIPELINE_SOURCE_PDF_MAX_BYTES=15728640
PIPELINE_ARTIFACT_INLINE_MAX_BYTES=32768
PIPELINE_ENABLE_RAG=false
PIPELINE_RAG_TRACE_QUERY=
PIPELINE_DEV_ROUTES=false
PIPELINE_HMAC_SECRET=<shared-hmac-secret>
# Legacy/unused for chat s2s auth.
PIPELINE_INTERNAL_TOKEN=<shared-internal-token>
PIPELINE_RUNS_HMAC_SECRET=<hmac-secret-hex>
PIPELINE_RUNS_ALLOWED_AUDIENCES=website-backend
PIPELINE_RUNS_RATE_LIMIT_WINDOW_SECONDS=60
PIPELINE_RUNS_RATE_LIMIT_PER_AUD=30
PIPELINE_RUNS_RATE_LIMIT_GLOBAL=120
PIPELINE_RUNS_NONCE_TTL_SECONDS=120
PIPELINE_RUNS_DEDUPE_TTL_SECONDS=30

PIPELINE_VERSION=
PIPELINE_PROMPT_SET_VERSION=v1.0.0
PIPELINE_SCHEMA_VERSION=v1.0.0
PIPELINE_RULESET_VERSION=v1.0.0

API_HOST=0.0.0.0
API_PORT=8000
LOG_LEVEL=INFO
```

Website env reference:
| Variable | Required | Visibility | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Client-exposed | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes* | Client-exposed | Browser/server SSR Supabase key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes* | Client-exposed | Fallback if publishable key not set |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only | Elevated server actions (uploads/admin ops) |
| `SUPABASE_STORAGE_ARTIFACT_BUCKET` | No | Server-only | Artifact bucket used for strict draft delete cleanup (default `aip-artifacts`) |
| `SUPABASE_STORAGE_PROJECT_MEDIA_BUCKET` | No | Server-only | Private bucket used for project cover images and update photos (default `project-media`) |
| `AIP_UPLOAD_MAX_BYTES` | No | Server-only | Maximum upload size in bytes for AIP PDF routes (default `15728640`) |
| `AIP_UPLOAD_FAILURE_THRESHOLD` | No | Server-only | Number of recent failed runs before uploader cooldown starts (default `5`) |
| `AIP_UPLOAD_FAILURE_WINDOW_MINUTES` | No | Server-only | Lookback window for failed runs used by upload throttle (default `60`) |
| `AIP_UPLOAD_FAILURE_COOLDOWN_MINUTES` | No | Server-only | Cooldown duration after repeated failed runs (default `15`) |
| `BASE_URL` | Yes | Server-only | Absolute app origin for auth page helpers |
| `NEXT_PUBLIC_APP_ENV` | No | Client-exposed | `dev`/`staging`/`prod`; controls mock selection |
| `NEXT_PUBLIC_USE_MOCKS` | No | Client-exposed | Force mock repos when `true` |
| `NEXT_PUBLIC_FEEDBACK_DEBUG` | No | Client-exposed | Feedback debug toggle (`1` enables) |
| `NEXT_PUBLIC_TEMP_ADMIN_BYPASS` | No | Client-exposed | Dev-only bypass toggle |
| `NEXT_PUBLIC_API_BASE_URL` | No | Client-exposed | Optional API base override |
| `PIPELINE_API_BASE_URL` | Yes (chatbot) | Server-only | Internal base URL for pipeline chat endpoint |
| `PIPELINE_HMAC_SECRET` | Yes (chatbot) | Server-only | Shared secret used to sign `x-pipeline-*` chat request headers (`aud|ts|nonce|rawBody`) |
| `PIPELINE_INTERNAL_TOKEN` | No (legacy) | Server-only | Legacy token retained for backward compatibility; unused for `/v1/chat/*` auth |

\* Set at least one of `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Pipeline env reference:
| Variable | Required | Visibility | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes (worker/local run) | Server-only | OpenAI calls for processing stages |
| `SUPABASE_URL` | Yes (queue/API) | Server-only | Supabase REST/storage base |
| `SUPABASE_SERVICE_KEY` | Yes (queue/API) | Server-only | Service key for DB/storage writes |
| `SUPABASE_STORAGE_ARTIFACT_BUCKET` | No | Server-only | Artifact bucket (default `aip-artifacts`) |
| `PIPELINE_MODEL` | No | Server-only | Default LLM model |
| `PIPELINE_EMBEDDING_MODEL` | No | Server-only | Embedding model |
| `PIPELINE_BATCH_SIZE` | No | Server-only | Legacy-compatible max items-per-chunk cap for categorization (default `25`) |
| `PIPELINE_WORKER_POLL_SECONDS` | No | Server-only | Queue poll interval |
| `PIPELINE_WORKER_RUN_ONCE` | No | Server-only | Exit after one polling cycle |
| `PIPELINE_PROGRESS_HEARTBEAT_SECONDS` | No | Server-only | Progress heartbeat interval |
| `PIPELINE_SUMMARIZE_EXPECTED_SECONDS` | No | Server-only | Summarization progress estimate |
| `PIPELINE_SUMMARIZE_CONTEXT_WINDOW_TOKENS` | No | Server-only | Summarization map/reduce context budget target (default `128000`) |
| `PIPELINE_SUMMARIZE_RESPONSE_BUFFER_TOKENS` | No | Server-only | Reserved response token budget for summarization requests (default `2000`) |
| `PIPELINE_SUMMARIZE_PROJECT_FIELD_CHAR_LIMIT` | No | Server-only | Per-field character cap in compact summarization payloads (default `500`) |
| `PIPELINE_VALIDATE_CONTEXT_WINDOW_TOKENS` | No | Server-only | Validation context budget target for project chunking (default `128000`) |
| `PIPELINE_VALIDATE_RESPONSE_BUFFER_TOKENS` | No | Server-only | Reserved response token budget for validation requests (default `2000`) |
| `PIPELINE_VALIDATE_PROJECT_FIELD_CHAR_LIMIT` | No | Server-only | Per-field character cap in compact validation payloads (default `500`) |
| `PIPELINE_CATEGORIZE_CONTEXT_WINDOW_TOKENS` | No | Server-only | Categorization context budget target for project chunking (default `128000`) |
| `PIPELINE_CATEGORIZE_RESPONSE_BUFFER_TOKENS` | No | Server-only | Reserved response token budget for categorization requests (default `2000`) |
| `PIPELINE_CATEGORIZE_PROJECT_FIELD_CHAR_LIMIT` | No | Server-only | Per-field character cap in compact categorization payloads (default `500`) |
| `PIPELINE_EXTRACT_MAX_PAGES` | No | Server-only | Hard page cap per source PDF; fails with `PDF_PAGE_LIMIT_EXCEEDED` (default `200`) |
| `PIPELINE_PARSE_TIMEOUT_SECONDS` | No | Server-only | Timeout budget for initial PDF parse/read (default `20`) |
| `PIPELINE_EXTRACT_TIMEOUT_SECONDS` | No | Server-only | Timeout budget for extraction stage page loop (default `1800`) |
| `PIPELINE_EMBED_TIMEOUT_SECONDS` | No | Server-only | Timeout budget for embedding stage (default `300`) |
| `PIPELINE_RETRY_FAILURE_THRESHOLD` | No | Server-only | Failed-run threshold for worker retry block on same uploader+file (default `5`) |
| `PIPELINE_RETRY_FAILURE_WINDOW_SECONDS` | No | Server-only | Lookback window for retry block evaluation (default `21600`) |
| `PIPELINE_SUPABASE_HTTP_TIMEOUT_SECONDS` | No | Server-only | Timeout for Supabase REST requests made by pipeline adapters (default `120`) |
| `PIPELINE_SUPABASE_DOWNLOAD_TIMEOUT_SECONDS` | No | Server-only | Timeout for signed source-PDF downloads (default `120`) |
| `PIPELINE_SOURCE_PDF_MAX_BYTES` | No | Server-only | Hard byte cap for downloaded source PDFs; fails with `SOURCE_PDF_TOO_LARGE` (default `15728640`) |
| `PIPELINE_ARTIFACT_INLINE_MAX_BYTES` | No | Server-only | Inline vs storage threshold |
| `PIPELINE_ENABLE_RAG` | No | Server-only | Enable optional RAG trace stage |
| `PIPELINE_RAG_TRACE_QUERY` | No | Server-only | Query text used when RAG trace is enabled |
| `PIPELINE_DEV_ROUTES` | No | Server-only | Enables `/v1/runs/dev/local` |
| `PIPELINE_HMAC_SECRET` | Yes (chat route) | Server-only | Shared secret used to verify `x-pipeline-aud/ts/nonce/sig` for `/v1/chat/*` |
| `PIPELINE_INTERNAL_TOKEN` | No (legacy) | Server-only | Legacy token retained for backward compatibility; unused for `/v1/chat/*` auth |
| `PIPELINE_RUNS_HMAC_SECRET` | Yes (`/v1/runs/*`) | Server-only | HMAC secret used to verify run-control request signatures |
| `PIPELINE_RUNS_ALLOWED_AUDIENCES` | Yes (`/v1/runs/*`) | Server-only | Comma-separated allowlist for `aud` header (example `website-backend`) |
| `PIPELINE_RUNS_RATE_LIMIT_WINDOW_SECONDS` | No | Server-only | Sliding-window size for `/v1/runs/*` throttling (default `60`) |
| `PIPELINE_RUNS_RATE_LIMIT_PER_AUD` | No | Server-only | Per-audience request cap per window (default `30`) |
| `PIPELINE_RUNS_RATE_LIMIT_GLOBAL` | No | Server-only | Global request cap per window (default `120`) |
| `PIPELINE_RUNS_NONCE_TTL_SECONDS` | No | Server-only | Replay-protection nonce cache TTL (default `120`) |
| `PIPELINE_RUNS_DEDUPE_TTL_SECONDS` | No | Server-only | Enqueue dedupe cache TTL (default `30`) |
| `PIPELINE_VERSION` | No | Server-only | Overrides pipeline version hash |
| `PIPELINE_PROMPT_SET_VERSION` | No | Server-only | Prompt set version override |
| `PIPELINE_SCHEMA_VERSION` | No | Server-only | Schema version override |
| `PIPELINE_RULESET_VERSION` | No | Server-only | Ruleset version override |
| `API_HOST` | No | Server-only | FastAPI bind host (default `0.0.0.0`) |
| `API_PORT` | No | Server-only | FastAPI port (default `8000`) |
| `LOG_LEVEL` | No | Server-only | API logging level |

### Run Locally (Dev)
1. Apply DB SQL and create storage buckets (see [Database & Migrations](#database--migrations)).
2. Start website:
```bash
cd website
npm run dev
```
3. Start pipeline API (new terminal):
```bash
cd aip-intelligence-pipeline
# activate venv first
openaip-api
```
4. Start pipeline worker (new terminal):
```bash
cd aip-intelligence-pipeline
# activate venv first
openaip-worker
```

Expected outcomes:
- Web app: `http://localhost:3000`
- Pipeline API health: `http://localhost:8000/health`
- Worker logs: `[WORKER] started`
- Uploading an AIP PDF queues a run and updates progress in UI.

## Scripts
Website (`website/package.json`):
| Command | Description |
|---|---|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build (runs DB hardening assertion first) |
| `npm run start` | Start production server |
| `npm run lint` | ESLint checks |
| `npm run test:ui` | Run Vitest UI tests once |
| `npm run test:ui:watch` | Run Vitest in watch mode |

Additional website quality commands:
```bash
cd website
npx tsc --noEmit
node scripts/repo-smoke/run.js
```

Pipeline entry points (`aip-intelligence-pipeline/pyproject.toml`):
| Command | Description |
|---|---|
| `openaip-api` | Run FastAPI service |
| `openaip-worker` | Run queue worker |
| `openaip-cli` | CLI utilities (`run-local`, `worker`, `api`, `versions`, `validate-rules`, `manifest`) |

Pipeline quality commands:
```bash
cd aip-intelligence-pipeline
pytest -q
ruff check src tests
pyright
```

## Database & Migrations
This repo stores SQL migrations in `website/docs/sql` (no Supabase CLI migration directory is committed).

Canonical schema source:
- `website/docs/sql/database-v2.sql`

Mirrored compatibility copy:
- `website/docs/databasev2.txt` (kept synchronized with `database-v2.sql`)

Recommended workflow:
1. Fresh project: run `website/docs/sql/database-v2.sql` in Supabase SQL Editor.
2. Existing project: apply dated patches in ascending order only if your DB predates them:
   - `website/docs/sql/2026-02-13_account_admin_hardening.sql`
   - `website/docs/sql/2026-02-15-projects-financial-expenses.sql`
   - `website/docs/sql/2026-02-19_extraction_run_progress.sql`
   - `website/docs/sql/2026-02-20_submissions_claim_review.sql`
   - `website/docs/sql/2026-02-21_city_aip_project_column_and_publish.sql`
   - `website/docs/sql/2026-02-21_extraction_runs_realtime.sql`
   - `website/docs/sql/2026-02-22_aip_publish_embed_categorize_logging_status.sql`
   - `website/docs/sql/2026-02-22_aip_publish_embed_categorize_logging_status_v2.sql`
   - `website/docs/sql/2026-02-22_aip_publish_embed_categorize_trigger.sql`
   - `website/docs/sql/2026-02-22_aip_publish_embed_categorize_trigger_v2.sql`
   - `website/docs/sql/2026-02-22_aip_storage_cascade_cleanup.sql`
   - `website/docs/sql/2026-02-22_aip_storage_cascade_cleanup_hosted_supabase_fix.sql`
   - `website/docs/sql/2026-02-22_set_config_app_embed.sql`
   - `website/docs/sql/2026-02-22_set_config_app_embed_call.sql`
   - `website/docs/sql/2026-02-24_chatbot_rag_global_scope.sql`
   - `website/docs/sql/2026-02-24_create_aip_totals.sql`
   - `website/docs/sql/2026-02-26_add_information_published_rls_fix.sql`
   - `website/docs/sql/2026-02-26_app_settings_schema_and_grants.sql`
   - `website/docs/sql/2026-02-26_projects_updates_and_media.sql`
   - `website/docs/sql/2026-02-26_projects_status_proposed_rename.sql`
   - `website/docs/sql/2026-02-27_barangay_audit_crud_workflow.sql`
   - `website/docs/sql/2026-02-28_citizen_profile_scope_self_update.sql`
   - `website/docs/sql/2026-02-28_city_audit_crud_workflow.sql`
   - `website/docs/sql/2026-03-01_admin_usage_controls_chat_quota_and_policy_cleanup.sql`
   - `website/docs/sql/2026-03-01_barangay_aip_uploader_workflow_lock.sql`
   - `website/docs/sql/2026-03-01_citizen_about_us_content_settings.sql`
   - `website/docs/sql/2026-03-01_citizen_dashboard_content_settings.sql`
   - `website/docs/sql/2026-03-01_feedback_activity_log_include_citizen.sql`
   - `website/docs/sql/2026-03-01_project_updates_hide_unhide_and_feedback_author_visibility.sql`
   - `website/docs/sql/2026-03-03_embed_categorize_signed_dispatch.sql`
   - `website/docs/sql/2026-03-03_notifications_outbox_tables_rls.sql`
   - `website/docs/sql/2026-03-03_notifications_admin_pipeline_outbox_alerts.sql`
   - Note: `2026-02-26_projects_status_proposed_rename.sql` renames existing `projects.status` values from `planning` to `proposed`.
3. Create Supabase storage buckets manually:
   - `aip-pdfs` (uploaded source PDFs)
   - `aip-artifacts` (pipeline artifacts when payload exceeds inline threshold)
   - `project-media` (private project cover/update images served via API proxy)
   - `about-us-docs` (citizen about-us reference docs used by `content.citizen_about_us`)

### DB Hardening Gate (March 2026)
Deploy/build safety gate:
- `website/scripts/assert-db-hardening.ts` calls fixed RPC `public.inspect_required_db_hardening()`.
- Build fails if required March hardening objects are missing or stale.
- `cd website && npm run build` now runs `npm run db:assert-hardening` before `next build`.

Required env for the assertion:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Run locally:
```bash
cd website
npm run db:assert-hardening
```

Sample PASS output:
```text
[db-hardening] PASS
[db-hardening] Validated 7 required checks.
  - OK can_manage_barangay_aip_exists: public.can_manage_barangay_aip(uuid)
  - OK can_edit_aip_uses_uploader_lock: public.can_edit_aip(uuid)
  - OK can_upload_aip_pdf_uses_uploader_lock: public.can_upload_aip_pdf(uuid)
  - OK aips_update_policy_uses_uploader_lock: public.aips.aips_update_policy
  - OK uploaded_files_select_policy_uses_can_read_aip: public.uploaded_files.uploaded_files_select_policy
  - OK chat_rate_events_status_constraint_exists: public.chat_rate_events.chat_rate_events_event_status_check
  - OK consume_chat_quota_exists: public.consume_chat_quota(uuid, int, int, text)
```

Sample FAIL output:
```text
[db-hardening] FAIL
[db-hardening] Required checks: 7, returned checks: 7
[db-hardening] Missing/stale required DB objects:
  - can_manage_barangay_aip_exists: function public.can_manage_barangay_aip(uuid) | Function exists for barangay uploader workflow lock.
```

### Publish-Time Categorize Embedding
When an AIP transitions to `published`, DB trigger `trg_aip_published_embed_categorize` asynchronously calls the Edge Function `embed_categorize_artifact` via `pg_net`.

Files added for this flow:
- SQL patch: `website/docs/sql/2026-02-22_aip_publish_embed_categorize_trigger.sql`
- SQL patch: `website/docs/sql/2026-02-22_aip_publish_embed_categorize_trigger_v2.sql`
- SQL patch (logging/status + retry RPC): `website/docs/sql/2026-02-22_aip_publish_embed_categorize_logging_status.sql`
- SQL patch (logging/status + retry RPC): `website/docs/sql/2026-02-22_aip_publish_embed_categorize_logging_status_v2.sql`
- SQL patch (signed dispatch headers + request_id payload): `website/docs/sql/2026-03-03_embed_categorize_signed_dispatch.sql`
- Edge Function: `supabase/functions/embed_categorize_artifact/index.ts`

Required configuration:
1. Edge Function environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
   - `EMBED_CATEGORIZE_JOB_SECRET`
   - `EMBED_CATEGORIZE_JOB_AUDIENCE` (recommended; default in function is `embed-categorize-dispatcher`)
   - `EMBED_CATEGORIZE_NONCE_TTL_SECONDS` (optional; default `120`)
   - `EMBED_CATEGORIZE_DEDUPE_TTL_SECONDS` (optional; default `300`)
2. DB setting (required):
   - `app.embed_categorize_url` = full Edge Function invoke URL (for example: `https://<project-ref>.supabase.co/functions/v1/embed_categorize_artifact`)
3. Trigger secret (recommended):
   - Store in Vault with name `embed_categorize_job_secret` (dispatcher reads `vault.decrypted_secrets` first)
   - Use the same value as `EMBED_CATEGORIZE_JOB_SECRET`
4. Dispatcher audience (optional):
   - DB setting `app.embed_categorize_audience` or `app.settings.key = 'embed_categorize_audience'`
   - Must match `EMBED_CATEGORIZE_JOB_AUDIENCE` when set
5. Local/dev fallback secret (optional):
   - `app.embed_categorize_secret` if Vault is unavailable

Example SQL config:
```sql
alter database postgres set app.embed_categorize_url = 'https://<project-ref>.supabase.co/functions/v1/embed_categorize_artifact';
alter database postgres set app.embed_categorize_secret = 'dev-only-secret';
alter database postgres set app.embed_categorize_audience = 'embed-categorize-dispatcher';
```

Local/hosted test flow:
1. Deploy or serve the Edge Function with JWT verification disabled for trigger-origin calls.
2. Apply SQL migration `website/docs/sql/2026-03-03_embed_categorize_signed_dispatch.sql`.
3. Ensure `app.embed_categorize_url`, secret config, and optional audience config are set.
4. Publish an AIP (`under_review` -> `published`).
5. Verify output rows in:
   - `public.aip_chunks` with `metadata.source = 'categorize_artifact'`
   - `public.aip_chunk_embeddings` with `embedding_model = 'text-embedding-3-large'`

Observe indexing status:
```sql
select
  id,
  aip_id,
  stage,
  status,
  overall_progress_pct,
  progress_message,
  error_code,
  error_message,
  started_at,
  finished_at,
  created_at
from public.extraction_runs
where stage = 'embed'
order by created_at desc;
```

Edge Function logs:
```bash
supabase functions logs --name embed_categorize_artifact
```

Manual/retry indexing:
- API: `POST /api/barangay/aips/[aipId]/embed/retry`
- API: `POST /api/city/aips/[aipId]/embed/retry`
- DB dispatcher RPC used by retry routes: `public.dispatch_embed_categorize_for_aip(p_aip_id uuid)`
- Route behavior:
  - Dispatch allowed when latest embed state is `missing`, `failed`, or `succeeded` with skip message (`No categorize artifact; skipping.`)
  - Returns `409` when indexing is already running or already ready
  - Returns `503` when dispatch config is missing (`app.embed_categorize_url` / job secret)
  - Returns `401` in edge logs when signed header verification fails (bad timestamp/signature/replay/audience mismatch)

Edge-function unit-ish tests:
```bash
deno test --allow-env supabase/functions/embed_categorize_artifact/index.test.ts
```

Related docs:
- `website/docs/SUPABASE_MIGRATION.md`
- `website/docs/sql/database-v2.sql`
- `aip-intelligence-pipeline/src/openaip_pipeline/resources/manifests/pipeline_versions.yaml`

## Notifications & Outbox
Schema and DB objects (March 2026 baseline):
- `public.notifications`
- `public.notification_preferences`
- `public.email_outbox`
- `public.emit_admin_pipeline_job_failed()` with trigger `trg_extraction_runs_emit_admin_pipeline_failed`

Notification APIs in website:
- `GET /api/notifications`
- `GET /api/notifications/unread-count`
- `PATCH /api/notifications/[notificationId]/read`
- `POST /api/notifications/read-all`
- `GET /api/notifications/open?next=...&notificationId=...|dedupe=...`

Tracked-open behavior:
- `notifications-inbox` links call `/api/notifications/open` with a safe internal `next` path.
- The open route marks read by `notificationId` or `dedupe` then returns `307`.
- Unsafe paths are rejected and redirected to `/`.

Outbox processor:
- Edge Function: `supabase/functions/send-email-outbox/index.ts`
- Authorization: requires bearer JWT with `role=service_role`.
- Reads queued rows from `public.email_outbox`, sends via Resend, updates status/attempt counters.
- Emits hourly deduped admin notifications when failure threshold is exceeded (`OUTBOX_FAILURE_THRESHOLD_REACHED`).

Outbox function required env:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `FROM_EMAIL`
- `APP_BASE_URL`

Outbox function optional tuning env:
- `EMAIL_OUTBOX_BATCH_SIZE` (default `25`)
- `EMAIL_OUTBOX_MAX_ATTEMPTS` (default `5`)
- `EMAIL_OUTBOX_FAILURE_THRESHOLD_PER_HOUR` (default `20`)

## Auth & Authorization
- Session/auth gate is enforced in `website/proxy.ts` via `website/lib/supabase/proxy.ts`.
- Role mapping uses DB roles: `citizen`, `barangay_official`, `city_official`, `municipal_official`, `admin`.
- Route-role mapping is implemented in `website/lib/auth/roles.ts`.
- Protected upload/retry APIs are under:
  - `website/app/api/barangay/aips/**`
  - `website/app/api/city/aips/**`
- Authorization checks include role/scope checks and Supabase RPCs (`can_upload_aip_pdf`, `can_edit_aip`).
- Row-level security policies are defined in `website/docs/sql/database-v2.sql` for major tables (`aips`, `projects`, `feedback`, `aip_reviews`, `chat_*`, `activity_log`, `extraction_*`).

## Storage / File Handling
- Upload route handlers accept PDF only and enforce:
  - MIME/extension checks plus `%PDF-` magic-byte header validation.
  - `AIP_UPLOAD_MAX_BYTES` (default 15 MB).
  - per-uploader cooldown after repeated failed runs (`AIP_UPLOAD_FAILURE_*`), returning HTTP `429` with `Retry-After`.
- Source files are uploaded to bucket `aip-pdfs` and metadata is written to `public.uploaded_files`.
- Citizen about-us reference documents are served from `about-us-docs` (configured via `content.citizen_about_us` in `app.settings`).
- Extraction runs are queued in `public.extraction_runs`.
- Worker downloads source PDFs using signed URLs with configured timeout and size bounds (`PIPELINE_SUPABASE_DOWNLOAD_TIMEOUT_SECONDS`, `PIPELINE_SOURCE_PDF_MAX_BYTES`).
- Worker enforces extraction page/parse/elapsed bounds and embedding timeout, and persists explicit failure reason codes in `public.extraction_runs.error_code`.
- Artifact payloads are stored directly in `artifact_json` using the stage contract (`aip_artifact_v1.x.x`).
- Web repo generates short-lived signed URLs when serving PDF references (10-minute TTL in current implementation).

## Testing & Quality
Website:
```bash
cd website
npm run lint
npm run test:ui
npx tsc --noEmit
node scripts/repo-smoke/run.js
```

Pipeline:
```bash
cd aip-intelligence-pipeline
# activate venv and ensure dev extras are installed
pytest -q
ruff check src tests
pyright
```

Current test coverage in repo includes:
- UI/component and hook tests under `website/features/**/*.test.ts(x)`
- Repo smoke checks under `website/tests/repo-smoke/**`
- Pipeline smoke/resource/rules/worker-sanitization tests under `aip-intelligence-pipeline/tests/**`

## Deployment Guide
- For the full UI-first production + preview deployment runbook (Vercel website + Render pipeline + Supabase), see [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

## Deployment
Website (Next.js):
```bash
cd website
npm ci
npm run build
npm run start
```

Pipeline (Docker Compose, API + worker):
```bash
cd aip-intelligence-pipeline
docker compose up --build
```

Pipeline (separate images):
```bash
cd aip-intelligence-pipeline
docker build -f Dockerfile.api -t openaip-pipeline-api .
docker build -f Dockerfile.worker -t openaip-pipeline-worker .
```

Production runtime requirements:
- Website envs: `NEXT_PUBLIC_SUPABASE_URL`, publishable/anon key, `SUPABASE_SERVICE_ROLE_KEY`, `BASE_URL` (optional: `SUPABASE_STORAGE_ARTIFACT_BUCKET`, `SUPABASE_STORAGE_PROJECT_MEDIA_BUCKET`, `AIP_UPLOAD_MAX_BYTES`, `AIP_UPLOAD_FAILURE_THRESHOLD`, `AIP_UPLOAD_FAILURE_WINDOW_MINUTES`, `AIP_UPLOAD_FAILURE_COOLDOWN_MINUTES`)
- Pipeline envs: `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (recommended guardrails: `PIPELINE_EXTRACT_MAX_PAGES`, `PIPELINE_PARSE_TIMEOUT_SECONDS`, `PIPELINE_EXTRACT_TIMEOUT_SECONDS`, `PIPELINE_EMBED_TIMEOUT_SECONDS`, `PIPELINE_RETRY_FAILURE_THRESHOLD`, `PIPELINE_RETRY_FAILURE_WINDOW_SECONDS`, `PIPELINE_SUPABASE_HTTP_TIMEOUT_SECONDS`, `PIPELINE_SUPABASE_DOWNLOAD_TIMEOUT_SECONDS`, `PIPELINE_SOURCE_PDF_MAX_BYTES`)
- Outbox function envs (if using email notifications): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`, `APP_BASE_URL` (optional: `EMAIL_OUTBOX_BATCH_SIZE`, `EMAIL_OUTBOX_MAX_ATTEMPTS`, `EMAIL_OUTBOX_FAILURE_THRESHOLD_PER_HOUR`)
- Supabase project with DB schema and storage buckets in place
- `app.settings` schema/table available to service role, with seeded keys `content.citizen_about_us` and `content.citizen_dashboard`
- Outbound network access from pipeline runtime to Supabase + OpenAI

Common hosting options for this codebase:
- Website: any Next.js-capable Node host
- Pipeline: any container host running API + worker
- Data/auth/storage: Supabase managed project

## Security
- Auth/session enforcement is centralized in `website/lib/supabase/proxy.ts`.
- Keep service keys server-only:
  - `SUPABASE_SERVICE_ROLE_KEY` (`website`)
  - `SUPABASE_SERVICE_KEY` (`aip-intelligence-pipeline`)
  - `OPENAI_API_KEY` (`aip-intelligence-pipeline`)
- Never expose server secrets as `NEXT_PUBLIC_*`.
- `.env.local` and `.env` are ignored by git; do not commit generated env files.
- Pipeline error sanitization redacts secrets before persisting failure artifacts (`_sanitize_error` in `worker/processor.py`).
- Vulnerability reporting: use private security reporting channels (GitHub Security Advisories if enabled) and notify maintainers directly.
- Chatbot rollout checklist: `website/docs/CHATBOT_PRODUCTION_CHECKLIST.md`.

## Observability
- Worker lifecycle logs are emitted to stdout (`[WORKER] started`, claimed/succeeded/failed run logs).
- API health endpoints:
  - `GET /` returns service status
  - `GET /health` returns status + version
- Run progress is persisted on `public.extraction_runs`:
  - `overall_progress_pct`
  - `stage_progress_pct`
  - `progress_message`
  - `progress_updated_at`
- UI realtime subscription for run updates is implemented in `website/features/aip/hooks/use-extraction-runs-realtime.ts`.
- Realtime publication setup is handled by `website/docs/sql/2026-02-21_extraction_runs_realtime.sql`.

## Troubleshooting
| Issue | Likely Cause | Fix |
|---|---|---|
| `Missing NEXT_PUBLIC_SUPABASE_URL...` at runtime | Supabase public env vars not set in `website/.env.local` | Set `NEXT_PUBLIC_SUPABASE_URL` and one of `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`, then restart `npm run dev` |
| `BASE_URL environment variable is not configured` on auth pages | `BASE_URL` missing | Set `BASE_URL=http://localhost:3000` for local dev |
| Upload endpoint returns `Unauthorized` or `You cannot upload for this AIP right now.` | Role/scope mismatch or DB function/policies not applied | Ensure user profile role/scope is correct and SQL from `website/docs/sql/database-v2.sql` is applied |
| Upload fails with `Invalid PDF file header. Expected %PDF- magic bytes.` | Uploaded file is not a real PDF payload | Re-export/upload a valid PDF file; do not rely on extension only |
| Upload fails with `File too large...` | File exceeded `AIP_UPLOAD_MAX_BYTES` | Increase `AIP_UPLOAD_MAX_BYTES` carefully or upload a smaller PDF |
| Upload fails with HTTP `429` and `upload_throttled` | Uploader hit repeated failed-run cooldown window | Wait for `Retry-After` or adjust `AIP_UPLOAD_FAILURE_*` thresholds |
| Upload fails with storage error (`bucket not found` / permissions) | Missing `aip-pdfs` bucket or storage misconfiguration | Create `aip-pdfs` bucket in Supabase Storage; verify service role key is valid |
| Draft delete fails with `Failed to delete one or more AIP files from storage. Draft was not deleted.` | Strict delete gate blocked DB delete because one or more storage objects could not be removed | Verify `aip-pdfs`/artifact bucket objects still exist, service role key has storage delete permission, and `SUPABASE_STORAGE_ARTIFACT_BUCKET` matches your artifact bucket |
| Worker exits/fails with progress-column error | DB missing run progress columns | Apply `website/docs/sql/2026-02-19_extraction_run_progress.sql` (or full `database-v2.sql`) |
| UI does not receive live progress updates | Realtime publication not configured | Apply `website/docs/sql/2026-02-21_extraction_runs_realtime.sql` |
| Runs stay `queued` forever | Worker not running or cannot claim runs | Start `openaip-worker`; verify pipeline `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` |
| Worker fails with `OPENAI_API_KEY not found` | Missing OpenAI secret in pipeline env | Set `OPENAI_API_KEY` in `aip-intelligence-pipeline/.env` |
| Run fails with `error_code=PDF_PAGE_LIMIT_EXCEEDED` | PDF page count exceeded `PIPELINE_EXTRACT_MAX_PAGES` | Increase cap if acceptable or upload smaller PDFs |
| Run fails with `error_code=PARSE_TIMEOUT` / `EXTRACT_TIMEOUT` / `EMBED_TIMEOUT` | Stage exceeded configured timeout budget | Tune relevant `PIPELINE_*_TIMEOUT_SECONDS` values and inspect problematic PDF complexity |
| Run fails with `error_code=SOURCE_PDF_TOO_LARGE` | Downloaded source PDF exceeded `PIPELINE_SOURCE_PDF_MAX_BYTES` | Increase cap carefully or reject/replace oversized source file |
| Run fails with `error_code=RUN_RETRY_BLOCKED` | Same uploader+file exceeded retry-failure threshold in lookback window | Wait for `PIPELINE_RETRY_FAILURE_WINDOW_SECONDS` or adjust retry guardrail envs |
| `POST /v1/runs/dev/local` returns 403 | Dev routes disabled | Set `PIPELINE_DEV_ROUTES=true` in pipeline env |
| `POST /v1/runs/*` returns 401 | Missing/invalid `aud`/`ts`/`nonce`/`sig`, stale `ts`, replayed nonce, or audience not allowlisted | Set `PIPELINE_RUNS_HMAC_SECRET` and `PIPELINE_RUNS_ALLOWED_AUDIENCES`; sign request body/path/method correctly and keep clock skew within ±60s |
| `POST /v1/chat/*` returns 401 | Missing/invalid `x-pipeline-aud`/`x-pipeline-ts`/`x-pipeline-nonce`/`x-pipeline-sig`, stale `ts`, invalid `aud`, bad signature, or replayed `(aud,nonce,ts,body)` | Set matching `PIPELINE_HMAC_SECRET` on website + pipeline; sign `aud|ts|nonce|rawBody`, keep clock skew within ±60s, and send unique nonce per request |
| `Invalid schema: app` from chatbot/admin settings APIs | Supabase Data API does not expose `app` schema, or `app.settings` is missing/inaccessible | Expose `app` in Supabase Data API schemas and run `website/docs/sql/2026-02-26_app_settings_schema_and_grants.sql` |
| Notifications inbox is empty for events that should notify | Notifications tables/triggers are missing from DB baseline | Apply `website/docs/sql/2026-03-03_notifications_outbox_tables_rls.sql` and `website/docs/sql/2026-03-03_notifications_admin_pipeline_outbox_alerts.sql` (or full `database-v2.sql`) |
| Clicking "Open related page" does not mark rows as read | `GET /api/notifications/open` route not reached (or unsafe `next` path) | Ensure links are built via tracked-open helper and `next` is an internal path beginning with `/` |
| `send-email-outbox` returns 401/500 | Missing service-role bearer auth or missing outbox env values | Invoke with service-role JWT and set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`, `APP_BASE_URL` |
| Citizen about-us/dashboard content does not load seeded values | `app.settings` seeds not applied or `about-us-docs` bucket missing | Apply March 1 content seed SQL files and create/verify `about-us-docs` bucket objects |
| `pytest`/`ruff`/`pyright` command not found | Dev extras not installed | Reinstall with `python -m pip install -e ".[dev]"` |
| `Fatal error in launcher` when running `pip` inside pipeline venv | Venv launchers still point to old folder path after rename | Recreate `.venv`, then use `python -m pip install --upgrade pip` and `python -m pip install -e ".[dev]"` |

## Contributing
Branch strategy (aligned with existing branch layout in repo):
1. Start from `integration` for feature work.
2. Use short-lived branches like `feature/<scope>-<name>` or `fix/<scope>-<name>`.
3. Merge feature/fix branches into `integration`.
4. Promote `integration` into `main` for release.

PR checklist:
- [ ] Scope is focused and linked to an issue/task
- [ ] `website`: `npm run lint`, `npm run test:ui`, and `npx tsc --noEmit` pass
- [ ] `aip-intelligence-pipeline`: `pytest -q` (and `ruff`/`pyright` when applicable) pass
- [ ] No secrets or real credentials are committed
- [ ] SQL/schema changes are documented in `website/docs/sql`
- [ ] README/docs are updated for behavior, env, or workflow changes
- [ ] UI/API changes include at least one validation path for reviewers

## License
TBD (no repository `LICENSE` file is currently committed).

## Maintainers / Contact
- Maintainers: TBD
- Engineering contact: `engineering@your-org.example` (placeholder)
- Security contact: `security@your-org.example` (placeholder)
