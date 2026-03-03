# Chatbot Production Checklist

## Security and Secret Hygiene
- Rotate `SUPABASE_SERVICE_ROLE_KEY` before production rollout.
- Rotate `SUPABASE_SERVICE_KEY` used by `aip-intelligence-pipeline`.
- Rotate `OPENAI_API_KEY`.
- Set and store `PIPELINE_HMAC_SECRET` in your secret manager (do not hardcode).
- Keep `PIPELINE_INTERNAL_TOKEN` only for legacy compatibility; chat routes no longer use it.
- Confirm no real credentials are committed to git history.

## Environment Configuration
- Website:
  - `PIPELINE_API_BASE_URL`
  - `PIPELINE_HMAC_SECRET`
- Pipeline:
  - `PIPELINE_HMAC_SECRET`
  - `PIPELINE_INTERNAL_TOKEN` (legacy/unused for chat auth)
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY`
  - `OPENAI_API_KEY`

## Database
- Apply `website/docs/sql/2026-02-24_chatbot_rag_global_scope.sql`.
- Verify `public.match_published_aip_chunks` executes with service role.
- Verify assistant citation check constraint blocks assistant inserts without citations.
- Verify `consume_chat_quota` and `purge_chat_data_older_than` execute with service role.

## Runtime Verification
- Confirm `/api/barangay/chat/messages` returns cited answers.
- Confirm pipeline rejects unsigned or stale `/v1/chat/*` requests with `401`.
- Confirm replaying the same signed `aud+ts+nonce+body` is rejected with `401`.
- Confirm default retrieval spans published AIPs globally.
- Confirm explicit scope prompts narrow retrieval (`our barangay`, `barangay X`, etc.).
- Confirm unresolved/ambiguous scope prompts return clarification refusal.
- Confirm city and citizen chatbot pages show "Coming Soon".
