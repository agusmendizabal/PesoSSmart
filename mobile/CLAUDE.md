# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Start Expo dev server (Metro bundler)
npm run android    # Run on Android device/emulator
npm run ios        # Run on iOS simulator (Mac only)
```

No lint or test scripts are configured. There is no build step — Expo handles bundling.

To deploy edge functions:
```bash
cd mobile
npx supabase functions deploy <function-name>
# e.g. npx supabase functions deploy gmail-poll
```

## Architecture

This is a React Native / Expo app for Argentine personal finance. All source lives under `mobile/`.

### Routing

Expo Router (file-based). Three route groups:
- `(auth)/` — login, register, forgot-password. No auth required.
- `(onboarding)/` — 4-step financial profiling. Requires auth, runs once.
- `(app)/` — 5-tab main app. Requires auth + `onboarding_completed = true`.

`app/index.tsx` is the smart redirect that checks session + profile state and routes accordingly. `app/_layout.tsx` initializes auth, loads fonts, and wires the `onSessionExpired` listener that redirects to login.

### State Management

Four Zustand stores in `src/store/`:

| Store | Manages |
|---|---|
| `authStore` | Supabase session, `User`, `Profile`, sign-in/up/out |
| `onboardingStore` | Multi-step form data, saves to `financial_profiles` / `user_interests` / `risk_profiles` |
| `expensesStore` | Expenses list, filters, category totals, subscription detection, month projections |
| `goalsStore` | Savings goals CRUD |

### Supabase Client (`src/lib/supabase.ts`)

The client has two non-obvious behaviors:

1. **Global 401 interceptor** — `fetchWithAuthRetry` wraps all requests to `/functions/v1/`. On 401, it refreshes the session and retries once. Prevents an infinite loop with `_isRefreshing` flag.
2. **Session expiry callbacks** — `onSessionExpired(cb)` / `notifySessionExpired()`. `app/_layout.tsx` registers a listener that calls `router.replace('/(auth)/login')`.

### Edge Functions (`supabase/functions/`, Deno runtime)

| Function | Purpose |
|---|---|
| `gmail-auth` | OAuth2 flow with Google. GET `?action=url` returns auth URL; GET `?code=` exchanges code and stores tokens; DELETE disconnects. |
| `gmail-poll` | Scans Gmail for bank emails, classifies with Groq `llama-3.3-70b-versatile`, inserts into `pending_transactions`. |
| `ai-advisor` | Financial chatbot. Fetches user context + macro data (BCRA/inflation), calls Groq. |
| `process-screenshot` | Two-stage OCR: `llama-3.2-11b-vision-preview` extracts text, then `llama-3.3-70b-versatile` parses into structured expenses. |

All edge functions do their own JWT validation via `GET /auth/v1/user`. **"Verify JWT with legacy secret" must be OFF** in Supabase → Edge Functions → Settings for each function, because they handle auth themselves.

### Database Conventions

- `expenses.user_id` is a FK to `public.profiles(id)`, not `auth.users(id)` directly. A trigger `on_auth_user_created` → `handle_new_user()` creates the profile row on signup. If a user exists in `auth.users` without a `profiles` row, all expense inserts will fail with FK violation.
- Expenses use **soft delete**: `deleted_at` timestamp, never hard-deleted. All queries filter `.is('deleted_at', null)`.
- `pending_transactions.raw_subject` stores the Gmail `message.id` (not the email subject text). The UNIQUE constraint `(user_id, raw_subject)` deduplicates by Gmail message ID.
- `gmail_connections.last_checked_at` is only advanced when Groq has no failures, so emails that fail classification are retried on the next poll.

### Theme

Dark-only, brutalista style. No border-radius on interactive elements. Key values in `src/theme/`:
- `colors.neon` — primary accent (`#C6F135`)
- `colors.bg.primary` — main background
- `colors.text.secondary/tertiary` — for labels and metadata

Typography uses `Text` component from `src/components/ui/Text.tsx` with `variant` prop — use this instead of raw RN `Text`.

### Multi-currency

Expenses are stored in ARS. USD expenses are converted at save time using the live blue/oficial/MEP rate from `bluelytics.com.ar/v2/latest`. The rate is fetched fresh at the moment of saving (`fetchDolarRateNow(type)` in `src/hooks/useDolarRates.ts`), not cached.

### Environment Variables

Client-side (`.env`):
```
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
```

Edge function secrets (Supabase dashboard or `supabase secrets set`):
```
GROQ_API_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```
