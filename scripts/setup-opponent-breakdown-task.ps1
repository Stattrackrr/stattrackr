# PowerShell script to set up Windows Scheduled Task for opponent breakdown refresh
# Run this script as Administrator
#
# Usage:
#   .\scripts\setup-opponent-breakdown-task.ps1
#   .\scripts\setup-opponent-breakdown-task.ps1 -Time "6:00AM"
#
# This creates a scheduled task that runs daily at the specified time

param(
    [string]$Time = "5:00AM"
)

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "❌ This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$refreshScript = Join-Path $scriptDir "refresh-opponent-breakdown.ps1"
$taskName = "StatTrackr Opponent Breakdown Refresh"
$taskDescription = "Refreshes NBA opponent breakdown stats daily (pts/reb/ast allowed per team)"

# Verify refresh script exists
if (-not (Test-Path $refreshScript)) {
    Write-Host "❌ Refresh script not found: $refreshScript" -ForegroundColor Red
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setting up Opponent Breakdown Task" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Remove existing task if it exists
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "Removing existing task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# Create the scheduled task
Write-Host "Creating scheduled task..." -ForegroundColor Yellow
Write-Host "  Task Name: $taskName" -ForegroundColor Gray
Write-Host "  Script: $refreshScript" -ForegroundColor Gray
$timezone = [System.TimeZoneInfo]::Local.DisplayName
Write-Host "  Schedule: Daily at $Time ($timezone)" -ForegroundColor Gray
Write-Host ""

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$refreshScript`"" -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

try {
    Register-ScheduledTask -TaskName $taskName -Description $taskDescription -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    
    Write-Host "✅ Scheduled task created successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Task Details:" -ForegroundColor Yellow
    Write-Host "  Name: $taskName" -ForegroundColor White
    Write-Host "  Schedule: Daily at $Time ($timezone)" -ForegroundColor White
    Write-Host "  Script: $refreshScript" -ForegroundColor White
    Write-Host ""
    Write-Host "IMPORTANT: Make sure dev server is running when task executes!" -ForegroundColor Yellow
    Write-Host "  Either keep 'npm run dev' running, or the task will fail." -ForegroundColor Gray
    Write-Host ""
    Write-Host "To view/manage the task:" -ForegroundColor Yellow
    Write-Host "  1. Open Task Scheduler (taskschd.msc)" -ForegroundColor Gray
    Write-Host "  2. Look for: $taskName" -ForegroundColor Gray
    Write-Host ""
    Write-Host "To test manually:" -ForegroundColor Yellow
    Write-Host "  .\scripts\refresh-opponent-breakdown.ps1" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "❌ Error creating scheduled task: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

