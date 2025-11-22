# NBA League Data Cache Background Job

## Overview

To prevent API timeouts when multiple users access the app, we've implemented a server-side caching system that pre-fetches all league-wide NBA API data in the background.

## How It Works

1. **Background Job**: A cron job runs daily at 2 AM UTC (`/api/cache/nba-league-data`)
2. **Data Fetched**:
   - All play type defensive rankings (for all 11 play types, all 30 teams)
   - All zone defense rankings (for all 6 zones, all 30 teams)
3. **Caching**: Data is cached for 24 hours using `CACHE_TTL.TRACKING_STATS`
4. **API Routes**: All API routes now read from cache instead of making live API calls

## Cron Configuration

The cron job is configured in `vercel.json`:

```json
{
  "path": "/api/cache/nba-league-data?season=2025",
  "schedule": "0 2 * * *"
}
```

This runs daily at 2 AM UTC.

## Manual Trigger

To manually trigger the background job (e.g., after deployment or to refresh cache):

```bash
# With authentication (if CRON_SECRET is set)
curl -X GET "https://your-domain.com/api/cache/nba-league-data?season=2025" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# Without authentication (if CRON_SECRET is not set, for development)
curl -X GET "https://your-domain.com/api/cache/nba-league-data?season=2025"
```

## Environment Variables

Optional: Set `CRON_SECRET` in your environment variables to protect the endpoint:

```env
CRON_SECRET=your-secret-key-here
```

## Cache Keys

- Play Type Rankings: `playtype_defensive_rankings_{season}`
- Zone Rankings: `zone_defensive_rankings_{season}`

## API Routes Updated

The following routes now use cached data instead of making live API calls:

1. **`/api/play-type-analysis`**: Uses cached play type defensive rankings
2. **`/api/team-defense-rankings`**: Uses cached zone rankings from background job
3. **`/api/shot-chart-enhanced`**: Uses cached zone rankings via team-defense-rankings

## Benefits

- ✅ No API timeouts when multiple users access the app
- ✅ Faster response times (data is pre-cached)
- ✅ Reduced load on NBA API
- ✅ More reliable service

## Troubleshooting

If rankings show as N/A:
1. Check if the background job has run: Look for logs in Vercel
2. Manually trigger the job (see above)
3. Check cache expiration: Cache lasts 24 hours
4. Verify NBA API is accessible from your server


