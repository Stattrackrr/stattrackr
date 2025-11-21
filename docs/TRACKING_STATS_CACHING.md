# Tracking Stats Caching System

## Overview

The tracking stats (potentials) system uses server-side caching to provide instant loading for all teams. It fetches data once per day and caches it, eliminating slow NBA API calls during normal usage.

## How It Works

### 1. **Bulk Data Fetching** (`/api/tracking-stats/refresh`)
- Fetches **ALL** NBA teams' tracking stats in just **2 API calls**:
  - Call 1: League-wide passing stats (all players, all teams)
  - Call 2: League-wide rebounding stats (all players, all teams)
- Processes and caches data for all 30 teams
- Cache TTL: **24 hours** (tracking stats update once daily)

### 2. **Background Scheduler** (`lib/trackingStatsScheduler.ts`)
- Automatically refreshes tracking stats every 24 hours
- Starts on server initialization (production only)
- Initial refresh runs 5 seconds after server startup
- No user interaction needed

### 3. **Client Queries** (`/api/tracking-stats/team`)
- **Zero API calls** for cached data - reads from server cache
- Instant response for all teams and categories
- Falls back to live API fetch if:
  - Cache miss (data not yet cached)
  - Opponent filter applied (requires filtered query)
  - Force refresh requested (`?refresh=1`)

## Benefits

### Performance
- **Instant loading**: No waiting for NBA API responses
- **Reduced load**: Only 2 API calls per day instead of hundreds
- **Consistent UX**: Same fast experience for all users

### Reliability
- **No rate limits**: Cached data doesn't count against API quotas
- **Fault tolerance**: If refresh fails, cache stays valid for 24h
- **Graceful degradation**: Falls back to live API if needed

## API Usage

### Daily NBA API Calls
```
Scheduled refresh: 2 calls/day (passing + rebounding)
Fallback requests: Minimal (only for cache misses or opponent filters)

Total: ~2-10 calls/day (vs. ~100+ without caching)
```

### Endpoints

#### `/api/tracking-stats/refresh` (Internal)
Called automatically by scheduler. Manual trigger for testing:
```bash
curl http://localhost:3000/api/tracking-stats/refresh?season=2025
```

Response:
```json
{
  "success": true,
  "teamsProcessed": 30,
  "categoriesProcessed": 2,
  "season": "2025-26",
  "apiCalls": 2,
  "elapsed": "3456ms",
  "cachedAt": "2025-11-21T12:00:00Z",
  "ttl": "1440 minutes"
}
```

#### `/api/tracking-stats/team?team=LAL&category=passing` (Public)
Get cached tracking stats for a specific team:
```bash
curl http://localhost:3000/api/tracking-stats/team?team=LAL&category=passing&season=2025
```

Response (from cache):
```json
{
  "team": "LAL",
  "season": "2025-26",
  "category": "passing",
  "players": [
    {
      "playerId": "2544",
      "playerName": "LeBron James",
      "gp": 20,
      "potentialAst": 12.5,
      "ast": 8.2,
      "astPtsCreated": 18.4,
      "passesMade": 52.1,
      "astToPct": 0.158
    }
  ],
  "cachedAt": "2025-11-21T12:00:00Z"
}
```

#### Force Refresh
Add `?refresh=1` to bypass cache and fetch fresh data:
```bash
curl http://localhost:3000/api/tracking-stats/team?team=LAL&category=passing&refresh=1
```

## Cache Configuration

### Location
- **File**: `lib/cache.ts`
- **TTL**: 24 hours (`CACHE_TTL.TRACKING_STATS`)
- **Cache keys**:
  - Per-team: `tracking_stats_{TEAM}_{SEASON}_{CATEGORY}`
  - All data: `all_tracking_stats_{SEASON}`

### Cache Headers
```http
Cache-Control: public, s-maxage=86400, stale-while-revalidate=172800
X-Cache-Status: HIT | MISS
```

- `s-maxage=86400`: CDN caches for 24 hours
- `stale-while-revalidate=172800`: Serve stale data for 48h while revalidating

## Monitoring

### Cache Status
Check if data is being served from cache by looking at response headers:
- `X-Cache-Status: HIT` - Served from cache (fast)
- `X-Cache-Status: MISS` - Fetched from NBA API (slower, then cached)

### Scheduler Status
The scheduler runs silently in the background. Check logs for:
```
[Tracking Stats Scheduler] 🚀 Starting scheduler (24-hour interval)
[Tracking Stats Scheduler] 🔄 Starting refresh...
[Tracking Stats Scheduler] ✅ Refresh complete: { teamsProcessed: 30, ... }
```

### Manual Refresh
To manually trigger a cache refresh:
```bash
curl http://localhost:3000/api/tracking-stats/refresh?season=2025
```

## Deployment

### Environment Variables
No additional environment variables needed! Uses existing cache infrastructure.

### Production Initialization
The scheduler automatically starts in production via `instrumentation.ts`:
```typescript
if (process.env.VERCEL_ENV === 'production') {
  startTrackingStatsScheduler();
}
```

### Development
In development, the scheduler does NOT auto-start to avoid unnecessary API calls.
- Manually trigger refresh when needed: `curl http://localhost:3000/api/tracking-stats/refresh`
- Cache persists across hot reloads

## Troubleshooting

### Slow Loading
- Check `X-Cache-Status` header - should be `HIT`
- If `MISS`, run manual refresh: `/api/tracking-stats/refresh`
- Check server logs for scheduler errors

### Stale Data
- Tracking stats update once daily (typically overnight)
- Force refresh: Add `?refresh=1` to query
- Manual bulk refresh: Call `/api/tracking-stats/refresh`

### Missing Players
- Ensure player has played this season (stats only available for active players)
- Check if refresh completed successfully (30 teams processed)
- Verify player is on the correct team roster

## Comparison with Depth Chart Caching

Both systems use similar patterns:
- **Depth Chart**: 2-hour TTL, fetches per-team on demand
- **Tracking Stats**: 24-hour TTL, pre-fetches all teams in bulk

Tracking stats uses longer TTL and bulk fetching because:
1. Data updates less frequently (daily vs. hourly)
2. More expensive to fetch (large league-wide datasets)
3. Predictable usage (every team needs it)


