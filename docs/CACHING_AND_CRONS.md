# Caching System & Cron Jobs Documentation

## Overview

The system uses a **two-tier caching architecture**:
1. **In-Memory Cache** (`lib/cache.ts`) - Fast, per-instance cache
2. **Supabase Persistent Cache** (`lib/nbaCache.ts`) - Shared across all Vercel instances

## Caching Architecture

### 1. In-Memory Cache (`lib/cache.ts`)

**Purpose:** Fast, per-server-instance cache for frequently accessed data.

**Characteristics:**
- **Max Size:** 1,000 entries
- **Eviction:** LRU (Least Recently Used) when full
- **TTL:** Configurable per data type (see `CACHE_TTL` constants)
- **Auto-cleanup:** Expired entries removed every 10 minutes
- **Scope:** Per Vercel serverless function instance (not shared)

**Cache TTLs:**
```typescript
PLAYER_STATS: 8 hours      // Game stats finalized after games end
PLAYER_SEARCH: 24 hours    // Roster data changes infrequently
GAMES: 5 hours            // Schedule updates multiple times per day
ESPN_PLAYER: 24 hours     // Player profiles rarely change
ADVANCED_STATS: 1 hour    // Computationally expensive, needs regular updates
ODDS: 30 minutes          // Odds refresh every 30 minutes via cron
DEPTH_CHART: 8 hours      // Starting lineups change daily
INJURIES: 30 minutes      // Injury status can change quickly
TRACKING_STATS: 365 days  // Effectively never expire (persist until replaced)
```

### 2. Supabase Persistent Cache (`lib/nbaCache.ts`)

**Purpose:** Shared, persistent cache that works across all Vercel instances.

**Characteristics:**
- **Storage:** PostgreSQL database via Supabase
- **Table:** `nba_api_cache`
- **Timeout Protection:** 5-10 second timeouts to prevent blocking
- **Fallback:** If Supabase is slow/unavailable, falls back to in-memory cache
- **Expiration:** Auto-deletes expired entries on read
- **Scope:** Shared across ALL serverless instances

**Cache Flow:**
1. Check Supabase first (persistent, shared)
2. If Supabase timeout/slow → fallback to in-memory cache
3. If both miss → fetch from API and cache in both

**Key Benefits:**
- **Shared State:** All users see the same cached data
- **Persistence:** Survives serverless function cold starts
- **Cost Efficiency:** Reduces API calls across all instances

## Odds Caching System

### Cache Key
```
all_nba_odds_v2_bdl
```

### Data Structure
```typescript
interface OddsCache {
  games: GameOdds[];        // All NBA games with odds
  lastUpdated: string;      // ISO timestamp
  nextUpdate: string;       // ISO timestamp
}
```

### Refresh Strategy

**Automatic Refresh:**
- **Cron Jobs:** Every 3 hours (see `vercel.json`)
- **Background Refresh:** If cache is >45 minutes old, triggers non-blocking refresh
- **On-Demand:** When API endpoint is called with `?refresh=1`

**Refresh Process:**
1. Fetches **ALL** NBA games in 2 API calls:
   - Call 1: Game odds (H2H, Spreads, Totals)
   - Call 2: Player props (Points, Rebounds, Assists, etc.)
2. Transforms data into unified format
3. Saves to both in-memory cache AND Supabase
4. Prunes games that started >1 hour ago (except today/tomorrow games)

**`ensureOddsCache()` Function:**
- Checks if cache exists and is fresh
- If cache is >45 minutes old → triggers background refresh (non-blocking)
- If `force: true` → blocks and waits for refresh
- Prevents concurrent refreshes with `ongoingRefresh` flag

## Production Behavior

### What Production Should See

#### 1. **Odds Data Availability**
- **Fresh Data:** Odds refresh every 3 hours via cron
- **Fallback:** If cron fails, background refresh triggers when cache is >45 minutes old
- **User Experience:** Users always see cached data (even if slightly stale)
- **Loading State:** If no cache exists, API returns `loading: true` and triggers background refresh

#### 2. **Cache Hit Rates**
- **First Request:** May hit Supabase (shared cache) or in-memory cache
- **Subsequent Requests:** Fast in-memory cache hits
- **Cold Starts:** Supabase cache ensures data is available immediately

#### 3. **Performance**
- **API Calls:** Minimized (only 2 calls every 3 hours for ALL games)
- **Response Time:** <100ms for cached data
- **Timeout Protection:** Supabase queries timeout after 5-10s, fallback to in-memory

#### 4. **Error Handling**
- **Supabase Down:** Falls back to in-memory cache
- **API Rate Limited:** Serves cached data even if rate limited
- **No Cache:** Returns `loading: true` and triggers background refresh

### Cache Invalidation

**Manual:**
- `?refresh=1` parameter on API endpoints
- `/api/cache/clear` endpoint (clears all caches)

**Automatic:**
- TTL expiration (based on `CACHE_TTL` constants)
- LRU eviction when cache is full
- Expired entries auto-deleted on read

## Cron Jobs (`vercel.json`)

### Active Cron Jobs

#### 1. **Odds Refresh** (`/api/odds/refresh`)
```json
{
  "path": "/api/odds/refresh",
  "schedule": "0 */3 * * *"        // Every 3 hours at :00
}
{
  "path": "/api/odds/refresh",
  "schedule": "30 1-22/3 * * *"    // Every 3 hours at :30 (1:30 AM - 10:30 PM)
}
```
**Purpose:** Refresh NBA odds data (game odds + player props)
**Frequency:** ~8 times per day
**API Calls:** 2 calls per run (game odds + player props)

