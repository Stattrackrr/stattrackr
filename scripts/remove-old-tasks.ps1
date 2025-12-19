# PowerShell script to remove old/duplicate StatTrackr scheduled tasks
# Run this as Administrator to remove tasks
#
# Usage:
#   .\scripts\remove-old-tasks.ps1
#   .\scripts\remove-old-tasks.ps1 -TaskName "Specific Task Name"

param(
    [string[]]$TaskNames = @()
)

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "❌ This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Remove Old StatTrackr Scheduled Tasks" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# If no task names provided, find all StatTrackr/NBA/cache related tasks
if ($TaskNames.Count -eq 0) {
    Write-Host "Searching for StatTrackr/NBA/cache related tasks..." -ForegroundColor Yellow
    Write-Host ""
    
    $allTasks = Get-ScheduledTask | Where-Object { 
        $_.TaskName -like "*StatTrackr*" -or 
        $_.TaskName -like "*NBA*" -or 
        $_.TaskName -like "*cache*" -or
        $_.TaskName -like "*refresh*" -or
        $_.TaskName -like "*populate*" -or
        $_.TaskName -like "*player*"
    }
    
    if ($allTasks.Count -eq 0) {
        Write-Host "No related tasks found" -ForegroundColor Yellow
        exit 0
    }
    
    Write-Host "Found $($allTasks.Count) related task(s):" -ForegroundColor Yellow
    Write-Host ""
    
    foreach ($task in $allTasks) {
        Write-Host "  - $($task.TaskName)" -ForegroundColor White
        Write-Host "    Path: $($task.TaskPath)" -ForegroundColor Gray
        Write-Host "    State: $($task.State)" -ForegroundColor Gray
        if ($task.Description) {
            Write-Host "    Description: $($task.Description)" -ForegroundColor Gray
        }
        Write-Host ""
    }
    
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host ""
    $response = Read-Host "Do you want to remove ALL of these tasks? (yes/no)"
    
    if ($response -ne "yes") {
        Write-Host "Cancelled. No tasks were removed." -ForegroundColor Yellow
        exit 0
    }
    
    $TaskNames = $allTasks.TaskName
}

# Remove each task
$removed = 0
$failed = 0

foreach ($taskName in $TaskNames) {
    try {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        
        if ($task) {
            Write-Host "Removing: $taskName..." -ForegroundColor Yellow
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
            Write-Host "  ✅ Removed successfully" -ForegroundColor Green
            $removed++
        } else {
            Write-Host "  ⚠️  Task not found: $taskName" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  ❌ Failed to remove $taskName : $($_.Exception.Message)" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Summary" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Removed: $removed" -ForegroundColor Green
Write-Host "  Failed: $failed" -ForegroundColor $(if ($failed -eq 0) { 'Green' } else { 'Red' })
Write-Host ""

