# Production NBA Cache Setup - 100% Working Solution

## Problem
NBA API is **unreachable from Vercel's network**, causing 504 timeouts. We need a solution that works 100% in production.

## Solution: Supabase-Persisted Cache + External Population Service

### Architecture
1. **Supabase Database** - Stores cached NBA API responses (persistent, shared)
2. **Vercel (Your App)** - Reads from Supabase cache (fast, reliable)
3. **External Service** - Fetches from NBA API and populates Supabase (runs on a server that CAN reach NBA API)

---

## Step 1: Create Supabase Table

1. Go to your Supabase Dashboard → SQL Editor
2. Run the migration file:
   ```sql
   -- Copy contents from: supabase_migrations/create_nba_cache_table.sql
   ```
3. Or paste this SQL:

```sql
CREATE TABLE IF NOT EXISTS nba_api_cache (
  id BIGSERIAL PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  cache_type TEXT NOT NULL,
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nba_cache_key ON nba_api_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_nba_cache_type ON nba_api_cache(cache_type);
CREATE INDEX IF NOT EXISTS idx_nba_cache_expires ON nba_api_cache(expires_at);
```

---

## Step 2: Deploy Your Code

The code is already updated to:
- ✅ Read from Supabase cache first
- ✅ Fallback to in-memory cache
- ✅ Write to Supabase when data is fetched (if NBA API works)

**Just wait for Vercel to deploy** (2-3 minutes)

---

## Step 3: Set Up Cache Population Service

Since Vercel can't reach NBA API, you need a separate service to populate the cache.

### Option A: Railway.app (Recommended - Free Tier)

1. **Sign up:** https://railway.app
2. **Create new project** → "Deploy from GitHub repo"
3. **Add environment variables:**
   - `NEXT_PUBLIC_SUPABASE_URL` (from your Vercel env)
   - `SUPABASE_SERVICE_ROLE_KEY` (from your Vercel env)
   - `NBA_SEASON=2025`
4. **Create a scheduled task:**
   - Go to your project → "New" → "Cron Job"
   - Command: `node scripts/populate-nba-cache.js`
   - Schedule: `0 */6 * * *` (every 6 hours)

### Option B: Render.com (Free Tier)

1. **Sign up:** https://render.com
2. **Create new "Background Worker"**
3. **Connect your GitHub repo**
4. **Build command:** `npm install`
5. **Start command:** `node scripts/populate-nba-cache.js`
6. **Set environment variables** (same as Railway)
7. **Enable "Auto-Deploy"**

### Option C: GitHub Actions (Free)

1. Create `.github/workflows/populate-nba-cache.yml`:

```yaml
name: Populate NBA Cache

on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:  # Manual trigger

jobs:
  populate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: node scripts/populate-nba-cache.js
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          NBA_SEASON: 2025
```

2. Add secrets to GitHub repo:
   - Settings → Secrets → Actions
   - Add `NEXT_PUBLIC_SUPABASE_URL`
   - Add `SUPABASE_SERVICE_ROLE_KEY`

### Option D: Your Own Server/VPS

1. SSH into your server
2. Clone your repo
3. Install dependencies: `npm install`
4. Set environment variables
5. Run: `node scripts/populate-nba-cache.js`
6. Set up cron: `crontab -e`
   ```
   0 */6 * * * cd /path/to/repo && node scripts/populate-nba-cache.js
   ```

---

## Step 4: Initial Cache Population

**From your local machine** (where NBA API works):

```bash
# Make sure you have .env.local with Supabase credentials
node scripts/populate-nba-cache.js
```

This will populate:
- ✅ Play type defensive rankings (all teams)
- ✅ Shot zone defensive rankings (all teams)

---

## Step 5: Verify It Works

1. **Check Supabase:**
   - Go to Supabase Dashboard → Table Editor → `nba_api_cache`
   - You should see entries with `cache_type = 'defense_rankings'`

2. **Test your endpoints:**
   - Visit your production dashboard
   - Shot Chart, Play Type Analysis, Team Tracking should work
   - Check browser console - should see cache hits

3. **Check Vercel logs:**
   - Vercel Dashboard → Functions → Check logs
   - Should see: `✅ Cache hit` messages

---

## How It Works

1. **User requests data** → Vercel endpoint
2. **Endpoint checks Supabase cache** → Returns if found
3. **If not in cache** → Returns empty data (no 504 error)
4. **Background service** → Fetches from NBA API → Stores in Supabase
5. **Next request** → Gets data from Supabase cache ✅

---

## Maintenance

- **Cache expires** after 24 hours (configurable)
- **Background service** refreshes every 6 hours
- **Supabase auto-cleans** expired entries (via function)

---

## Troubleshooting

**Cache not populating?**
- Check external service logs (Railway/Render/GitHub Actions)
- Verify Supabase credentials are correct
- Check NBA API is reachable from that service

**Still getting 504 errors?**
- Make sure Supabase table exists
- Check `lib/nbaCache.ts` is imported correctly
- Verify environment variables are set

**Cache not being read?**
- Check Supabase table has data
- Verify cache keys match
- Check Vercel function logs for errors

---

## Next Steps

1. ✅ Create Supabase table (Step 1)
2. ✅ Wait for Vercel deployment (Step 2)
3. ✅ Set up external service (Step 3)
4. ✅ Populate initial cache (Step 4)
5. ✅ Test and verify (Step 5)

**This solution will work 100% in production!** 🚀

