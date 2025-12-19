# PowerShell script to set up Windows Scheduled Task for daily refresh
# Run this script as Administrator
#
# Usage:
#   .\scripts\setup-scheduled-task.ps1
#
# This will create a scheduled task that runs daily at 5:30 AM

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "❌ This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$refreshScript = Join-Path $scriptDir "run-daily-refresh.ps1"
$taskName = "StatTrackr Daily Player Cache Refresh"
$taskDescription = "Refreshes all NBA player shot charts and play type analysis daily"

# Verify refresh script exists
if (-not (Test-Path $refreshScript)) {
    Write-Host "❌ Refresh script not found: $refreshScript" -ForegroundColor Red
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setting up Scheduled Task" -ForegroundColor Yellow
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
Write-Host "  Schedule: Daily at 5:30 AM" -ForegroundColor Gray
Write-Host ""

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$refreshScript`"" -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At "5:30AM"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

try {
    Register-ScheduledTask -TaskName $taskName -Description $taskDescription -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    
    Write-Host "✅ Scheduled task created successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Task Details:" -ForegroundColor Yellow
    Write-Host "  Name: $taskName" -ForegroundColor White
    Write-Host "  Schedule: Daily at 5:30 AM" -ForegroundColor White
    Write-Host "  Script: $refreshScript" -ForegroundColor White
    Write-Host ""
    Write-Host "To view/manage the task:" -ForegroundColor Yellow
    Write-Host "  1. Open Task Scheduler (taskschd.msc)" -ForegroundColor Gray
    Write-Host "  2. Look for: $taskName" -ForegroundColor Gray
    Write-Host ""
    Write-Host "To test the task manually:" -ForegroundColor Yellow
    Write-Host "  .\scripts\run-daily-refresh.ps1" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Logs will be saved to: logs\refresh-YYYY-MM-DD.log" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "❌ Error creating scheduled task: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

