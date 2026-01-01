# Testing the 30-Minute Update

This guide helps you verify that the 30-minute update only processes new/changed props, not all props from scratch.

## Quick Test (PowerShell)

```powershell
.\scripts\test-player-props-odds-update.ps1
```

This script will:
1. Check current player props count
2. Check odds cache
3. Trigger the update endpoint
4. Verify only changed/new props were processed

## Manual Test Steps

### 1. Check Current State

```bash
# Get current props count
curl http://localhost:3000/api/nba/player-props | jq '.data | length'

# Get a sample prop to track
curl http://localhost:3000/api/nba/player-props | jq '.data[0] | {playerName, statType, line, overOdds, underOdds}'
```

### 2. Trigger Update Endpoint

```bash
# This should only update props with changed odds, not process all props
curl -X POST http://localhost:3000/api/nba/player-props/update-odds | jq
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Player props odds updated",
  "updated": 15,        // Only props with changed odds/lines
  "removed": 2,         // Props removed (game started)
  "newProps": 3,        // New props added
  "total": 150,         // Total after update
  "previousTotal": 149, // Total before update
  "propsWithMultipleBookmakers": 120,
  "elapsed": "2345ms"
}
```

### 3. Verify It's Not Processing Everything

**Key indicators:**
- `updated` should be much less than `total` (only props with changed odds)
- `elapsed` should be fast (< 5 seconds for ~150 props)
- If `updated` equals `total`, it's processing everything (not good)

### 4. Test New Props Detection

To test new props detection:
1. Wait for new odds to appear (or manually refresh odds)
2. Run the update endpoint
3. Check `newProps` count - should be > 0 if new players appeared

### 5. Test Props Removal

To test props removal:
1. Wait for a game to start (odds will disappear)
2. Run the update endpoint
3. Check `removed` count - should be > 0 if games started

## What to Look For

✅ **Good signs:**
- `updated` < `total` (only changed props updated)
- Fast execution (< 5 seconds)
- `newProps` > 0 when new players appear
- `removed` > 0 when games start

❌ **Bad signs:**
- `updated` == `total` (processing everything)
- Slow execution (> 30 seconds)
- Processing all props even when nothing changed

## Production Testing

For production, use your Vercel URL:

```bash
curl -X POST https://www.stattrackr.co/api/nba/player-props/update-odds | jq
```

Or check Vercel function logs to see the console output.








