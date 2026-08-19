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
# e.g. npx supabase functions deploy ai-advisor
```

## Architecture

React Native / Expo (SDK 54) app for Argentine personal finance. All source lives under `mobile/`. TypeScript throughout.

### Routing

Expo Router (file-based). Three route groups:

- `(auth)/` — login, register, forgot-password. No auth required.
- `(onboarding)/` — 4-step financial profiling (financial-profile → interests → risk-profile → gmail-connect). Runs once on first login.
- `(app)/` — 5-tab main app. Requires auth + `onboarding_completed = true`.

`app/index.tsx` is the smart redirect that checks session + profile state. `app/_layout.tsx` initializes auth, loads fonts, and wires the `onSessionExpired` listener. Hidden tabs (no tab bar entry) are registered with `options={{ href: null }}` — currently: `advisor`, `grupo-familia`, `plans`, `simulator`.

### State Management

Five Zustand stores in `src/store/`:

| Store | Manages |
|---|---|
| `authStore` | Supabase session, `User`, `Profile`, sign-in/up/out, `updateProfile` |
| `onboardingStore` | Multi-step form data, saves to `financial_profiles` / `user_interests` / `risk_profiles` |
| `expensesStore` | Expenses list, pagination, filters (`month`, `year`, `classification`, `search`), category totals, subscription detection, income/projection |
| `goalsStore` | Savings goals CRUD |
| `planStore` | Subscription plan, trial state, monthly message usage counter |

`planStore` must be loaded explicitly (`load(userId)`) — it is called in `advisor.tsx` and `profile.tsx` on mount. It is not auto-loaded at login.

### Freemium System

Plans: `free` (15 msg/month), `pro` ($3.990, 100 msg/month), `premium` ($7.990, unlimited). New users receive a 30-day premium trial automatically via a DB trigger.

Key files:
- `src/lib/plans.ts` — `PLANS`, `PLAN_MSG_LIMITS`, `resolveEffectivePlan()`, `trialDaysLeft()`
- `src/store/planStore.ts` — loads plan + usage, `canSendMessage()`, `incrementUsage()`, `isTrialActive()`, `daysLeftInTrial()`
- `app/(app)/plans.tsx` — upgrade screen with plan cards and comparison table

`resolveEffectivePlan(rawPlan, subscriptionStatus, planExpiresAt)` is the single source of truth for the effective plan. It returns `'free'` when `status` is not `'active'` or an unexpired `'trial'`.

The `ai-advisor` edge function validates message limits server-side (returns 429 with `{ error: 'limit_reached' }`). The frontend handles 429 by showing a paywall Alert — it does NOT show it as a chat error bubble.

**DB schema additions for freemium:**
- `profiles`: `plan_expires_at TIMESTAMPTZ`, `trial_used BOOLEAN`, `trial_started_at TIMESTAMPTZ`
- `ai_usage (user_id, month TEXT, msg_count INTEGER)` — PK is `(user_id, month)` where month is `'YYYY-MM'`. Monthly reset is implicit: a new month = new row.
- RPC `increment_ai_usage(p_user_id, p_month)` — atomic upsert, returns new count. Uses `SECURITY DEFINER` to bypass RLS.
- Trigger `trigger_trial_on_signup` BEFORE INSERT on `profiles` — sets 30-day premium trial for all new users.

### Supabase Client (`src/lib/supabase.ts`)

Two non-obvious behaviors:

1. **Global 401 interceptor** — `fetchWithAuthRetry` wraps all requests to `/functions/v1/`. On 401, refreshes the session and retries once. Prevents infinite loops with `_isRefreshing` flag.
2. **Session expiry callbacks** — `onSessionExpired(cb)` / `notifySessionExpired()`. `app/_layout.tsx` registers a listener that calls `router.replace('/(auth)/login')`.

### Edge Functions (`supabase/functions/`, Deno runtime)

| Function | Purpose |
|---|---|
| `gmail-auth` | OAuth2 flow with Google. GET `?action=url` returns auth URL; GET `?code=` exchanges code; DELETE disconnects. |
| `gmail-poll` | Scans Gmail for bank emails, classifies with Groq `llama-3.3-70b-versatile`, inserts into `pending_transactions`. |
| `ai-advisor` | Financial chatbot. Fetches user context from DB + macro data (BCRA/inflation API), validates message limits, calls Groq. Supports `generate_welcome: true` for auto-generated opening message. |
| `process-screenshot` | Two-stage OCR: `llama-3.2-11b-vision-preview` extracts text, then `llama-3.3-70b-versatile` parses into structured expenses. |

User-facing functions (`ai-advisor`, `investment-advisor`, `gmail-poll`, `mp-poll`, `transcribe`) are deployed with Gateway JWT verification **ON** (`verify_jwt=true`), so Supabase rejects invalid/missing JWTs before the function code runs. Server-to-server functions with no end-user session (cron jobs, `mp-webhook`, `send-push`/`advisor-sunday`) are deployed with `--no-verify-jwt` and instead check a shared secret in `Authorization` — see root `CLAUDE.md` for the full list. `create-payment` additionally does its own JWT validation in code via `GET /auth/v1/user`.

#### AI Advisor — key patterns

- `generate_welcome: true` + `initial_context?: string` — generates personalized opening message. Does NOT appear as a user bubble. Does NOT count against the message limit.
- `client_context` object — pre-computed in `advisor.tsx` from `expensesStore`, sent on every message. Includes `month_total`, `income`, `income_pct`, `month_status` (`'good'|'tight'|'over'`), `necessary`, `disposable`, `disposable_pct`, `investable`, `recoverable`.
- `history` — last 8 messages sent for context.
- The edge function merges `client_context` over DB-fetched data (client data is more current for the current month).

### Database Conventions

- `expenses.user_id` is FK to `public.profiles(id)`. A trigger `on_auth_user_created` → `handle_new_user()` creates the profile row on signup. Missing profile row = FK violation on all expense inserts.
- Expenses use **soft delete**: `deleted_at` timestamp. All queries filter `.is('deleted_at', null)`.
- `pending_transactions.raw_subject` stores the Gmail `message.id`. UNIQUE `(user_id, raw_subject)` deduplicates.
- Income ranges in `financial_profiles.income_range` map to midpoint ARS values (2026 scale) — the same `INCOME_RANGE_MAP` must be kept in sync between `expensesStore.ts` and `ai-advisor/index.ts`.

### Theme & Typography

Dark-only theme. Key values in `src/theme/`:
- `colors.neon` — primary accent (`#C6F135`, used for CTAs and highlights)
- `colors.primary` — blue (`#82b1ff`)
- `colors.bg.primary/card/elevated` — background hierarchy
- `colors.text.primary/secondary/tertiary` — text hierarchy

