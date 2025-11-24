# How NBA API Caching Works

## 🎯 Two-Layer Cache System

### 1. **In-Memory Cache** (Fast, Per-Instance)
- Stored in server memory
- **Lost when server restarts** (Vercel serverless functions)
- Fast access (< 1ms)
- Limited to 1000 entries (LRU eviction)

### 2. **Supabase Cache** (Persistent, Shared)
- Stored in Supabase database (`nba_api_cache` table)
- **Persists across server restarts**
- Shared across ALL Vercel instances
- Slower access (~1-5 seconds)
- No size limit (database storage)

## ⏰ Cache Expiration (TTL)

All NBA API data uses **24 hours (1440 minutes)** TTL:

```typescript
CACHE_TTL.TRACKING_STATS = 24 * 60  // 1440 minutes = 24 hours
```

This applies to:
- ✅ Shot Charts
- ✅ Play Type Analysis
- ✅ Team Tracking Stats (Potentials)
- ✅ Defensive Rankings
- ✅ Zone Defense Rankings

## 🔄 When Cache Updates

### Cache is **refreshed** when:

1. **Cache expires** (after 24 hours)
   - Next request will fetch fresh data
   - Old cache is deleted, new data is cached

2. **Manual refresh** (using `bypassCache=true`)
   - Scripts use `bypassCache=true` to force fresh fetch
   - Old cache is overwritten with new data

3. **Cache miss** (no cache exists)
   - First request fetches from NBA API
   - Data is cached for 24 hours

### Cache is **NOT updated** when:

- ❌ Data changes in NBA API (we don't know when it changes)
- ❌ Within 24 hours (cache is still valid)
- ❌ If Supabase write fails (falls back to in-memory only)

## 📊 Cache Flow

```
Request → Check In-Memory Cache
  ↓ (miss)
Check Supabase Cache
  ↓ (miss)
Fetch from NBA API
  ↓
Save to Supabase + In-Memory
  ↓
Return data
```

## 🗑️ Cache Cleanup

### Automatic:
- **In-Memory**: Expired entries deleted on access
- **Supabase**: Expired entries deleted on read (if expired)

### Manual:
- Run cleanup script: `.\scripts\refresh-bulk-only-local.ps1`
- Or delete from Supabase dashboard

## 📅 Example Timeline

**Day 1, 10:00 AM**: Cache shot chart for player 203076
- Expires: Day 2, 10:00 AM (24 hours later)

**Day 1, 2:00 PM**: Request same player
- ✅ Cache HIT (still valid, expires in 20 hours)

**Day 2, 11:00 AM**: Request same player
- ⏰ Cache EXPIRED (24 hours passed)
- 🔄 Fetches fresh data from NBA API
- 💾 Caches new data (expires Day 3, 11:00 AM)

## 🎛️ Cache Keys

Cache keys are unique identifiers:
- Shot Chart: `shot_enhanced_{playerId}_{opponentTeam}_{season}`
- Play Type: `play_type_{playerId}_{season}`
- Potentials: `tracking_stats_{team}_{season}_{category}`
- Rankings: `team_defense_rankings_{season}`

## 💡 Best Practices

1. **Run daily refresh** to keep cache fresh
2. **Use `bypassCache=true`** in scripts to force updates
3. **Check Supabase** to verify cache is populated
4. **Monitor expiration** - data older than 24h will refresh

## 🔍 How to Check Cache Status

### In Supabase:
```sql
SELECT 
  cache_key, 
  cache_type, 
  created_at, 
  expires_at,
  expires_at > NOW() as is_valid
FROM nba_api_cache
ORDER BY created_at DESC
LIMIT 10;
```

### In Logs:
- `[NBA Cache] ✅ Cache HIT` = Using cached data
- `[NBA Cache] ⏰ Cache expired` = Fetching fresh data
- `[NBA Cache] 💾 Writing to Supabase` = Saving new cache

