# How to Cache All Player Stats for Similar Players

This guide explains how to cache all the new stat types (FGM, FGA, FTM, FTA, OREB, DREB, TO, PF, STL, BLK) for every player in the database.

## Prerequisites

1. **Run the migration** to add OREB and DREB columns:
   ```sql
   -- Run this in Supabase SQL Editor
   -- File: migrations/add_oreb_dreb_to_player_season_averages.sql
   ```

2. **Make sure players are synced** first:
   ```bash
   # This should already be done, but if not:
   curl -X POST http://localhost:3000/api/players/sync
   ```

## Method 1: Using the API Endpoint (Recommended)

### For Local Development:
```bash
curl -X POST http://localhost:3000/api/player-season-averages/sync \
  -H "Content-Type: application/json" \
  -d '{"season": 2025}'
```

### For Production (Vercel):
```bash
curl -X POST https://your-app.vercel.app/api/player-season-averages/sync \
  -H "Content-Type: application/json" \
  -d '{"season": 2025}'
```

## Method 2: Using the Script

```bash
# For current season (2025)
node scripts/sync-all-player-season-averages.js

# For a specific season
node scripts/sync-all-player-season-averages.js 2024
```

## What Gets Cached

The sync will cache the following stats for all players:
- **Points** (pts)
- **Rebounds** (reb)
- **Assists** (ast)
- **Field Goals Made** (fgm) ✨ NEW
- **Field Goal Attempts** (fga) ✨ NEW
- **Free Throws Made** (ftm) ✨ NEW
- **Free Throw Attempts** (fta) ✨ NEW
- **Offensive Rebounds** (oreb) ✨ NEW
- **Defensive Rebounds** (dreb) ✨ NEW
- **Turnovers** (turnover/to) ✨ NEW
- **Personal Fouls** (pf) ✨ NEW
- **Steals** (stl) ✨ NEW
- **Blocks** (blk) ✨ NEW
- **Three-Pointers Made** (fg3m/3pm)
- **Combo Stats**: PRA, PR, PA, RA (calculated)

## How It Works

1. The sync fetches all active players from the `players` table
2. For each player, it calls the BDL API to get season averages
3. It stores all stats in the `player_season_averages` table
4. The similar players feature then uses this cached data for instant lookups

## Rate Limiting

The sync is designed to handle rate limiting:
- Processes 5 players concurrently
- 1 second delay between batches
- Automatic retries with exponential backoff for 429 errors
- Max 3 retries per player

## Expected Time

For ~500 players:
- ~100 batches (5 players each)
- ~100 seconds (1 second delay between batches)
- **Total: ~2-3 minutes**

## Verification

After syncing, you can verify the data:

```sql
-- Check if stats are populated
SELECT 
  player_id,
  pts, reb, ast,
  fgm, fga, ftm, fta,
  oreb, dreb,
  turnover, pf, stl, blk,
  fg3m
FROM player_season_averages
WHERE season = 2025
LIMIT 10;
```

## Troubleshooting

### "No players found in cache"
Run the players sync first:
```bash
curl -X POST http://localhost:3000/api/players/sync
```

### "Rate limited" errors
The sync will automatically retry. If it fails completely, wait a few minutes and try again.

### Missing columns error
Make sure you've run the migration:
```sql
-- Run migrations/add_oreb_dreb_to_player_season_averages.sql
```