#### 2. **Player Props Refresh** (`/api/cron/refresh-player-odds`)
```json
{
  "path": "/api/cron/refresh-player-odds",
  "schedule": "*/30 * * * *"       // Every 30 minutes
}
```
**Purpose:** Refresh player prop odds specifically
**Frequency:** 48 times per day

#### 3. **Auto-Ingest** (`/api/cron/auto-ingest`)
```json
{
  "path": "/api/cron/auto-ingest",
  "schedule": "0 */3 * * *"        // Every 3 hours
}
```
**Purpose:** Automatically ingest NBA game data when all games are complete
**Frequency:** 8 times per day

#### 4. **NBA Stats Refresh** (`/api/cron/refresh-nba-stats`)
```json
{
  "path": "/api/cron/refresh-nba-stats",
  "schedule": "0 8 * * *"          // Daily at 8:00 AM UTC (3:00 AM ET)
}
```
**Purpose:** Refresh NBA player statistics
**Frequency:** Once daily

#### 5. **DVP Cache Refresh** (`/api/cron/refresh-dvp-cache`)
```json
{
  "path": "/api/cron/refresh-dvp-cache",
  "schedule": "0 8 * * *"          // Daily at 8:00 AM UTC
}
```
**Purpose:** Refresh Defense vs Position cache
**Frequency:** Once daily
**Max Duration:** 300 seconds (5 minutes)

#### 6. **Defensive Stats Refresh** (`/api/cron/refresh-defensive-stats`)
```json
{
  "path": "/api/cron/refresh-defensive-stats",
  "schedule": "0 7 * * *"          // Daily at 7:00 AM UTC (2:00 AM ET)
}
```
**Purpose:** Refresh defensive statistics
**Frequency:** Once daily

#### 7. **Odds Cleanup** (`/api/odds/cleanup`)
```json
{
  "path": "/api/odds/cleanup",
  "schedule": "0 0 * * *"          // Daily at midnight UTC
}
```
**Purpose:** Clean up old odds snapshots and expired cache entries
**Frequency:** Once daily

#### 8. **Odds Snapshots Cleanup** (`/api/cron/cleanup-odds-snapshots`)
```json
{
  "path": "/api/cron/cleanup-odds-snapshots",
  "schedule": "0 0 * * *"          // Daily at midnight UTC
}
```
**Purpose:** Clean up old line movement snapshots
**Frequency:** Once daily

#### 10. **Bet Checking** (`/api/check-bets`)
```json
{
  "path": "/api/check-bets",
  "schedule": "*/30 * * * *"       // Every 30 minutes
}
```
**Purpose:** Check bet statuses
**Frequency:** 48 times per day

#### 10. **Journal Bets Check** (`/api/check-journal-bets`)
```json
{
  "path": "/api/check-journal-bets",
  "schedule": "*/10 * * * *"       // Every 10 minutes
}
```
**Purpose:** Check journal bet statuses
**Frequency:** 144 times per day

### Cron Schedule Format

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
* * * * *
```

**Examples:**
- `*/30 * * * *` = Every 30 minutes
- `0 */3 * * *` = Every 3 hours at :00
- `30 1-22/3 * * *` = Every 3 hours at :30, from 1:30 AM to 10:30 PM
- `0 8 * * *` = Daily at 8:00 AM UTC

## Cache Flow Diagram

```
User Request
    ↓
Check In-Memory Cache
    ↓ (miss)
Check Supabase Cache
    ↓ (miss)
Fetch from API
    ↓
Save to In-Memory Cache
    ↓
Save to Supabase Cache
    ↓
Return to User
```

## Production Monitoring

### Key Metrics to Watch

1. **Cache Hit Rate:**
   - In-memory cache hits (fast)
   - Supabase cache hits (shared)
   - Cache misses (API calls)

2. **API Call Frequency:**
   - Odds refresh: ~16 calls/day (2 calls × 8 cron runs)
   - Player props: Varies based on user requests
   - Should stay well under API limits

3. **Supabase Performance:**
   - Query timeouts (should be rare)
   - Fallback to in-memory cache frequency
   - Database size (cache entries)

4. **Cron Job Success:**
   - Check Vercel logs for cron execution
   - Monitor for failures/timeouts
   - Verify data freshness

### Logging

**Development:**
- Verbose logging for all cache operations
- API call tracking
- Cache hit/miss logging

**Production:**
- Error logging only (reduces noise)
- Cron job execution logs
- Cache timeout warnings

## Best Practices

1. **Always check cache before API calls**
2. **Use Supabase for shared, persistent data**
3. **Use in-memory for fast, instance-specific data**
4. **Set appropriate TTLs based on data volatility**
5. **Monitor cron job execution in Vercel dashboard**
6. **Use `?refresh=1` sparingly (only for debugging)**
7. **Let background refreshes handle stale data automatically**

## Troubleshooting

### Issue: Stale Data
**Solution:** Check cron job execution logs, verify `ensureOddsCache()` is triggering background refreshes

### Issue: High API Usage
**Solution:** Verify cache TTLs are appropriate, check for unnecessary `?refresh=1` calls

### Issue: Slow Response Times
**Solution:** Check Supabase query times, verify in-memory cache is being used

### Issue: Missing Data
**Solution:** Check if Supabase is configured correctly, verify cache keys match

