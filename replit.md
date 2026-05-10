# FitConnect

A production-ready AI-powered fitness coaching PWA with Claude AI coach, macro tracking, walking route generation, and push notifications.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, served at `/api`)
- `pnpm --filter @workspace/fitconnect run dev` — run the React PWA (served at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, TailwindCSS, Wouter routing, Zustand, React Query, react-i18next (EN/FR)
- API: Express 5 + Claude `claude-sonnet-4-5` via Anthropic SDK
- DB: PostgreSQL (Replit) + Drizzle ORM — daily logs, walking routes
- Auth/Profiles: Supabase (`profiles` table must exist in Supabase project)
- Walking routes: OpenRouteService API
- Push notifications: OneSignal
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/fitconnect/src/pages/` — AuthPage, OnboardingPage, HomePage, CoachPage, TrackPage, WalkPage
- `artifacts/fitconnect/src/components/layout/BottomNav.tsx` — 4-tab mobile navigation
- `artifacts/fitconnect/src/store/useAppStore.ts` — Zustand state (user, profile, messages)
- `artifacts/fitconnect/src/i18n/index.ts` — EN/FR translations
- `artifacts/fitconnect/src/lib/supabase.ts` — Supabase client (auto-corrects short project IDs to full URLs)
- `artifacts/api-server/src/routes/` — ai.ts, logs.ts, walk.ts, notifications.ts
- `lib/api-spec/` — OpenAPI spec (source of truth for API contract)
- `lib/api-client-react/` — generated React Query hooks
- `lib/api-zod/` — generated Zod validators
- `lib/db/src/schema/` — daily_logs.ts, walking_routes.ts

## Architecture decisions

- Contract-first API: OpenAPI spec → Orval codegen → React Query hooks + Zod validators (run codegen after any spec changes)
- Supabase handles auth and the `profiles` table (user metadata, goals, calorie targets, streak). Replit PostgreSQL handles app data (daily logs, walking routes).
- The `VITE_SUPABASE_URL` env var may be stored as just the project ID; `lib/supabase.ts` auto-converts it to the full `https://<id>.supabase.co` URL.
- Coach messages are persisted in a `coach_messages` Supabase table (create it in the Supabase dashboard).
- Progress photos are stored in a Supabase Storage bucket named `progress-photos` (create it in the Supabase dashboard).

## Product

- **Auth**: Email/password + Google OAuth via Supabase
- **Onboarding**: 4-step flow (language, goal, body stats, diet preferences) with auto-calculated calorie/protein targets using Mifflin-St Jeor BMR
- **Home**: Greeting, streak counter, daily macro rings, quick-action buttons, weekly calorie bar chart
- **Coach**: AI chat powered by Claude, bilingual (EN/FR), 4 daily check-in slots (morning/lunch/evening/night)
- **Track**: Today/history/photos tabs — log meals (with AI macro estimation), workouts, weight; macro rings; weight trend chart
- **Walk**: Generate 3 walking routes via ORS with target (calories/minutes/km), real-time timer, save completed walks

## User preferences

- Mobile-first, bottom nav 4 tabs: Home / Coach / Track / Walk
- Design: bg=#FAFAF7, primary=#00C853 (green), orange=#FF6B35, purple=#6C5CE7, cyan=#00B8D4
- Bilingual: English + French (react-i18next)
- No AI disclaimers on coach check-ins; disclaimers on chat messages

## Gotchas

- Must create `profiles` table in Supabase manually (or via migration) — columns: id, email, full_name, language, goal, weight_kg, height_cm, age, gender, level, diet_preferences (jsonb), daily_calorie_target, daily_protein_target, streak_count, checkin_times (jsonb), last_checkin_date
- Must create `coach_messages` table in Supabase: id, user_id, role, content, type, read, created_at
- Must create `progress-photos` Supabase Storage bucket (public)
- After any OpenAPI spec change, run codegen before typechecking
- API server Claude model: `claude-sonnet-4-5` (exact ID, no date suffix)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
