# Testing Similar Players Feature

## Quick Test Steps

### 1. In the Browser (UI Test)

1. **Navigate to the NBA Research Dashboard**
   - Go to `/nba/research/dashboard` in your production app
   - Or use: `https://your-vercel-app.vercel.app/nba/research/dashboard`

2. **Select a Player**
   - Choose any active NBA player from the player selector
   - Make sure the player has stats available

3. **Select an Opponent**
   - Choose a team from the opponent filter (e.g., "DET", "LAL", "BOS")
   - Make sure it's not "ALL" or "N/A"

4. **Open Similar Players Tab**
   - In the "Opponent Analysis" section, click on the **"Similar Players"** tab
   - It should be next to the "Opponent Breakdown" tab

5. **Check the Results**
   - You should see either:
     - A table of similar players with their stats vs the opponent
     - A message: "No similar players found vs [TEAM]"
   - If you see "No similar players found", check the logs (see below)

### 2. Direct API Test (Command Line)

You can test the API directly using curl or PowerShell:

```powershell
# Replace with your production URL and a real player ID
$playerId = "38017712"  # Example player ID
$opponent = "DET"       # Example opponent
$statType = "ast"       # Example stat type

# Test the API
Invoke-WebRequest -Uri "https://your-app.vercel.app/api/similar-players?playerId=$playerId&opponent=$opponent&statType=$statType" | Select-Object -ExpandProperty Content
```

Or using curl (if available):
```bash
curl "https://your-app.vercel.app/api/similar-players?playerId=38017712&opponent=DET&statType=ast"
```

### 3. Check Production Logs

After triggering the feature, check the logs to see what's happening:

```powershell
# View logs and filter for "Similar Players"
npm run logs | Select-String "Similar Players"

# Or view JSON logs
npm run logs:json | Select-String "Similar Players"
```

### 4. What to Look For

**✅ Success Indicators:**
- Logs show: `[Similar Players] Found X candidates matching height`
- Logs show: `[Similar Players] Found X similar players after filtering`
- Logs show: `[Similar Players] Found X games vs [OPPONENT]`
- Logs show: `[Similar Players] Returning X results`
- No `ECONNREFUSED 127.0.0.1:3000` errors
- Player name shows correctly (not "undefined undefined")

**❌ Error Indicators:**
- `ECONNREFUSED 127.0.0.1:3000` - Still using localhost (should be fixed)
- `Found 0 candidates matching position` - No similar players found
- `Found 0 games vs [OPPONENT]` - Players haven't played against that team
- `Player missing position or height data` - Player data incomplete

### 5. Debugging "No Similar Players Found"

If you see "No similar players found", check the logs for:

1. **How many candidates were found:**
   ```
   [Similar Players] Found X candidates matching height (±3")
   ```

2. **Position matching:**
   ```
   [Similar Players] Found X candidates matching position PG
   ```

3. **Games found:**
   ```
   [Similar Players] Found X games vs DET
   ```

4. **Debug info in API response:**
   - Check the browser Network tab
   - Look for the API response to `/api/similar-players`
   - Check the `debug` field in the response (if `results.length === 0`)

### 6. Common Issues and Solutions

**Issue: "No similar players found"**
- **Possible causes:**
  - No players match the criteria (position, height, play type, minutes)
  - Similar players exist but haven't played vs the opponent
  - All games have statValue === 0 (filtered out)
  - Missing season averages (filtered out)

**Issue: Player name shows as "undefined undefined"**
- **Should be fixed now** - The API now fetches `first_name` and `last_name` from Supabase cache

**Issue: Still seeing localhost errors**
- **Should be fixed now** - All API calls use `getBaseUrl()` which detects Vercel environment

### 7. Test with Different Players/Teams

Try different combinations:
- Different players (guards, forwards, centers)
- Different opponents
- Different stat types (pts, reb, ast, etc.)
- Players who have played many games vs the opponent

### 8. Verify the Fix

After the latest deployment, you should see:
- ✅ No `ECONNREFUSED` errors in logs
- ✅ Depth charts successfully fetched
- ✅ Player names display correctly
- ✅ Similar players found (if criteria match)

