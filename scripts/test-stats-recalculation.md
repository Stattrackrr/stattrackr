# Testing Stats Recalculation in 30-Minute Update

This guide shows how to test that the 30-minute update recalculates stats for props missing stat arrays.

## Quick Test

### Method 1: Manual API Call

```bash
# Trigger the update endpoint
curl -X POST http://localhost:3000/api/nba/player-props/update-odds | jq
```

### Method 2: PowerShell Script

```powershell
.\scripts\test-player-props-odds-update.ps1
```

### Method 3: Node.js Script

```bash
node scripts/test-30min-update.js
```

## What to Look For

### 1. Check Logs for Stats Recalculation

Look for these log messages:

```
[Player Props Update Odds] 🔄 Checking for props missing stat arrays...
[Player Props Update Odds] 📊 Found X props missing stat arrays - recalculating stats...
[Player Props Update Odds] ✅ Recalculated stats for [Player] [Stat] (1/10)
[Player Props Update Odds] ✅ Recalculated stats for 10 props
```

### 2. Verify Props Have Stat Arrays

Before the update, check a prop that's missing stats:

```bash
curl http://localhost:3000/api/nba/player-props | jq '.data[] | select(.playerName == "Cooper Flagg" and .statType == "PTS") | {playerName, statType, line, __last5Values, __last10Values, last5HitRate}'
```

After the update, the same prop should have:
- `__last5Values` array populated
- `__last10Values` array populated
- `__h2hStats` array populated
- `__seasonValues` array populated
- `last5HitRate`, `last10HitRate`, `h2hHitRate`, `seasonHitRate` calculated

### 3. Check Response for Stats Recalculation Count

The API response should show:
```json
{
  "success": true,
  "updated": 914,
  "removed": 1,
  "newProps": 9,
  "total": 924,
  "statsRecalculated": 10  // New field showing how many props got stats recalculated
}
```

## Testing Steps

1. **Find props without stat arrays:**
   ```bash
   curl http://localhost:3000/api/nba/player-props | jq '[.data[] | select(.__last5Values == null or (.__last5Values | length) == 0)] | length'
   ```

2. **Trigger the update:**
   ```bash
   curl -X POST http://localhost:3000/api/nba/player-props/update-odds
   ```

3. **Check logs** - Look for:
   - `📊 Found X props missing stat arrays`
   - `✅ Recalculated stats for [Player] [Stat]`

4. **Verify stats were added:**
   ```bash
   curl http://localhost:3000/api/nba/player-props | jq '[.data[] | select(.__last5Values != null and (.__last5Values | length) > 0)] | length'
   ```

5. **Compare before/after** - The number of props with stat arrays should increase.

## Expected Behavior

- **First run:** May recalculate stats for up to 10 props
- **Subsequent runs:** Will continue processing remaining props (10 per update)
- **Eventually:** All props will have stat arrays and hit rates

## Troubleshooting

If stats aren't being recalculated:

1. **Check if props actually need stats:**
   - Some props might already have stat arrays
   - Check logs for `📊 Found 0 props missing stat arrays`

2. **Check for errors:**
   - Look for `⚠️ Error recalculating stats` in logs
   - Check if player IDs are found
   - Check if position lookup is working

3. **Check rate limiting:**
   - The update processes 10 props at a time
   - If there are many props, it will take multiple updates












