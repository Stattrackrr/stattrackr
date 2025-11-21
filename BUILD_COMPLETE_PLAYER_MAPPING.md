# 🏀 Building Complete Player ID Mapping

## The Problem

Your dashboard uses **BallDontLie player IDs**, but NBA Tracking Stats use **NBA Stats API IDs**. These are different numbering systems for the same players.

## The Solution

Build a complete mapping between the two ID systems so tracking stats work for **every player**.

---

## 🚀 Quick Start (Automated)

### Option 1: Full Auto-Match (Recommended)

This script automatically matches ALL players by name:

```bash
# Make sure dev server is running
npm run dev

# In another terminal:
node scripts/build-tracking-stats-mapping.js
```

**What it does:**
1. ✅ Fetches all ~470 players from NBA Tracking Stats API
2. ✅ Fetches all players from your BallDontLie database
3. ✅ Matches them automatically by name
4. ✅ Generates complete `lib/playerIdMapping.ts` file
5. ✅ Ready to use immediately!

**Then restart your dev server:**
```bash
# Press Ctrl+C
npm run dev
```

**Done!** Tracking stats now work for all players. 🎉

---

## 📋 Option 2: Manual Review (If Auto-Match Needs Tweaking)

If you want to review the IDs first:

### Step 1: Export NBA Tracking Stats IDs

```bash
node scripts/export-tracking-stats-ids.js
```

This creates `scripts/tracking-stats-players.json` with all ~470 players.

### Step 2: View the Export

```bash
# Windows PowerShell:
cat scripts/tracking-stats-players.json | more

# Or open in VS Code:
code scripts/tracking-stats-players.json
```

You'll see:
```json
[
  {
    "nbaId": "2544",
    "name": "LeBron James",
    "teamId": 1610612747,
    "team": "LAL"
  },
  {
    "nbaId": "201939",
    "name": "Stephen Curry",
    "teamId": 1610612744,
    "team": "GSW"
  },
  ...
]
```

### Step 3: Find Your Players

Search for specific players:

```bash
# Windows PowerShell:
cat scripts/tracking-stats-players.json | Select-String "Damian Lillard"

# Result shows:
# "name": "Damian Lillard",
# "nbaId": "203081",
```

### Step 4: Add to Mapping

Edit `lib/playerIdMapping.ts` and add entries:

```typescript
export const PLAYER_ID_MAPPINGS: PlayerIdMapping[] = [
  // ... existing mappings ...
  
  { bdlId: 'YOUR_BDL_ID', nbaId: '203081', name: 'Damian Lillard' },
  // Add more...
];
```

---

## 🔍 How to Find BallDontLie IDs

### Method 1: From Your Dashboard

1. Open your dashboard
2. Select a player
3. Look at the console or URL - you'll see their BDL ID

### Method 2: From API

```bash
curl "http://localhost:3000/api/bdl/players?search=LeBron"
```

Returns:
```json
{
  "data": [{
    "id": 2544,  // <-- This is the BDL ID
    "first_name": "LeBron",
    "last_name": "James"
  }]
}
```

---

## 🎯 Verifying the Mapping Works

### Test Individual Player:

```bash
# Test with NBA ID (from tracking stats)
curl "http://localhost:3000/api/tracking-stats?player_id=203081&season=2025"
```

Should return tracking stats data (not 404)!

### Test in Dashboard:

1. Start dev server: `npm run dev`
2. Go to: `http://localhost:3000/nba/research/dashboard`
3. Select any player
4. Scroll down to "Advanced Tracking Stats"
5. Should see Potential Assists & Rebound Chances! 🎉

---

## 📊 Understanding the Mapping File

```typescript
// lib/playerIdMapping.ts

export const PLAYER_ID_MAPPINGS: PlayerIdMapping[] = [
  { 
    bdlId: '237',      // BallDontLie ID (your dashboard uses this)
    nbaId: '201939',   // NBA Stats API ID (tracking stats uses this)
    name: 'Stephen Curry' 
  },
  // ... 470+ more players ...
];
```

The component automatically converts IDs:
- User selects player with BDL ID `237`
- Component converts to NBA ID `201939`
- Fetches tracking stats with correct ID
- Shows Potential Assists & Rebounds

---

## 🛠️ Troubleshooting

### Issue: "Dev server not running"

**Solution:**
```bash
# Terminal 1:
npm run dev

# Terminal 2:
node scripts/build-tracking-stats-mapping.js
```

### Issue: Script times out

**Solution:**
```bash
# Increase timeout by editing the script
# Or run manual export instead:
node scripts/export-tracking-stats-ids.js
```

### Issue: Some players not matching

**Cause:** Name differences (e.g., "P.J. Washington" vs "PJ Washington")

**Solution:** Manually add those players to the mapping file.

### Issue: Player still shows "No tracking data"

**Possible causes:**
1. Player hasn't played enough games this season
2. Player ID is correct but tracking stats not available
3. Mapping not loaded (restart dev server)

**Debug:**
```bash
# Check if player is in tracking stats:
node scripts/export-tracking-stats-ids.js
# Then search the JSON file for the player name
```

---

## 📈 Stats Available After Mapping

Once mapping is complete, you'll see for each player:

### 🎯 Passing & Playmaking:
- **Potential Assists** - Passes that would be assists if shot was made
- **Assist Points Created** - Points generated from assists  
- **Passes Made** - Total passes per game
- **Assist %** - Pass to assist conversion rate
- **Secondary Assists** - Hockey assists

### 🏀 Rebounding Tracking:
- **Rebound Chances** - Rebounding opportunities
- **Rebound Chance %** - Conversion rate
- **Contested Rebounds** - Grabbed with defenders near
- **Uncontested Rebounds** - Grabbed freely
- **Offensive/Defensive Breakdown**

---

## 🎉 Success Checklist

- [ ] Run `node scripts/build-tracking-stats-mapping.js`
- [ ] See "✅ Generated mapping file" message
- [ ] Restart dev server
- [ ] Open dashboard
- [ ] Select any player
- [ ] Scroll to "Advanced Tracking Stats"
- [ ] See real data (not warning box)
- [ ] Verify Potential Assists & Rebound Chances show numbers

---

## 💡 Pro Tips

### Tip 1: Update Periodically

Run the script monthly to catch new players:
```bash
node scripts/build-tracking-stats-mapping.js
```

### Tip 2: Version Control

The mapping file is auto-generated, so:
- Commit it to git
- Team members get it automatically
- No manual work needed

### Tip 3: Fallback Behavior

If a player isn't mapped:
- Component silently hides (no error)
- Rest of dashboard works fine
- Add mapping when needed

---

## 🆘 Need Help?

**Check console logs:**
```bash
# In browser (F12):
[TrackingStats] Converted player ID: 237 (bdl) → 201939 (NBA)
[TrackingStats] Found player! Parsed 35 stat fields
```

**Check server logs:**
```bash
# In terminal where npm run dev is running:
[Tracking Stats] Passing data fetched successfully
[Tracking Stats] Rebounding data fetched successfully
```

**Still stuck?**
1. Check `BUILD_COMPLETE_PLAYER_MAPPING.md` (this file)
2. Review `docs/TRACKING_STATS_TROUBLESHOOTING.md`
3. Run `node scripts/export-tracking-stats-ids.js` to see available IDs

---

**Ready?** Run the auto-match script now:

```bash
node scripts/build-tracking-stats-mapping.js
```

That's it! 🎯