**Always use the `Text` component** from `src/components/ui/Text.tsx` with the `variant` prop. Never use raw RN `Text`. Available variants: `h3`, `h4`, `subtitle`, `body`, `bodySmall`, `label`, `labelMd`, `caption`, `numberLg`.

**Font: Montserrat only.** `DMSans` was removed — never use `DMSans_*` font families anywhere.

### Multi-currency

Expenses stored in ARS. USD expenses are converted at save time using a live rate fetched from `bluelytics.com.ar/v2/latest` via `fetchDolarRateNow(type)` in `src/hooks/useDolarRates.ts`. Rate is never cached — always fetched fresh at the moment of saving.

### Screens Overview

| Screen | Path | Notes |
|---|---|---|
| Home | `(app)/home.tsx` | KPI card, thermometer, goals, recent expenses, subscriptions, simulator promo |
| Expenses | `(app)/expenses.tsx` | FlatList with month selector + classification filter + search, stats tab, edit/delete modal, Gmail polling, screenshot OCR |
| Reports | `(app)/reports.tsx` | Monthly intelligence report: MonthStatusBanner, CategoryBreakdown (horizontal bars, no SVG), inflation thermometer, comparisons, DineroRecuperable, plan projections |
| Advisor | `(app)/advisor.tsx` | AI chat with auto-generated welcome, freemium limit enforcement, quick actions |
| Plans | `(app)/plans.tsx` | Upgrade screen with trial banner, usage bar, plan cards (premium→pro→free), comparison table |
| Simulator | `(app)/simulator.tsx` | Investment simulator: 5 instruments (FCI MM, Lecaps, PF UVA, MEP, Cedears), compound return vs inflation chart |
| Profile | `(app)/profile.tsx` | Plan card with trial banner + usage bar, Gmail connection, edit modal |

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
