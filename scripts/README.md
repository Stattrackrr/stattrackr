# NBA Stats Refresh Scripts

## Daily Refresh Script

To keep production NBA stats fresh, run the daily refresh script once per day.

### Quick Start

1. **Start your local dev server:**
   ```powershell
   npm run dev
   ```

2. **Run the daily refresh script:**
   ```powershell
   .\scripts\daily-nba-refresh.ps1
   ```

This will:
- ✅ Refresh bulk player play types (all 1,500+ players)
- ✅ Refresh defensive rankings (all 11 play types, 30 teams each)
- ✅ Refresh zone defense rankings (all 30 teams)
- ✅ Cache everything to Supabase (production will use this cache)

### Automated Daily Refresh (Windows Task Scheduler)

1. Open **Task Scheduler** (search for it in Windows)
2. Click **Create Basic Task**
3. Name it: `NBA Stats Daily Refresh`
4. Set trigger to **Daily** at your preferred time (e.g., 2:00 AM)
5. Action: **Start a program**
   - Program: `powershell.exe`
   - Arguments: `-File "C:\Users\nduar\stattrackr\scripts\daily-nba-refresh.ps1"`
   - Start in: `C:\Users\nduar\stattrackr`
6. Check **"Run whether user is logged on or not"** (optional)
7. Click **Finish**

**Note:** Make sure your dev server is running when the scheduled task runs, or the script will fail.

### What Gets Refreshed

- **Bulk Player Play Types**: All players' play type statistics (11 play types)
- **Defensive Rankings**: Team rankings for each play type (11 play types × 30 teams)
- **Zone Defense Rankings**: Team defensive stats by shot zone (6 zones × 30 teams)

### Cache Duration

- Cache expires after **24 hours**
- Production automatically uses cached data from Supabase
- No NBA API calls needed in production (faster, more reliable)

### Other Scripts

- `refresh-bulk-only-local.ps1` - Just the bulk refresh (no team tracking)
- `refresh-all-teams-local.ps1` - Team tracking stats only (passing/rebounding)
- `refresh-all-bulk-local.ps1` - Everything (bulk + team tracking)

