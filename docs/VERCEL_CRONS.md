# Verifying Vercel Cron Jobs

Quick reference to confirm crons are configured and running on Vercel.

## Current crons (from `vercel.json`)

| Path | Schedule (UTC) | Purpose |
|------|----------------|---------|
| `/api/check-journal-bets` | Every 10 min | Journal bet status checks |
| `/api/odds/cleanup` | Daily 00:00 | Clean up old odds |
| `/api/cron/cleanup-odds-snapshots` | Daily 00:00 | Clean up odds snapshots |
| `/api/afl/odds/refresh` | 00:00, 03:00, 06:00 … 21:00 (on the hour) | AFL game odds + player props list |
| `/api/afl/odds/refresh` | 01:30, 04:30, 07:30 … 22:30 | Same (offset run) |
| `/api/afl/props-stats/warm` | 00:20, 03:20, 06:20 … 21:20 | AFL L5/L10/H2H/Season/Streak stats cache |
| `/api/afl/props-stats/warm` | 01:50, 04:50, 07:50 … 22:50 | Same (offset run) |

AFL runs: odds refresh ~16×/day; props-stats warm ~16×/day (after each odds run).

## How Vercel invokes crons

- Vercel sends a **GET** request to the path on the schedule.
- It adds the header **`x-vercel-cron: 1`**, which our `authorizeCronRequest()` accepts, so **no `CRON_SECRET` is required** for scheduled runs.
- **`CRON_SECRET`** is only for **manual** runs (e.g. `curl ...?secret=YOUR_CRON_SECRET` or `Authorization: Bearer YOUR_CRON_SECRET`).

## How to confirm they work on Vercel

### 1. Crons are registered

- Vercel Dashboard → your **Project** → **Settings** → **Crons** (or **Functions** → Crons).
- You should see the paths above and their schedules. If the list is empty, `vercel.json` may not be deployed or Crons may not be enabled for the project/plan.

### 2. Check execution and logs

- **Deployments** → pick a deployment → **Functions** (or **Logs**).
- Filter by the cron path (e.g. `api/afl/odds/refresh` or `api/afl/props-stats/warm`).
- After a scheduled time (e.g. on the hour for AFL odds), you should see a log entry for that path. Success = 200 and any `[AFL cron]` / `[AFL props-stats/warm]` messages you log.

### 3. Confirm AFL crons specifically

- **Odds refresh:** After a run, open the Props page → AFL tab. You should see games and prop lines. Or call `GET /api/afl/odds` (or your cache-status endpoint if you have one) and confirm games are present.
- **Props-stats warm:** After a run, AFL props should show L5, L10, H2H, Season, Streak. If they’re still empty, check logs for `[AFL props-stats/warm]` errors (e.g. no props in cache → run odds/refresh first).

### 4. Manual test (optional)

To trigger the same handlers manually (e.g. to test without waiting for the schedule):

```bash
# Use your production URL and CRON_SECRET from Vercel env vars
curl "https://YOUR_DOMAIN.vercel.app/api/afl/odds/refresh?secret=YOUR_CRON_SECRET"
curl "https://YOUR_DOMAIN.vercel.app/api/afl/props-stats/warm?secret=YOUR_CRON_SECRET"
```

- 200 + JSON body = success.
- 401 = wrong/missing secret or not using `x-vercel-cron` (scheduled runs use the header).

## Required environment variables (for crons to succeed)

- **AFL odds/refresh:** `ODDS_API_KEY` (The Odds API).
- **AFL props-stats/warm:** Same as above; also needs game logs. Set `CRON_SECRET` if you call the warm endpoint manually. For **scheduled** Vercel runs, `CRON_SECRET` is optional (auth is via `x-vercel-cron`).
- **AFL cache (stats/game logs):** Upstash: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`; optional `AFL_USE_UPSTASH_CACHE=true` if your app checks it.

## If a cron doesn’t run or returns 401

- **Not running:** Confirm Crons are enabled for the project and that the deployment includes the latest `vercel.json`. Re-deploy if you recently added/changed crons.
- **401 Unauthorized:** For **scheduled** runs, the app must receive `x-vercel-cron: 1`. Don’t remove the check for that header in `authorizeCronRequest()`. For **manual** runs, ensure `CRON_SECRET` in Vercel matches the value you pass (e.g. in `?secret=` or `Authorization: Bearer`).

## Schedule format (reminder)

```
minute  hour  day-of-month  month  day-of-week
0       0,3,6,9,12,15,18,21  *  *  *   → 00:00, 03:00, …, 21:00 UTC
20      0,3,6,9,12,15,18,21  *  *  *   → 00:20, 03:20, …, 21:20 UTC
```

So AFL odds refresh runs on the hour; props-stats warm runs 20 minutes past the hour (so props list exists before warming stats).
