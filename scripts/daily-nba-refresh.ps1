# Daily NBA Stats Refresh Script
# 
# This script refreshes all bulk NBA data and caches it to Supabase.
# Production will automatically use this cached data.
#
# Usage:
#   .\scripts\daily-nba-refresh.ps1
#
# To run automatically daily:
#   1. Open Task Scheduler (Windows)
#   2. Create Basic Task
#   3. Set trigger to "Daily" at your preferred time
#   4. Action: Start a program
#   5. Program: powershell.exe
#   6. Arguments: -File "C:\Users\nduar\stattrackr\scripts\daily-nba-refresh.ps1"
#   7. Start in: C:\Users\nduar\stattrackr
#
# Make sure your local dev server is running before scheduling!

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptPath

# Change to project directory
Set-Location $projectRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Daily NBA Stats Refresh" -ForegroundColor Yellow
Write-Host "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host "========================================`n" -ForegroundColor Cyan

# Check if local server is running
Write-Host "Checking if local dev server is running..." -ForegroundColor Yellow
try {
    $testResponse = Invoke-WebRequest -Uri "http://localhost:3000" -Method GET -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    Write-Host "  ✅ Local server is running`n" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Local server is NOT running!" -ForegroundColor Red
    Write-Host "  Please start your dev server first:" -ForegroundColor Yellow
    Write-Host "    npm run dev" -ForegroundColor White
    Write-Host "`nPress any key to exit..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

# Run the bulk refresh
Write-Host "Starting bulk refresh...`n" -ForegroundColor Yellow
& "$scriptPath\refresh-bulk-only-local.ps1"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Daily Refresh Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nProduction will now have access to the latest cached data." -ForegroundColor Green
Write-Host "Cache expires after 24 hours, so run this daily." -ForegroundColor Gray

