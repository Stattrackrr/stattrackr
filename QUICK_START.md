# Quick Start Guide - Populate NBA Cache

## 🎯 Goal
Populate Supabase cache locally so production can read from it (since production can't reliably reach NBA API or Supabase).

## 📋 Step-by-Step

### Step 1: Start Dev Server
```powershell
# In your main terminal
npm run dev
```
**Wait for:** `Ready` or `Local: http://localhost:3000`  
**⚠️ Keep this terminal open!**

---

### Step 2: Populate ALL Player Data (NEW Terminal)
```powershell
# Open a NEW PowerShell window
cd C:\Users\nduar\stattrackr
.\scripts\cache-all-player-data.ps1 -TopPlayers 50
```

**This will cache:**
- ✅ Shot Charts (for all players)
- ✅ Play Type Analysis (for play type filter)
- ✅ Team Tracking Stats (for potentials)
- ⏱️ Takes 15-30 minutes for 50 players

**Or cache specific players:**
```powershell
.\scripts\cache-all-player-data.ps1 -PlayerIds @(203076, 201939, 2544)
```

---

### Step 3: Populate Bulk Rankings (Optional but Recommended)
```powershell
.\scripts\refresh-bulk-only-local.ps1
```

**This will:**
- ✅ Fetch all player play types (bulk)
- ✅ Fetch all defensive rankings (bulk)
- ✅ Fetch all zone defense rankings (all 30 teams)
- ⏱️ Takes 5-10 minutes

**Wait for:** `✅ All bulk refreshes complete!`

---

### Step 4: Test Production
```powershell
Invoke-RestMethod -Uri "https://stattrackr.co/api/shot-chart-enhanced?playerId=203076&season=2025" -Method GET
```

**Check Vercel logs for:**
- ✅ `Cache HIT (REST API)` = Success!
- ⏱️ `Supabase timeout` = Still slow, but cache should work eventually

---

## 🔄 Daily Refresh (Optional)

To keep cache fresh, run daily:
```powershell
# Cache player-specific data
.\scripts\cache-all-player-data.ps1 -TopPlayers 50

# Cache bulk rankings
.\scripts\refresh-bulk-only-local.ps1
```

Or set up Windows Task Scheduler (see `scripts/README.md`)

---

## 🐛 Troubleshooting

**Cache not found?**
- Make sure Step 2 completed successfully
- Check Supabase dashboard → `nba_api_cache` table has data

**Still timing out?**
- Supabase might be slow from Vercel
- Cache will still work, just slower
- Consider upgrading Supabase plan if on free tier

**Script fails?**
- Make sure dev server is running (`npm run dev`)
- Check you're in the right directory
- Check PowerShell execution policy: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

