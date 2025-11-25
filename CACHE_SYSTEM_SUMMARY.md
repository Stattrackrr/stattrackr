# Cache System Summary

## ✅ Current Status - All Good!

Your cache system is fully configured and working. Here's what's happening:

### 1. **GitHub Actions Auto-Ingest** (Cloud-Based, No PC Needed!)

**Location:** `.github/workflows/cache-refresh.yml`

**Runs on:** GitHub's servers (cloud) - **Your PC does NOT need to be on!**

**Schedule:**
- **3:30 AM ET daily:** Player stats refresh
- **5:30 AM ET daily:** All caches refresh

**What it refreshes:**
- ✅ Player stats
- ✅ Player search
- ✅ ESPN player data

### 2. **Vercel Cron Jobs** (Also Cloud-Based!)

**Runs on:** Vercel's servers (cloud) - **Your PC does NOT need to be on!**

| Cron | Path | Schedule | Purpose |
|------|------|----------|---------|
| NBA Stats Refresh | `/api/cron/refresh-nba-stats` | Daily | Potentials, play types, defensive rankings, team defense |
| Odds Refresh (NEW) | `/api/odds/refresh` | Every 90 minutes (00:00, 01:30, 03:00...) | Updates odds cache + saves to Supabase |
| Odds Cleanup (NEW cadence) | `/api/odds/cleanup` & `/api/cron/cleanup-odds-snapshots` | Daily (24h) | Purges odds snapshots older than 24h |

### 3. **Supabase Cache** (Persistent, Shared)

All refreshed data is saved to Supabase, so:
- ✅ All Vercel instances can read the same cache
- ✅ No per-instance cache misses
- ✅ Works consistently in production

## 📋 What Gets Refreshed

| Data Type | Refresh Method | Frequency | Supabase? |
|-----------|---------------|-----------|-----------|
| Player Stats | GitHub Actions | Daily (3:30 AM ET) | ✅ Yes |
| Potentials (Tracking Stats) | Vercel Cron | Daily | ✅ Yes |
| Play Types | Vercel Cron | Daily | ✅ Yes |
| Defensive Rankings | Vercel Cron | Daily | ✅ Yes |
| Team Defense Rankings | Vercel Cron | Daily | ✅ Yes |
| Shot Charts | On-demand | When accessed | ✅ Yes |
| **Odds** | **Vercel Cron** | **Every 90 minutes + daily cleanup** | ✅ Yes |

## 🎯 Summary

**Your PC does NOT need to be on!** Everything runs in the cloud:
- GitHub Actions runs on GitHub's servers
- Vercel Cron runs on Vercel's servers
- All data is saved to Supabase (persistent, shared)

**Odds are now refreshed every 90 minutes** and **cleaned up daily**, so you get fresh data without Supabase bloat. 🎉

