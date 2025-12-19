# PowerShell script to remove old StatTrackr scheduled tasks
# Run this as Administrator
#
# Usage:
#   .\scripts\remove-old-stattrackr-tasks.ps1

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "❌ This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Remove Old StatTrackr Tasks" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$tasksToRemove = @(
    "Potentials stattrackr-shot",
    "StatTrackr-Refresh-Changed-Players",
    "StatTrackr Warm Rosters",
    "StatTrackr-Check-Changed-Players",
    "StatTrackr-Standalone-NBA-Cache"
)

$removed = 0
$notFound = 0

foreach ($taskName in $tasksToRemove) {
    try {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        
        if ($task) {
            Write-Host "Removing: $taskName..." -ForegroundColor Yellow
            if ($task.Description) {
                Write-Host "  Description: $($task.Description)" -ForegroundColor Gray
            }
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
            Write-Host "  ✅ Removed successfully" -ForegroundColor Green
            $removed++
        } else {
            Write-Host "  ⚠️  Task not found: $taskName" -ForegroundColor Yellow
            $notFound++
        }
    } catch {
        Write-Host "  ❌ Failed to remove $taskName : $($_.Exception.Message)" -ForegroundColor Red
    }
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Summary" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Removed: $removed" -ForegroundColor Green
Write-Host "  Not Found: $notFound" -ForegroundColor Yellow
Write-Host ""

if ($removed -gt 0) {
    Write-Host "✅ Old tasks removed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Your current task should be:" -ForegroundColor Yellow
    Write-Host "  'StatTrackr Daily Player Cache Refresh' (runs at midnight)" -ForegroundColor White
    Write-Host ""
    Write-Host "To verify, run:" -ForegroundColor Yellow
    Write-Host "  Get-ScheduledTask | Where-Object { `$_.TaskName -like '*StatTrackr*' }" -ForegroundColor Gray
}

