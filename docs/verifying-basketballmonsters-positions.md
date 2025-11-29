# Verifying BasketballMonsters Positions in DvP Store

## How It Works

1. **Prefetch Cron** (`/api/cron/prefetch-lineups`):
   - Runs every 30 minutes
   - Fetches and caches BasketballMonsters lineups for games today/tomorrow
   - Caches both verified and projected lineups
   - Locks lineups once 5/5 players are verified

2. **Ingest Process** (`/api/dvp/ingest-nba` or `/api/dvp/ingest`):
   - When ingesting a game, checks cache for BasketballMonsters lineup
   - For past games (up to 7 days): Uses cached lineup if available
   - For today/future games: Uses cached lineup (prefers verified)
   - Saves `bmPosition` field to each player object
   - Sets `source` to `basketballmonsters-verified` or `basketballmonsters-projected`

## How to Verify It's Working

### Step 1: Check if Lineups Are Being Cached

```bash
node scripts/test-prefetch-lineups.js
```

Look for:
- `successful: X` - Number of lineups successfully cached
- `locked: X` - Number of fully verified lineups
- `projected: X` - Number of projected lineups

### Step 2: Check Recent Games After Ingest

After a game finishes and is ingested, check:

```bash
node scripts/check-recent-games.js <TEAM>
```

Look for:
- `Source: basketballmonsters-verified` or `basketballmonsters-projected` (not `bdl+espn`)
- `BM Players Count: X` - Number of players with BasketballMonsters positions
- `Players with bmPosition: X/Y` - Should be > 0

### Step 3: Inspect DvP Store File

```bash
node scripts/inspect-dvp-positions.js <TEAM>
```

This will show:
- Which games have BasketballMonsters positions
- Which players have `bmPosition` field
- Whether lineups were verified or projected

## Important Notes

- **Past Games**: Games from before the BasketballMonsters integration won't have positions unless lineups were cached when the game was "today"
- **Cache Window**: Only games within the last 7 days can use cached lineups
- **Verification**: Lineups start as "projected" and become "verified" as players are confirmed
- **Fallback**: If no BasketballMonsters lineup is available, the system falls back to `bdl+espn` methods

## Expected Behavior

For a NEW game (scheduled today/tomorrow):

1. **Before Game**: Prefetch cron caches projected lineup
2. **During Game**: Prefetch cron updates to verified lineup (if available)
3. **After Game**: Ingest uses cached lineup and saves `bmPosition` to each player
4. **Result**: Game shows `source: basketballmonsters-verified` or `basketballmonsters-projected`

## Troubleshooting

If positions aren't being saved:

1. **Check Prefetch Logs**: Ensure lineups are being cached
2. **Check Ingest Logs**: Look for `[DvP Ingest] 🏀 BasketballMonsters lineup available...`
3. **Check Cache**: Verify lineup exists in cache for the game date
4. **Check Date**: Ensure game is within 7 days (for past games) or today/future (for new games)

