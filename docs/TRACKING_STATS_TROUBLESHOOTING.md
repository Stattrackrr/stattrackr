# 🔧 Tracking Stats Troubleshooting Guide

## Common Error: "NBA API 500: Internal Server Error"

### What This Means

This error occurs when the NBA Stats API returns a 500 Internal Server Error. This can happen for several reasons:

1. **NBA API is temporarily down** - The NBA's stats servers occasionally have issues
2. **Rate limiting** - Too many requests in a short time
3. **Invalid player data** - Player might not have tracking stats for the requested season
4. **Endpoint issues** - The NBA occasionally changes or deprecates endpoints

### Quick Fixes

#### Fix 1: Wait and Retry
The simplest solution is often just waiting 30-60 seconds and refreshing the page.

```bash
# Wait 30 seconds, then refresh your browser
```

#### Fix 2: Check Console Logs
Open your browser console (F12) and look for detailed error messages:

```
[NBA API] Fetching: https://stats.nba.com/stats/...
[NBA API] Error 500: Internal Server Error
[Tracking Stats] Could not fetch passing data: NBA API 500
```

This tells you which specific endpoint is failing.

#### Fix 3: Try Different Players
Some players might not have tracking stats available. Try these known players with good data:

- **Giannis Antetokounmpo** (ID: 203507)
- **LeBron James** (ID: 2544)
- **Luka Dončić** (ID: 1629029)
- **Nikola Jokić** (ID: 203999)

#### Fix 4: Try Previous Season
If current season data isn't available yet:

```tsx
<TrackingStatsCard 
  playerId="203507"
  playerName="Giannis"
  season={2023}  // Try 2023 instead of 2024
/>
```

### Debugging Steps

#### Step 1: Test the API Directly

Open a new browser tab and visit:
```
http://localhost:3000/api/tracking-stats?player_id=203507
```

You should see JSON data or an error message. This helps identify if it's:
- **Frontend issue** - If API returns data but UI shows error
- **Backend issue** - If API returns error
- **NBA API issue** - If you see NBA-specific error messages

#### Step 2: Check Network Tab

1. Open browser DevTools (F12)
2. Go to "Network" tab
3. Refresh the page
4. Look for request to `/api/tracking-stats`
5. Click on it and check:
   - **Status**: Should be 200 (OK) or shows error code
   - **Response**: Shows the actual error from NBA
   - **Timing**: If it takes >10 seconds, it's timing out

#### Step 3: Check Server Logs

If running locally, check your terminal where `npm run dev` is running:

```
[NBA API] Fetching: https://stats.nba.com/stats/leaguedashptstats?...
[NBA API] Error 500: Internal Server Error
[Tracking Stats] Could not fetch passing data: NBA API 500
```

These logs show exactly which NBA endpoint is failing.

### Advanced Debugging

#### Enable Verbose Logging

Temporarily add this to `app/api/tracking-stats/route.ts`:

```typescript
// After line 48 (in nbaFetch function), add:
console.log('[DEBUG] Request URL:', url);
console.log('[DEBUG] Request headers:', NBA_HEADERS);
```

Then check your server console for the full request details.

#### Test NBA API Directly (External)

Open a terminal and run:

```bash
curl -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://www.nba.com/" \
  "https://stats.nba.com/stats/leaguedashptstats?LeagueID=00&Season=2024-25&SeasonType=Regular+Season&PerMode=PerGame&PlayerOrTeam=Player&PtMeasureType=Passing"
```

If this returns an error, the NBA API itself is having issues (not our code).

### Known Issues & Solutions

#### Issue 1: "No tracking data available"

**Cause**: Player doesn't have stats for the selected season.

**Solution**: 
- Try previous season (2023 instead of 2024)
- Verify player has actually played games this season
- Some players don't have tracking stats if they played < 5 games

#### Issue 2: Request Timeout

**Cause**: NBA API is slow or unresponsive.

**Solution**:
- Increased timeout to 10 seconds in latest update
- If still timing out, NBA API is likely having server issues
- Try again in 5-10 minutes

#### Issue 3: Rate Limiting (429 Error)

**Cause**: Too many requests to NBA API.

**Solution**:
- Wait 60 seconds before trying again
- Our API has built-in rate limiting to prevent this
- If multiple users testing simultaneously, this can happen

