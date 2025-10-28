# Odds System Architecture

## Overview

The odds system is designed to minimize API calls while keeping data fresh. It uses a bulk fetch + cache strategy.

## How It Works

### 1. **Bulk Data Fetching** (`/api/odds/refresh`)
- Fetches **ALL** NBA games and odds in just **2 API calls**:
  - Call 1: Game odds (H2H, Spreads, Totals)
  - Call 2: Player props (Points, Rebounds, Assists)
- Transforms and caches data in a single server-side cache entry
- Cache TTL: **17 minutes**

### 2. **Background Scheduler** (`lib/oddsScheduler.ts`)
- Automatically refreshes odds every 17 minutes
- Starts on server initialization
- No user interaction needed

### 3. **Client Queries** (`/api/odds`)
- **Zero API calls** - reads from server cache
- Filters cached data by team or player
- Returns formatted odds to client

## API Usage

### With Free Tier (500 requests/month)
```
Daily usage: 2 calls × (24 hours ÷ 17 minutes) = ~170 calls/day
Monthly: ~5,100 calls WITHOUT the free tier limit

With 500 calls/month: ~8.3 calls/day = ~1 refresh every 3 hours
```

### Endpoints

#### `/api/odds/refresh` (Internal)
Called automatically by scheduler. Manual trigger for testing:
```bash
curl http://localhost:3000/api/odds/refresh
```

Response:
```json
{
  "success": true,
  "gamesCount": 12,
  "lastUpdated": "2024-01-27T12:00:00Z",
  "nextUpdate": "2024-01-27T12:17:00Z",
  "apiCalls": 2,
  "elapsed": "1234ms"
}
```

#### `/api/odds?team=LAL` (Public)
Get game odds for a specific team:
```bash
curl http://localhost:3000/api/odds?team=LAL
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "name": "DraftKings",
      "H2H": { "home": "-150", "away": "+130" },
      "Spread": { "line": "-3.5", "over": "-110", "under": "-110" },
      "Total": { "line": "225.5", "over": "-110", "under": "-110" }
    }
  ],
  "lastUpdated": "2024-01-27T12:00:00Z",
  "nextUpdate": "2024-01-27T12:17:00Z"
}
```

#### `/api/odds?player=LeBron+James` (Public)
Get player prop odds:
```bash
curl "http://localhost:3000/api/odds?player=LeBron+James"
```

## Setup

1. Add API key to `.env.local`:
```bash
ODDS_API_KEY=your_key_here
```

2. Restart dev server:
```bash
npm run dev
```

3. Verify scheduler started (check console):
```
🚀 Starting odds scheduler (refresh every 17 minutes)
🔄 Triggering scheduled odds refresh...
✅ Scheduled odds refresh complete: 12 games, 2 API calls
```

## Cache Structure

```typescript
{
  games: [
    {
      gameId: "abc123",
      homeTeam: "Los Angeles Lakers",
      awayTeam: "Boston Celtics",
      commenceTime: "2024-01-27T19:00:00Z",
      bookmakers: [ /* BookRow[] */ ],
      playerProps: {
        "LeBron James": {
          PTS: { line: "27.5", over: "-110", under: "-110", books: ["DraftKings"] },
          REB: { line: "7.5", over: "-120", under: "+100", books: ["FanDuel"] }
        }
      }
    }
  ],
  lastUpdated: "2024-01-27T12:00:00Z",
  nextUpdate: "2024-01-27T12:17:00Z"
}
```

## Monitoring

Check cache status:
```javascript
// In Next.js API route or server component
import cache from '@/lib/cache';

const oddsCache = cache.get('all_nba_odds');
console.log(oddsCache);
```

## Optimization Tips

1. **Free Tier**: Set `CACHE_TTL.ODDS` to `180` (3 hours) in `lib/cache.ts`
2. **Production**: Use external scheduler (cron job, Vercel Cron) to call `/api/odds/refresh`
3. **Multiple Apps**: Share cache via Redis instead of in-memory

## Troubleshooting

### No odds data showing
1. Check if scheduler started: Look for startup logs
2. Manually trigger refresh: `curl http://localhost:3000/api/odds/refresh`
3. Check API key is set: `echo $ODDS_API_KEY`

### High API usage
- Increase `CACHE_TTL.ODDS` in `lib/cache.ts`
- Check for duplicate scheduler instances
- Verify cache is persisting between refreshes
