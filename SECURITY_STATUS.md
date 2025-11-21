## StatTrackr Security Status — November 19, 2025

### Recent Improvements
- **Cron endpoint hardening**: `/api/cron/auto-ingest`, `/api/check-bets`, `/api/check-tracked-bets`, and `/api/check-journal-bets` now require a shared secret (`CRON_SECRET`) via `Authorization` or `X-Cron-Secret` headers and enforce strict rate limiting.
- **Environment validation**: All cron/Stripe/Supabase helpers now throw if required environment variables are missing, preventing silent fallbacks.
- **Reduced production logging**: High-volume bet-auditing routes log detailed information only outside production, limiting sensitive data exposure.
- **Secure internal calls**: `check-bets` now authenticates its internal requests to dependent cron routes, so they can no longer be triggered anonymously.

### Recommended Next Steps
1. Rotate and store `CRON_SECRET` (and other API keys) in a centralized secret manager (Vercel, Doppler, 1Password Secrets Automation, etc.).
2. Extend the cron authorization helper to support signed Vercel cron requests when deploying there.
3. Audit remaining API routes for explicit auth + rate limiting (focus on `/api/dvp/*`, `/api/odds/*`, and any payment-related endpoints).
4. Replace ad-hoc console logging with a structured logger (pino/winston) so sensitive data never goes to stdout in production.
5. Add integration tests that assert 401/429 responses when cron secret is missing or invalid.