#### Issue 4: CORS Errors

**Cause**: Trying to call NBA API directly from frontend.

**Solution**:
- Always use `/api/tracking-stats` endpoint (not direct NBA calls)
- Our server-side proxy handles CORS properly

### Configuration Tweaks

#### Increase Timeout

If NBA API is consistently slow, increase timeout in `app/api/tracking-stats/route.ts`:

```typescript
async function nbaFetch(pathAndQuery: string, timeoutMs = 15000) { // Was 10000
  // ...
}
```

#### Adjust Cache Duration

For more frequent updates, reduce cache time:

```typescript
headers: {
  'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600'
  // Was: s-maxage=1800 (30 min), now 600 (10 min)
}
```

#### Add Retry Logic

Add automatic retries in `app/api/tracking-stats/route.ts`:

```typescript
async function nbaFetchWithRetry(url: string, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      return await nbaFetch(url);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}
```

### When NBA API is Down

If the NBA Stats API is genuinely down (happens occasionally):

#### Option 1: Graceful Degradation

The component already handles this - it shows a friendly error message.

#### Option 2: Use Cached Data

If you have Supabase or a database, you could cache tracking stats:

```typescript
// Check cache first
const cached = await getCachedTrackingStats(playerId, season);
if (cached && Date.now() - cached.timestamp < 86400000) { // 24 hours
  return cached.data;
}

// Try NBA API
try {
  const data = await fetchFromNBA();
  await cacheTrackingStats(playerId, season, data);
  return data;
} catch {
  // Return stale cache if NBA API fails
  return cached?.data || null;
}
```

#### Option 3: Alternative Data Source

As a fallback, you could use ESPN or Basketball Reference APIs (though they require different parsers).

### Checking NBA API Status

#### Manual Check

Visit in your browser:
```
https://stats.nba.com/
```

If the website itself is slow or down, the API is likely affected too.

#### Programmatic Check

Add a health check endpoint to test NBA API availability:

```typescript
// app/api/tracking-stats/health/route.ts
export async function GET() {
  try {
    const response = await fetch('https://stats.nba.com/stats/commonplayerinfo?PlayerID=2544');
    return NextResponse.json({ 
      status: response.ok ? 'healthy' : 'degraded',
      statusCode: response.status 
    });
  } catch {
    return NextResponse.json({ status: 'down' }, { status: 503 });
  }
}
```

Then check: `http://localhost:3000/api/tracking-stats/health`

### Prevention Tips

1. **Use Demo Page First**: Always test on `/nba/tracking-stats-demo` before integrating
2. **Monitor Console**: Keep DevTools open when developing
3. **Test Popular Players**: Start with known-good player IDs
4. **Rate Limiting**: Don't make rapid requests in quick succession
5. **Cache Responses**: Let the built-in cache work (don't force refresh constantly)

### Getting Help

If none of these solutions work:

1. **Check the logs**: Look at both browser console and server terminal
2. **Verify player ID**: Make sure the player ID is correct and player exists
3. **Test with curl**: Verify NBA API is accessible from your network
4. **Check NBA's site**: Visit stats.nba.com to see if it's working
5. **Wait it out**: NBA API issues usually resolve within an hour

### Error Messages Decoded

| Error Message | Meaning | Solution |
|--------------|---------|----------|
| `NBA API 500` | NBA's server error | Wait 5-10 minutes, retry |
| `NBA API 429` | Rate limited | Wait 60 seconds |
| `Request timeout` | NBA API too slow | Increase timeout or retry later |
| `No tracking data available` | Player has no stats | Try different season/player |
| `PLAYER_ID not found` | Invalid player ID | Verify player ID is correct |
| `Failed to parse response` | NBA changed format | Code update needed |

### Still Having Issues?

Create a minimal reproduction:

```bash
# Test with curl
curl "http://localhost:3000/api/tracking-stats?player_id=203507&season=2024"

# Check the exact error
# Copy the full error message
# Note: What player ID, what season, what time
```

The most common cause is simply that the NBA API is temporarily having issues. When in doubt, wait 30-60 seconds and try again!

---

**Last Updated**: November 21, 2025  
**Status**: Active troubleshooting guide


