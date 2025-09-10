# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Project: StatTrackr (Next.js App Router + Supabase)

Commands
- Install deps:
  - npm ci
- Dev server (hot reload):
  - npm run dev
- Build (production):
  - npm run build
- Start (serve production build):
  - npm run start
- Lint:
  - npm run lint

Notes
- Environment variables (required for Supabase in browser):
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY
  Provide these in .env.local during local dev. Do not print them to the terminal.
- Ports: README suggests default Next.js port 3000; AUTH_SETUP testing section references 3001 for /journal. If you change the dev port, ensure links are consistent.
- Database schema is defined in supabase_schema.sql; run it in Supabase SQL Editor before testing features that persist data.

Common Dev Tasks
- Run a single route/page in isolation: navigate directly in the browser to the route under app/ (e.g., /journal, /login, /account). Next.js App Router compiles per route.
- Type-check (implicit in build since noEmit is true):
  - npx tsc --noEmit

Architecture Overview
- Framework
  - Next.js App Router (app/ directory). Root layout at app/layout.tsx sets global styles and document shell. The home route is app/page.tsx.
- Authentication & Client
  - lib/supabaseClient.ts initializes two Supabase browser clients using NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
    - supabase: persists session via localStorage (storageKey: sb-auth-token).
    - supabaseSessionOnly: persists session via sessionStorage (storageKey: sb-session-token) for non-remember-me flows.
  - hooks/useSessionManager.ts enforces auth on client routes by:
    - Checking both clients for an active session on mount; redirects to /login if none.
    - Subscribing to auth state changes; on SIGNED_OUT, it clears local keys and redirects to /login.
    - Exposes signOut() to trigger logout via supabase.auth.signOut().
- Core Feature: Journal
  - app/journal/page.tsx (client component) implements the main tracking UI including:
    - Data model aligned with public.bets (see supabase_schema.sql): id, user_id, date, sport, market, selection, stake, currency (AUD|USD|GBP|EUR), odds, result (win|loss|void), timestamps.
    - UI state for bet entry/editing; charts via recharts (LineChart, BarChart, PieChart, etc.).
    - Enumerations for sports, markets per sport, currencies; helpers for date and currency formatting.
  - Row-level security ensures users only see their own data; client queries must include authenticated context.
- Other Routes & Components
  - app/login/page.tsx provides email/password and Google OAuth login UI (see AUTH_SETUP.md).
  - app/account/page.tsx provides account settings UI.
  - app/research/page.tsx exists for auxiliary features/experiments.
  - components/: navigation.tsx, site-header.tsx, StatTrackrLogo.tsx compose shared UI elements.
- Styling
  - TailwindCSS configured via tailwind.config.ts and app/globals.css. Brand colors applied via CSS variables on html/body.

Data & Security
- supabase_schema.sql sets up the bets table with indexes, RLS, and triggers:
  - Policies restrict all CRUD to rows where auth.uid() = user_id.
  - updated_at is auto-managed by a trigger.
- Ensure Supabase Authentication settings align with AUTH_SETUP.md (e.g., disable Captcha per doc to avoid local login issues).

Important Setup From AUTH_SETUP.md
- Run the SQL in supabase_schema.sql in your Supabase project.
- Optional: enable Google OAuth and set the redirect URI to https://<your-project-id>.supabase.co/auth/v1/callback.
- For local testing, the journal path /journal redirects to /login when not authenticated; after login, it returns to /journal.

How to Run/Debug
- Start dev server, then navigate:
  - /login to test auth; create an account or sign in.
  - /journal to test CRUD and charts (requires authenticated session).
  - /account to test account settings.
- To validate type safety without building:
  - npx tsc --noEmit
- To format and lint code issues:
  - npm run lint (uses eslint and eslint-config-next). Prettier is present; invoke manually if desired.

Cross-References
- README.md contains standard Next.js quickstart and links to framework docs; prioritize commands above when operating within Warp.
- Refer to AUTH_SETUP.md for Supabase-specific setup and local auth troubleshooting.

