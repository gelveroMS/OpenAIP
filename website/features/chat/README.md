# Chat Feature Guide

## A. Purpose
Provide the LGU chatbot experience with persisted chat sessions/messages and server-side answer generation.

## B. UI Surfaces
Route wiring:
- Active UI: `app/(lgu)/barangay/(authenticated)/chatbot/page.tsx`
- Placeholders (not fully rolled out):  
  - `app/(lgu)/city/(authenticated)/chatbot/page.tsx`  
  - `app/(citizen)/chatbot/page.tsx`

Feature files:
- `features/chat/views/lgu-chatbot-view.tsx`
- `features/chat/hooks/use-lgu-chatbot.ts`
- `features/chat/components/*`

API routes:
- `app/api/barangay/chat/sessions/route.ts`
- `app/api/barangay/chat/sessions/[sessionId]/messages/route.ts`
- `app/api/barangay/chat/messages/route.ts`

## C. Data Flow
UI hook (`use-lgu-chatbot`)
-> barangay chat API routes
-> `getChatRepo()` from `lib/repos/chat/repo.server.ts`
-> selector-based adapter:
  - mock: `lib/repos/chat/repo.mock.ts`
  - supabase: `lib/repos/chat/repo.supabase.ts`

Notes:
- `lib/repos/chat/repo.ts` is client-safe and throws outside mock mode.
- server route handlers are the source of truth for assistant/system message writes.

## D. databasev2 Alignment
Primary tables:
- `public.chat_sessions`
- `public.chat_messages`

Key rules:
- sessions are user-scoped (RLS ownership checks),
- messages are append-only,
- client-side writes are restricted to `role='user'`.

## E. Current Implementation Status
- Barangay chatbot route is active.
- Session and user-message persistence support mock and Supabase modes.
- Assistant responses are produced in `app/api/barangay/chat/messages/route.ts` and persisted server-side.
- City and citizen chatbot pages are intentionally placeholder-only at this time.

## F. Testing Checklist
Manual:
- Create session, send message, reload, and confirm history persists.
- Confirm unauthorized roles receive `401` from barangay chat APIs.
- Confirm placeholder routes render for city/citizen chatbot paths.

Automated:
- `features/chat/*.test.ts`
- `features/chat/components/*.test.tsx`

## G. Pitfalls
- Do not expose assistant/system writes to client-side direct inserts.
- Keep role/scope authorization checks aligned with route-level guards.

## H. Additional Software Components Found in the Repository
| Software / Tool | Purpose in the System | Category |
| --- | --- | --- |
| React | Powers the component-based UI layer used across dashboards, chat interfaces, and portal pages. | Frontend Library |
| React DOM | Handles browser rendering and hydration for the React-based Next.js frontend. | Frontend Runtime |
| Node.js | Runs the Next.js server, build scripts, and local development tooling. | Runtime Environment |
| npm | Manages JavaScript/TypeScript dependencies and project scripts for the web application. | Package Manager |
| Supabase JavaScript SDK (`@supabase/supabase-js`) | Enables typed database, auth, and storage operations from web/server modules. | Backend / SDK |
| Supabase SSR (`@supabase/ssr`) | Supports authenticated Supabase usage in server-rendered Next.js routes and middleware/proxy flows. | Backend / SSR Integration |
| Supabase Edge Functions (Deno runtime) | Runs serverless tasks such as embedding/categorization dispatch and email outbox processing. | Serverless / Backend Runtime |
| Radix UI (`@radix-ui/*`) | Provides accessible low-level primitives used by shadcn/ui components (dialogs, tabs, selects, etc.). | UI Primitives Library |
| React Hook Form | Manages form state and validation flows in interactive UI forms. | Form Management Library |
| Zod | Defines and validates runtime schemas for safer request/response and form data handling. | Validation Library |
| Recharts | Renders dashboard data visualizations and charts for analytics-style views. | Data Visualization Library |
| Leaflet + React-Leaflet | Provides map visualization and geospatial UI features in the web interface. | Mapping Library |
| PDF.js (`pdfjs-dist`) | Supports client-side PDF viewing/inspection workflows in the frontend. | Document Rendering Library |
| Framer Motion | Adds animation and transition behavior to selected interface components. | UI Animation Library |
| Playwright | Runs end-to-end testing across desktop and mobile browser configurations. | Testing / E2E Automation |
| Vitest | Executes unit and component tests for frontend features and utilities. | Testing Framework |
| Testing Library (`@testing-library/react`, `@testing-library/jest-dom`) | Provides UI-focused component testing utilities and DOM assertions. | Testing Utility Library |
| ESLint | Enforces code quality and consistency rules for the web codebase. | Static Analysis / Linting |
| Docker + Docker Compose | Containerizes and orchestrates the pipeline API and worker services for local/prod-like runs. | Containerization / DevOps |
| Uvicorn | Serves the FastAPI application for the AI pipeline HTTP service. | ASGI Server |
| Pytest | Runs automated tests for the Python pipeline services and workflows. | Testing Framework |
| Ruff | Performs fast Python linting for code quality in the pipeline package. | Static Analysis / Linting |
| Pyright | Provides static type checking for Python modules in the AI pipeline. | Static Type Checker |
| PyTorch (`torch`) | Supports model and embedding-related computation dependencies in the AI pipeline stack. | Machine Learning Framework |
| Sentence Transformers (`sentence-transformers`) | Supports embedding and semantic-text processing utilities used in NLP workflows. | NLP / Embedding Library |
| PDFPlumber (`pdfplumber`) | Extracts structured text/tables from PDF files during document processing stages. | Document Processing Library |
| Resend API | Sends transactional notification emails from the Supabase email outbox function. | External Email Service |
