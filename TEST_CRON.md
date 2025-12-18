# Testing the Player Odds Cron Job

## What Changed
- **Bulk odds refresh**: Runs every 30 minutes (fast, ~5-30 seconds)
- **Per-player processing**: Only runs once per day (after 20 hours since last scan)

## Testing Methods

### Option 1: Test Locally

1. **Start your dev server** (if not already running):
   ```bash
   npm run dev
   ```

2. **Get your CRON_SECRET** from `.env.local`:
   ```bash
   # Look for CRON_SECRET=your-secret-here
   ```

3. **Test the cron endpoint**:
   ```bash
   # Using curl (Windows PowerShell)
   curl -X GET "http://localhost:3000/api/cron/refresh-player-odds?secret=YOUR_CRON_SECRET"
   
   # Or using PowerShell Invoke-WebRequest
   Invoke-WebRequest -Uri "http://localhost:3000/api/cron/refresh-player-odds?secret=YOUR_CRON_SECRET" -Method GET
   ```

4. **Expected Response** (if per-player scan was skipped):
   ```json
   {
     "success": true,
     "bulkOddsRefreshed": true,
     "playerScanSkipped": true,
     "hoursSinceLastPlayerScan": 2,
     "elapsed": "5000ms",
     "timestamp": "2025-01-11T...",
     "message": "Bulk odds refreshed, per-player scan skipped (only needed once per day)"
   }
   ```

5. **Expected Response** (if per-player scan runs - first time or after 20+ hours):
   ```json
   {
     "success": true,
     "bulkOddsRefreshed": true,
     "playerScanCompleted": true,
     "playersProcessed": 150,
     "totalPlayers": 150,
     "updated": 1200,
     "unchanged": 500,
     "errors": 0,
     "elapsed": "45000ms",
     "timestamp": "2025-01-11T...",
     "message": "Bulk odds refreshed and per-player scan completed"
   }
   ```

### Option 2: Test on Vercel (Production)

1. **Go to Vercel Dashboard** → Your Project → **Cron Jobs**
2. **Find** `/api/cron/refresh-player-odds`
3. **Click "Run Now"** to manually trigger it
4. **Check the logs** in Vercel Dashboard → **Logs** tab

### Option 3: Test via Browser (if you have CRON_SECRET)

1. **Open browser** and go to:
   ```
   http://localhost:3000/api/cron/refresh-player-odds?secret=YOUR_CRON_SECRET
   ```
   (Replace `YOUR_CRON_SECRET` with your actual secret)

2. **View the JSON response** to see what happened

## What to Verify

### ✅ Success Indicators

1. **Fast execution** (< 1 minute) when skipping per-player scan:
   - `"playerScanSkipped": true`
   - `"elapsed"` should be under 60 seconds
   - No timeout errors

2. **Bulk odds refreshed**:
   - `"bulkOddsRefreshed": true`
   - Check logs for: `"[CRON] ✅ Bulk odds cache refreshed successfully"`

3. **Per-player scan only when needed**:
   - First run or after 20+ hours: `"playerScanCompleted": true`
   - Recent runs: `"playerScanSkipped": true`

### 🔍 Check Logs

Look for these log messages:

**When skipping per-player scan:**
```
[CRON] 🔄 refresh-player-odds: Refreshing bulk odds cache...
[CRON] ✅ Bulk odds cache refreshed successfully
[CRON] ⏭️ Skipping per-player processing (last scan was X hours ago, only needed once per day)
```

**When running per-player scan:**
```
[CRON] 🔄 refresh-player-odds: Refreshing bulk odds cache...
[CRON] ✅ Bulk odds cache refreshed successfully
[CRON] 🔄 Starting per-player processing (once per day when new odds are released)...
[CRON] Found X players with games
[CRON] ✅ refresh-player-odds completed in Xms: bulk odds refreshed, X players processed...
```

## Testing Scenarios

### Scenario 1: First Run (No Previous Scan)
- Should run per-player processing
- Should complete successfully
- Should set `last_full_scan` timestamp

### Scenario 2: Frequent Run (< 20 hours since last scan)
- Should skip per-player processing
- Should only refresh bulk odds
- Should complete in < 60 seconds

### Scenario 3: Daily Run (> 20 hours since last scan)
- Should run per-player processing
- Should process all players with games
- May take 1-5 minutes but shouldn't timeout

## Troubleshooting

### If you get "Unauthorized":
- Check that `CRON_SECRET` is set in `.env.local`
- Make sure you're using the correct secret in the URL/header

### If bulk odds refresh fails:
- Check network connectivity
- Check BallDontLie API key
- Check Vercel logs for detailed error messages

### If per-player scan times out:
- This shouldn't happen anymore (only runs once per day)
- If it does, check Vercel logs for which player/batch caused the issue










