# Testing Player Props Cache Issue

## Step 1: Check Console Logs

1. Open your browser's Developer Console (F12)
2. Go to the Console tab
3. Navigate to `/nba` page
4. Click on "Player Props" or select a player
5. Look for these log messages:

### What to look for:

**Cache Lookup:**
```
[Player Props API] 🔑 Looking up cache with key: nba-player-props-processed-v2-2025-12-11-2025-12-11T20:00:06.080Z-v2
[Player Props API] 📊 Cache lookup details: gameDate=2025-12-11, lastUpdated=2025-12-11T20:00:06.080Z, vendorCount=2
```

**Cache Result:**
- `✅ Cache HIT (Supabase)` - Cache found in Supabase
- `✅ Cache HIT (in-memory)` - Cache found in memory
- `⚠️ Cache MISS (Supabase)` - Not found in Supabase
- `⚠️ Cache MISS (in-memory)` - Not found in memory

**Stale Cache Search:**
```
[Player Props API] ⚠️ No cache for current odds version - checking for stale cache...
[Player Props API] 🔍 Checking X in-memory cache keys for stale cache...
[Player Props API] 🔍 Found X potential stale cache keys: [...]
```

## Step 2: Check Server Logs

In your terminal where `npm run dev` is running, look for:

1. When cache is written (POST request):
```
[Player Props API] ✅ Cached processed props in shared cache for game date: 2025-12-11, odds version: 2025-12-11T20:00:06.080Z, vendors: 2, cache key: nba-player-props-processed-v2-2025-12-11-2025-12-11T20:00:06.080Z-v2
```

2. When cache is read (GET request):
```
[Player Props API] 🔑 Looking up cache with key: nba-player-props-processed-v2-2025-12-11-2025-12-11T20:00:06.080Z-v2
```

**Compare these keys** - if they're different, that's the problem!

## Step 3: Test Cache Directly

### Option A: Check via API

```bash
# Get the cache key from logs, then test:
curl http://localhost:3000/api/nba/player-props
```

Look at the response:
- `"cached": true` - Cache was found
- `"cached": false` - Cache was not found
- `"stale": true` - Stale cache was served

### Option B: Check Cache Keys

Add this temporary endpoint or check in console:

```javascript
// In browser console on /nba page:
fetch('/api/nba/player-props')
  .then(r => r.json())
  .then(data => {
    console.log('Cache status:', {
      cached: data.cached,
      stale: data.stale,
      dataLength: data.data?.length || 0,
      gameDate: data.gameDate,
      lastUpdated: data.lastUpdated,
      message: data.message
    });
  });
```

## Step 4: Check if Cache Key Changes

1. Click player props first time - note the cache key from logs
2. Wait a few seconds
3. Click player props again - compare the cache key
4. If the keys are different, the `lastUpdated` timestamp is changing

## Step 5: Check Odds Cache Stability

The player props cache key includes `oddsCache.lastUpdated`. If this changes frequently, cache will never match.

Check odds cache:
```bash
curl http://localhost:3000/api/odds
```

Look at `lastUpdated` - if it changes on every request, that's the issue.

## Common Issues:

1. **Cache key mismatch**: `lastUpdated` changes between write and read
2. **Supabase not configured**: Falls back to in-memory cache (lost on server restart)
3. **Cache expired**: TTL too short
4. **Vendor count mismatch**: Cache written with 2 vendors, read with 7 vendors

## Quick Fix Test:

If cache key keeps changing, try this temporary fix - use a more stable cache key in development:

```typescript
// In development, use a stable cache key (ignore lastUpdated changes within same day)
const cacheKey = process.env.NODE_ENV === 'development' 
  ? `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}-v${vendorCount}`
  : getPlayerPropsCacheKey(gameDate, oddsCache.lastUpdated, vendorCount);
```

