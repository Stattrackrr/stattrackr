# How to Test Player Props Odds Update

## Quick Test (Local Development)

### Step 1: Start your dev server
```bash
npm run dev
```

### Step 2: Run the test script
```powershell
.\scripts\test-player-props-odds-update.ps1
```

This script will:
- ✅ Check if player props exist
- ✅ Check if odds cache exists
- ✅ Trigger the update endpoint
- ✅ Verify props were updated

## Manual Testing (Step by Step)

### Step 1: Check current player props
```bash
# Get a sample prop to see current values
curl http://localhost:3000/api/nba/player-props | jq '.data[0] | {playerName, statType, line, overOdds, underOdds, last5Avg, seasonAvg}'
```

**Note:** If you get no props, you need to process them first:
```bash
curl -X POST http://localhost:3000/api/nba/player-props/process
```

### Step 2: Refresh odds (to get new lines)
```bash
curl -X GET http://localhost:3000/api/odds/refresh
```

Wait for it to complete (should take ~3-5 seconds). You should see logs like:
```
✅ BDL odds refresh complete in Xms - Y games cached
[Odds Refresh] 🔄 Triggering background player props update: ...
```

### Step 3: Manually trigger player props update

**PowerShell (Recommended - no security warning):**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/nba/player-props/update-odds" -Method POST
```

**Or with Invoke-WebRequest (add -UseBasicParsing to avoid warning):**
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/nba/player-props/update-odds" -Method POST -UseBasicParsing | Select-Object -ExpandProperty Content
```

**Or use curl.exe (not the alias):**
```powershell
curl.exe -X POST http://localhost:3000/api/nba/player-props/update-odds
```

**Bash/Command Prompt:**
```bash
curl -X POST http://localhost:3000/api/nba/player-props/update-odds
```

**Expected response:**
```json
{
  "success": true,
  "message": "Player props odds updated",
  "updated": 150,
  "notFound": 10,
  "total": 160,
  "elapsed": "1234ms"
}
```

### Step 4: Verify props were updated
```bash
# Get the same prop again and compare
curl http://localhost:3000/api/nba/player-props?refresh=1 | jq '.data[0] | {playerName, statType, line, overOdds, underOdds, last5Avg, seasonAvg}'
```

**What to check:**
- ✅ `line`, `overOdds`, `underOdds` should match new odds
- ✅ `last5Avg`, `last10Avg`, `h2hAvg`, `seasonAvg`, `streak` should be **unchanged** (preserved)
- ✅ `last5HitRate`, `last10HitRate`, etc. should be **recalculated** if line changed

## Testing in Production

### Method 1: Check Vercel Logs

1. Go to Vercel Dashboard → Your Project → Functions
2. Look for `/api/odds/refresh` execution (runs every 30 minutes)
3. Check logs for:
   ```
   ✅ BDL odds refresh complete
   [Odds Refresh] 🔄 Triggering background player props update: https://...
   [Player Props Update Odds] 🔄 Starting odds update for player props...
   [Player Props Update Odds] ✅ Updated X/Y props in Zms
   [Odds Refresh] ✅ Player props updated: X/Y props
   ```

### Method 2: Manual Trigger in Production

**PowerShell (Recommended):**
```powershell
Invoke-RestMethod -Uri "https://stattrackr.co/api/nba/player-props/update-odds" -Method POST
```

**Or with Invoke-WebRequest:**
```powershell
Invoke-WebRequest -Uri "https://stattrackr.co/api/nba/player-props/update-odds" -Method POST -UseBasicParsing | Select-Object -ExpandProperty Content
```

**Or use curl.exe:**
```powershell
curl.exe -X POST https://stattrackr.co/api/nba/player-props/update-odds
```

**Note:** You can't test POST endpoints in a browser (browsers only make GET requests). Use PowerShell, curl, or Postman.

### Method 3: Check Dashboard Auto-Refresh

1. Open player props page: `https://stattrackr.co/nba`
2. Open browser console (F12)
3. Wait 2 minutes (polling interval)
4. You should see:
   ```
   [NBA Landing] 🔄 Odds updated, refreshing player props...
   [NBA Landing] ✅ Using cached player props data
   ```

## What to Look For

### ✅ Success Indicators:
- Update endpoint returns `success: true` with `updated > 0`
- Player props show new lines/odds
- Stats (last5Avg, seasonAvg, etc.) are preserved
- Hit rates are recalculated (if line changed)
- Dashboard auto-refreshes when odds change

### ❌ Common Issues:

**"No existing props cache to update"**
- Solution: Process player props first: `POST /api/nba/player-props/process`

**"No odds data available"**
- Solution: Refresh odds first: `GET /api/odds/refresh`

**"Updated: 0 props"**
- Possible causes:
  - Odds haven't changed (same lines as before)
  - Player props don't match odds cache (different game dates)
  - Bookmaker names don't match
- Check: Compare odds cache timestamp with player props cache

**Dashboard not auto-refreshing**
- Check browser console for errors
- Verify `/api/odds?check_timestamp=1` is being called
- Check if odds timestamp is actually changing

## Quick Test Checklist

- [ ] Player props exist (from initial processing)
- [ ] Odds cache exists and is recent
- [ ] Update endpoint returns success with `updated > 0`
- [ ] Player props show updated lines/odds
- [ ] Stats are preserved (last5Avg, seasonAvg, streak)
- [ ] Hit rates are recalculated (if line changed)
- [ ] Dashboard polls and refreshes automatically

## Production Monitoring

After deployment, monitor:
1. **Vercel Cron Logs** - Check `/api/odds/refresh` runs every 30 mins
2. **Function Logs** - Look for update endpoint being called
3. **User Reports** - Check if props are updating correctly
4. **Dashboard Console** - Verify auto-refresh is working

