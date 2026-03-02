# AFL Odds (The Odds API)

AFL game odds (moneyline, spread, total goals) are powered by **The Odds API** (v4). NBA odds remain on BallDontLie.

## Setup

1. Get a free API key from [the-odds-api.com](https://the-odds-api.com/).
2. Add to `.env.local`:
   ```bash
   ODDS_API_KEY=your_key_here
   ```
3. (Optional) Trigger a one-time refresh so the cache is warm:
   ```bash
   curl http://localhost:3000/api/afl/odds/refresh
   ```

## How it works

- **Refresh:** `GET /api/afl/odds/refresh` fetches all AFL games and odds from The Odds API (`aussierules_afl`, region `au`) and caches them in memory. Cache TTL uses the same as NBA odds (see `CACHE_TTL.ODDS` in `lib/cache.ts`).
- **Game odds:** `GET /api/afl/odds?team=...&opponent=...&game_date=...` returns bookmaker rows (H2H, Spread, Total) for the matching game. If the cache is empty, a refresh is triggered once.
- **Parlay game search:** The Add to Journal modal (AFL) calls `/api/afl/odds` with no params to list games for search.
- **Player props:** `/api/afl/player-props` is implemented but currently returns no lines (manual entry only). When The Odds API supports AFL player props in your plan, you can extend the refresh to fetch them and fill this route from the same cache.

## Free tier

The Odds API free tier has limited requests per month. To reduce usage:

- Call `/api/afl/odds/refresh` via a cron (e.g. every 30–60 minutes) instead of on every page load.
- Increase `CACHE_TTL.ODDS` in `lib/cache.ts` if you want fewer refreshes.

## Paid plan

When you switch to a paid plan, keep the same `ODDS_API_KEY`; no code changes required. You can add AFL player props and/or historical odds by extending `lib/refreshAflOdds.ts` and the cache shape.
