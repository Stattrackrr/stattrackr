# NBA API Caching Summary

## Background Job Cache (`/api/cache/nba-league-data`)

Runs daily at 2 AM UTC via Vercel Cron. Caches all league-wide data for 24 hours.

### What's Cached:

1. **Play Type Defensive Rankings** (Team stats)
   - Cache Key: `playtype_defensive_rankings_{season}`
   - Data: All 11 play types × 30 teams
   - Used by: `/api/play-type-analysis` for opponent ranks

2. **Player Play Type Stats** (Bulk - All players)
   - Cache Key: `player_playtypes_bulk_{season}`
   - Data: All 11 play types × ~1480 players
   - Used by: `/api/play-type-analysis` to filter by player ID

3. **Zone Defensive Rankings** (Team stats)
   - Cache Key: `zone_defensive_rankings_{season}`
   - Data: 6 zones × 30 teams
   - Used by: `/api/team-defense-rankings` → `/api/shot-chart-enhanced`
   - Note: May fail with NBA API 500 (non-critical)

## Per-Player Caching

### `/api/play-type-analysis`
- Cache Key: `playtype_analysis_{playerId}_{opponentTeam}_{season}`
- TTL: 24 hours
- Uses: Bulk player cache + defensive rankings cache
- Fallback: Fetches from API if bulk cache missing (may timeout)

### `/api/shot-chart-enhanced`
- Cache Key: `shot_enhanced_{playerId}_{opponentTeam}_{season}`
- TTL: 24 hours
- Uses: Team defense rankings cache (via `/api/team-defense-rankings`)
- Fallback: Fetches from API if cache missing

### `/api/team-defense-rankings`
- Cache Key: `team_defense_rankings_{season}`
- TTL: 24 hours
- Uses: Background job zone rankings cache
- Fallback: Fetches from API if cache missing (may timeout with multiple users)

## Caching Strategy

1. **League-wide data** → Background job caches once per day
2. **Per-player data** → Cached on first request, reused for 24 hours
3. **Fallback** → If cache missing, fetch from API (but may timeout with multiple users)

## Benefits

- ✅ No timeouts with multiple concurrent users
- ✅ Faster response times (reads from cache)
- ✅ Reduced load on NBA API
- ✅ More reliable service

## Manual Cache Refresh

To manually refresh the cache:
```
GET /api/cache/nba-league-data?season=2025
```

## Cache Status

Check if cache is populated:
- Play type rankings: Check for `playtype_defensive_rankings_2025-26` in cache
- Player play types: Check for `player_playtypes_bulk_2025-26` in cache
- Zone rankings: Check for `zone_defensive_rankings_2025-26` in cache


