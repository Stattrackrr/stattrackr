# Daily Player Cache Refresh - Windows Scheduled Task

This project uses a **Windows Scheduled Task** to refresh all NBA player shot charts and play type analysis daily.

## Setup Instructions

### 1. Prerequisites
- Windows PC with PowerShell
- Node.js and npm installed
- Project dependencies installed (`npm install`)
- `.env.local` configured with Supabase credentials

### 2. Create the Scheduled Task

1. **Open PowerShell as Administrator** (Right-click → Run as Administrator)
2. Navigate to your project directory:
   ```powershell
   cd C:\Users\nduar\stattrackr
   ```
3. Run the setup script:
   ```powershell
   .\scripts\setup-scheduled-task.ps1
   ```

This creates a scheduled task that runs **daily at 12:00 AM (midnight)** in your PC's local timezone.

### 3. Test the Refresh Manually

Before relying on the scheduled task, test it:
```powershell
.\scripts\run-daily-refresh.ps1
```

### 4. View/Manage the Task

- **Open Task Scheduler**: Press `Win + R`, type `taskschd.msc`, press Enter
- **Find the task**: Look for "StatTrackr Daily Player Cache Refresh"
- **Right-click** to:
  - **Run** - Execute immediately
  - **Properties** - Change schedule, time, etc.
  - **History** - View past runs and logs

## How It Works

1. **Checks if dev server is running** - If not, starts it automatically
2. **Calls refresh endpoint** - `/api/cron/refresh-all-player-caches`
3. **Processes all 525+ players** - Fetches fresh stats from NBA API
4. **Caches to Supabase** - Stores all data for production use
5. **Logs results** - Saves to `logs\refresh-YYYY-MM-DD.log`

## Requirements

- **PC must be on** at the scheduled time (12:00 AM)
- **Internet connection** required (for NBA API and Supabase)
- **Dev server** will start automatically if not running

## Troubleshooting

### Task Not Running
- Check Task Scheduler → History tab for errors
- Verify PC was on at scheduled time
- Check logs in `logs\refresh-YYYY-MM-DD.log`

### Server Won't Start
- Ensure `npm install` has been run
- Check `.env.local` has correct Supabase credentials
- Verify Node.js is installed and in PATH

### Refresh Fails
- Check logs for specific error messages
- Verify NBA API is accessible from your network
- Ensure Supabase credentials are correct

## Manual Refresh

To run the refresh manually at any time:
```powershell
.\scripts\run-daily-refresh.ps1
```

Or use the simpler trigger script:
```powershell
.\scripts\trigger-refresh-local.ps1
```

## Notes

- The refresh takes approximately **30-35 minutes** to complete
- All 525+ active players are processed
- Data is cached for **365 days** (updated when new stats are available)
- The task runs in the background - your PC can be used normally

