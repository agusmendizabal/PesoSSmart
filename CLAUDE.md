# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

```
/
├── mobile/          ← React Native / Expo app (all active development)
│   ├── app/         ← Expo Router screens (file-based routing)
│   ├── src/         ← stores, components, lib, utils, theme, types
│   └── supabase/    ← edge functions, migrations, SQL schema
└── supabase/        ← legacy root-level supabase dir (not in active use)
```

All development happens inside `mobile/`. The root `supabase/` directory is stale — use `mobile/supabase/` for schema, migrations, and edge functions.

## Commands

Run from `mobile/`:

```bash
npm start              # Expo dev server (Metro)
npm run android        # Android device/emulator
npm run ios            # iOS simulator (Mac only)

# Deploy a single edge function
npx supabase functions deploy <function-name>
# e.g.: npx supabase functions deploy ai-advisor
```

No lint, test, or build scripts are configured.

## Architecture

Detailed architecture is documented in [mobile/CLAUDE.md](mobile/CLAUDE.md). Key points:

- **Stack**: React Native + Expo SDK 54, Expo Router, Supabase, Zustand, Groq (via edge functions)
- **Routing**: Three groups — `(auth)/`, `(onboarding)/`, `(app)/`. Smart redirect at `app/index.tsx` checks session + `onboarding_completed`.
- **State**: Zustand stores in `src/store/`. `planStore` must be loaded explicitly — not auto-loaded at login.
- **AI**: Groq API is only called server-side via Supabase edge functions (`ai-advisor`, `gmail-poll`). The API key never touches the client.

## Critical Conventions

### UI Components
- Always use `Text` from `src/components/ui/Text.tsx` with a `variant` prop — never raw RN `Text`.
- Font: **Montserrat only**. `DMSans` was removed — never use `DMSans_*` families.
- Design is **dark-only**, brutalismo style: `border-radius: 0`, neon accent `#C6F135`.

### Database
- Expenses use **soft delete** (`deleted_at`). All queries must filter `.is('deleted_at', null)`.
- `INCOME_RANGE_MAP` (ARS midpoint values) must stay in sync between `src/store/expensesStore.ts` and `supabase/functions/ai-advisor/index.ts`.
- The `profiles` row is created by a DB trigger on `auth.users` insert — missing profile = FK violation on all expense inserts.

### Edge Functions
- Two auth patterns, by function type: user-facing functions (`ai-advisor`, `investment-advisor`, `gmail-poll`, `mp-poll`, `transcribe`) are deployed with Gateway JWT verification **ON** (`verify_jwt=true` — Supabase rejects invalid/missing JWTs before the function code runs); server-to-server functions with no end-user session (cron jobs `fetch-market-rates`/`cedear-sync`/`indec-sync`, webhooks `mp-webhook`, internal calls `send-push`/`advisor-sunday`) are deployed with `--no-verify-jwt` and instead check a shared secret in the `Authorization` header (`MARKET_RATES_SYNC_SECRET`, `CEDEAR_SYNC_SECRET`, `INDEC_SYNC_SECRET`, `MP_WEBHOOK_SECRET`, `INTERNAL_FN_SECRET`) — always fail-closed (reject if the secret env var is missing) with an exact string comparison, never `.includes()`.
- The 3 cron secrets are stored in Supabase Vault, not hardcoded in migration SQL — `cron_secrets_vault.sql` reads them via `vault.decrypted_secrets` at execution time.
- `INTERNAL_FN_SECRET` gates `send-push`/`advisor-sunday`; any function that calls them (`gmail-poll`, `mp-poll`, `mp-webhook`) must send it, not the service role key.
- The `ai-advisor` function returns HTTP 429 `{ error: 'limit_reached' }` when the monthly message limit is exceeded. The client shows a paywall Alert — not a chat error bubble.
- RPCs invoked from an edge function with a client-supplied `user_id` (e.g. `increment_ai_usage`) must be called with the ANON key + the caller's real `Authorization` header (not the service role key) so `auth.uid()` inside the RPC reflects the real caller — the RPC itself then validates `auth.uid() = p_user_id`.

### Freemium
- Plans: `free` (15 msg/mo), `pro` (100 msg/mo), `premium` (unlimited). New users get a 30-day premium trial via DB trigger.
- `resolveEffectivePlan()` in `src/lib/plans.ts` is the single source of truth for the effective plan.

## Environment Variables

Client (`.env` inside `mobile/`):
```
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
```

Edge function secrets (Supabase dashboard or `supabase secrets set`):
```
GROQ_API_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
MARKET_RATES_SYNC_SECRET
CEDEAR_SYNC_SECRET
INDEC_SYNC_SECRET
MP_WEBHOOK_SECRET
INTERNAL_FN_SECRET
```
