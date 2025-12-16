# Testing Player Props Odds Update

## Overview

The player props odds update system automatically updates player props with new odds/lines when odds refresh completes, without reprocessing stats. This ensures player props reflect the latest lines while preserving all calculated stats (last5, last10, h2h, season avg, streak, etc.).

## How It Works

1. **Odds Refresh** (Vercel Cron - every 30 minutes)
   - Runs: `/api/odds/refresh` (Vercel cron: `*/30 * * * *`)
   - Fetches new odds from Ball Don't Lie API
   - Updates odds cache in Supabase

2. **Player Props Update** (Automatic - after odds refresh)
   - After odds refresh completes, automatically calls `/api/nba/player-props/update-odds`
   - Updates player props cache with new lines/odds
   - Preserves all calculated stats
   - Recalculates hit rates based on new lines

3. **Dashboard Auto-Refresh** (Client-side polling)
   - Player props page polls for odds updates every 2 minutes
   - When odds timestamp changes, automatically refreshes player props

## Testing Methods

### Method 1: Manual API Test (Recommended)

Use the PowerShell test script:

```powershell
.\scripts\test-player-props-odds-update.ps1
```

This script:
1. Checks current player props
2. Checks odds cache
3. Triggers the update endpoint
4. Verifies props were updated

### Method 2: Manual API Calls

#### Step 1: Check current player props
```bash
curl http://localhost:3000/api/nba/player-props | jq '.data[0] | {playerName, statType, line, overOdds, underOdds}'
```

#### Step 2: Trigger odds refresh (if needed)
```bash
curl -X GET http://localhost:3000/api/odds/refresh
```

#### Step 3: Trigger player props update
```bash
curl -X POST http://localhost:3000/api/nba/player-props/update-odds
```

Expected response:
```json
{
  "success": true,
  "message": "Player props odds updated",
  "updated": 150,
  "notFound": 10,
  "total": 160
}
```

#### Step 4: Verify props were updated
```bash
curl http://localhost:3000/api/nba/player-props?refresh=1 | jq '.data[0] | {playerName, statType, line, overOdds, underOdds}'
```

Compare the `line`, `overOdds`, and `underOdds` values - they should match the new odds.

### Method 3: Test in Production

1. **Wait for automatic odds refresh** (runs every 30 minutes)
   - Check Vercel cron logs: `https://vercel.com/[your-project]/crons`
   - Look for `/api/odds/refresh` execution

2. **Check update endpoint was called**
   - Look for logs: `[Odds Refresh] ✅ Player props updated: X/Y props`
   - This should appear in Vercel function logs after odds refresh

3. **Verify in dashboard**
   - Open player props page
   - Wait 2 minutes (polling interval)
   - Player props should automatically refresh with new lines

## Verification Checklist

- [ ] Player props cache exists (from initial processing)
- [ ] Odds cache exists and is recent
- [ ] Update endpoint returns success with updated count > 0
- [ ] Player props show updated lines/odds
- [ ] Stats are preserved (last5Avg, last10Avg, h2hAvg, seasonAvg, streak)
- [ ] Hit rates are recalculated (if line changed)

## Troubleshooting

### Issue: "No existing props cache to update"
**Solution:** Process player props first:
```bash
curl -X POST http://localhost:3000/api/nba/player-props/process
```

### Issue: "No odds data available"
**Solution:** Refresh odds first:
```bash
curl -X GET http://localhost:3000/api/odds/refresh
```

### Issue: "Updated: 0 props"
**Possible causes:**
- Odds haven't changed (same lines as before)
- Player props don't match odds cache (different game dates)
- Bookmaker names don't match

**Check:**
- Compare odds cache timestamp with player props cache
- Verify game dates match
- Check bookmaker names in both caches

### Issue: Dashboard not auto-refreshing
**Check:**
- Browser console for polling errors
- Network tab for `/api/odds?check_timestamp=1` requests
- Odds timestamp is actually changing

## Cron Schedule

**Vercel Cron Jobs:**
- `/api/odds/refresh`: Every 30 minutes (`*/30 * * * *`)
- `/api/cron/refresh-player-odds`: Every 30 minutes (`*/30 * * * *`)

**Note:** The update-odds endpoint is called automatically after odds refresh completes (not a separate cron job).

## Monitoring

### Vercel Logs
Check function logs for:
- `[Odds Refresh] ✅ BDL odds refresh complete`
- `[Odds Refresh] ✅ Player props updated: X/Y props`
- `[Player Props Update Odds] ✅ Updated X/Y props`

### Dashboard Console
Check browser console for:
- `[NBA Landing] 🔄 Odds updated, refreshing player props...`
- `[NBA Landing] ✅ Using cached player props data`

## Expected Behavior

1. **Every 30 minutes:**
   - Odds refresh runs (Vercel cron)
   - Player props automatically update with new odds
   - Dashboard polls and refreshes if on player props page

2. **Stats preserved:**
   - All averages (last5, last10, h2h, season) remain unchanged
   - Streak remains unchanged
   - DvP rating remains unchanged
   - Only odds/lines/probabilities update

3. **Hit rates recalculated:**
   - If line changes, hit rates are recalculated using stored stat value arrays
   - This ensures accuracy without reprocessing stats

