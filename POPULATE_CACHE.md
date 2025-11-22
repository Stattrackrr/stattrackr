# How to Populate NBA API Cache

## Problem
The NBA API is **unreachable from Vercel's network**. This means:
- ✅ Your endpoints now return empty data instead of 504 errors
- ❌ Cache cannot be populated from Vercel
- ✅ Cache can be populated from your local machine or another server

## Solution Options

### Option 1: Populate Cache from Local Machine (Quick Test)

1. **Start your local dev server:**
   ```bash
   npm run dev
   ```

2. **Call the cache refresh endpoint:**
   ```bash
   # Open in browser or use curl:
   http://localhost:3000/api/cache/nba-league-data?season=2025&force=true
   ```

3. **This will populate:**
   - Play type defensive rankings (for all teams)
   - Shot zone defensive rankings (for all teams)
   - Player play type data (bulk cache)

4. **For individual player data**, visit your dashboard locally and browse players - this will cache their data.

### Option 2: Use External Cron Service (Recommended for Production)

Since Vercel can't reach NBA API, use an external cron service:

1. **Set up a cron job** (e.g., cron-job.org, EasyCron, or GitHub Actions)
2. **Point it to:** `https://www.stattrackr.co/api/cache/nba-league-data?season=2025&force=true`
3. **Schedule:** Run daily at 3 AM EST (after games finish)

**Note:** This still won't work if the cron service also can't reach NBA API. You may need to run it from a server you control.

### Option 3: Use a Proxy Service

1. Set up a proxy server (e.g., on AWS, DigitalOcean, etc.)
2. Have the proxy fetch NBA API data
3. Store results in your cache/database
4. Your Vercel app reads from cache

### Option 4: Manual Cache Population (For Testing)

1. Visit your dashboard locally
2. Browse different players - this will cache their shot charts and play types
3. Browse different teams - this will cache team tracking stats
4. The cache will persist and be available in production

## Current Status

✅ **504 errors are fixed** - endpoints return empty data gracefully
✅ **Cache works** - if data exists in cache, it's returned immediately
⚠️ **Cache is empty** - needs to be populated from a network that can reach NBA API

## Next Steps

1. **Wait for deployment** (2-3 minutes)
2. **Test that 504 errors are gone** - visit your dashboard
3. **Populate cache** using one of the options above
4. **Verify data appears** - refresh your dashboard

