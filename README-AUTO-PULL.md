# Auto-Pull Setup for VS Code

This guide shows you how to automatically pull the latest game data from GitHub into VS Code.

## Option 1: VS Code Built-in Auto-Fetch (Recommended - Easiest)

VS Code will automatically fetch changes in the background. When you see a notification, just click "Pull" or use the command palette.

**Already configured!** The `.vscode/settings.json` file has been set up with:
- Auto-fetch every 3 minutes
- Smart commit enabled

**How to use:**
1. VS Code will show a notification when new changes are available
2. Click the notification or use `Ctrl+Shift+P` → "Git: Pull"
3. Or use the VS Code task: `Ctrl+Shift+P` → "Tasks: Run Task" → "Pull Latest Changes"

## Option 2: Windows Scheduled Task (Fully Automatic)

This runs a script every 15 minutes to automatically pull changes.

**Setup:**
1. Open PowerShell in the repository folder
2. Run: `.\scripts\setup-auto-pull.ps1`
   - You may need to run PowerShell as Administrator
3. The task will run automatically in the background

**To remove the scheduled task:**
```powershell
Unregister-ScheduledTask -TaskName "StatTrackr Auto-Pull" -Confirm:$false
```

## Option 3: Manual Script (When You Want)

Run the script manually whenever you want to pull:
```powershell
.\scripts\auto-pull.ps1
```

## What Happens When Changes Are Pulled

1. The script checks for new commits from GitHub
2. If you have uncommitted changes, it stashes them temporarily
3. Pulls the latest changes
4. Restores your uncommitted changes
5. Shows you what changed

## VS Code Tasks

You can also use VS Code tasks:
- `Ctrl+Shift+P` → "Tasks: Run Task"
- Select "Auto Pull from GitHub" or "Pull Latest Changes"

The "Auto Pull from GitHub" task runs automatically when you open the folder (if configured).

