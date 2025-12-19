# PowerShell script to list all Windows Scheduled Tasks that run at midnight
# This helps identify duplicate or unnecessary tasks
#
# Usage:
#   .\scripts\list-midnight-tasks.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Windows Scheduled Tasks at Midnight" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get all scheduled tasks
$allTasks = Get-ScheduledTask | Where-Object { $_.State -eq 'Ready' -or $_.State -eq 'Running' }

$midnightTasks = @()

foreach ($task in $allTasks) {
    $triggers = $task.Triggers
    
    foreach ($trigger in $triggers) {
        if ($trigger -is [Microsoft.Management.Infrastructure.CimInstance]) {
            # Convert to proper type
            $trigger = [Microsoft.Management.Infrastructure.CimInstance]$trigger
        }
        
        # Check if it's a daily trigger at midnight (00:00)
        if ($trigger.CimClass.CimClassName -eq 'MSFT_TaskDailyTrigger') {
            $startTime = $trigger.StartBoundary
            if ($startTime) {
                $time = [DateTime]::Parse($startTime)
                if ($time.Hour -eq 0 -and $time.Minute -eq 0) {
                    $midnightTasks += [PSCustomObject]@{
                        TaskName = $task.TaskName
                        TaskPath = $task.TaskPath
                        State = $task.State
                        LastRunTime = $task.LastRunTime
                        NextRunTime = $task.NextRunTime
                        Description = $task.Description
                    }
                }
            }
        }
        
        # Also check for time-based triggers
        if ($trigger.CimClass.CimClassName -eq 'MSFT_TaskTimeTrigger') {
            $startTime = $trigger.StartBoundary
            if ($startTime) {
                $time = [DateTime]::Parse($startTime)
                if ($time.Hour -eq 0 -and $time.Minute -eq 0) {
                    $midnightTasks += [PSCustomObject]@{
                        TaskName = $task.TaskName
                        TaskPath = $task.TaskPath
                        State = $task.State
                        LastRunTime = $task.LastRunTime
                        NextRunTime = $task.NextRunTime
                        Description = $task.Description
                    }
                }
            }
        }
    }
}

if ($midnightTasks.Count -eq 0) {
    Write-Host "No tasks found scheduled at midnight (00:00)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Checking for tasks with 'StatTrackr' or 'NBA' in the name..." -ForegroundColor Gray
    Write-Host ""
    
    $relatedTasks = Get-ScheduledTask | Where-Object { 
        $_.TaskName -like "*StatTrackr*" -or 
        $_.TaskName -like "*NBA*" -or 
        $_.TaskName -like "*cache*" -or
        $_.TaskName -like "*refresh*" -or
        $_.TaskName -like "*player*"
    }
    
    if ($relatedTasks.Count -gt 0) {
        Write-Host "Found related tasks (may not be at midnight):" -ForegroundColor Yellow
        foreach ($task in $relatedTasks) {
            Write-Host ""
            Write-Host "  Task: $($task.TaskName)" -ForegroundColor White
            Write-Host "    Path: $($task.TaskPath)" -ForegroundColor Gray
            Write-Host "    State: $($task.State)" -ForegroundColor Gray
            Write-Host "    Last Run: $($task.LastRunTime)" -ForegroundColor Gray
            Write-Host "    Next Run: $($task.NextRunTime)" -ForegroundColor Gray
            if ($task.Description) {
                Write-Host "    Description: $($task.Description)" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "No related tasks found" -ForegroundColor Gray
    }
} else {
    Write-Host "Found $($midnightTasks.Count) task(s) scheduled at midnight:" -ForegroundColor Yellow
    Write-Host ""
    
    foreach ($task in $midnightTasks) {
        Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
        Write-Host "Task Name: $($task.TaskName)" -ForegroundColor White
        Write-Host "  Path: $($task.TaskPath)" -ForegroundColor Gray
        Write-Host "  State: $($task.State)" -ForegroundColor $(if ($task.State -eq 'Ready') { 'Green' } else { 'Yellow' })
        Write-Host "  Last Run: $($task.LastRunTime)" -ForegroundColor Gray
        Write-Host "  Next Run: $($task.NextRunTime)" -ForegroundColor Gray
        if ($task.Description) {
            Write-Host "  Description: $($task.Description)" -ForegroundColor Gray
        }
        Write-Host ""
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To view/edit tasks:" -ForegroundColor Yellow
Write-Host "  1. Open Task Scheduler: taskschd.msc" -ForegroundColor Gray
Write-Host "  2. Or run: Get-ScheduledTask | Format-Table TaskName, State, LastRunTime" -ForegroundColor Gray
Write-Host ""
Write-Host "To remove a task:" -ForegroundColor Yellow
Write-Host "  Unregister-ScheduledTask -TaskName 'TaskName' -Confirm:`$false" -ForegroundColor Gray
Write-Host ""

