# PowerShell script to refresh Opponent Breakdown stats (for Dashboard DVP section)
# 
# This fetches team opponent stats from NBA API via local dev server
# and caches to Supabase for production to use.
#
# Usage:
#   .\scripts\refresh-opponent-breakdown.ps1
#   .\scripts\refresh-opponent-breakdown.ps1 -Season 2025
#
# Windows Task Scheduler:
#   Program: powershell.exe
#   Arguments: -ExecutionPolicy Bypass -File "C:\Users\nduar\stattrackr\scripts\refresh-opponent-breakdown.ps1"
#   Start in: C:\Users\nduar\stattrackr

param(
    [int]$Season = 0
)

$baseUrl = "http://localhost:3000"

# Calculate current NBA season if not provided
if ($Season -eq 0) {
    $now = Get-Date
    $month = $now.Month
    $day = $now.Day
    
    if ($month -eq 10 -and $day -ge 15) {
        $Season = $now.Year
    } elseif ($month -ge 11) {
        $Season = $now.Year
    } else {
        $Season = $now.Year - 1
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Opponent Breakdown Stats Refresh" -ForegroundColor Yellow
Write-Host "Season: $Season" -ForegroundColor Gray
Write-Host "========================================`n" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$serverProcess = $null
$serverWasRunning = $false

function Test-ServerRunning {
    try {
        $response = Invoke-WebRequest -Uri "$baseUrl/" -Method Get -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Start-DevServer {
    Write-Host "Starting dev server..." -ForegroundColor Yellow
    $nodeModules = Join-Path $projectRoot "node_modules"
    if (-not (Test-Path $nodeModules)) {
        Write-Host "  ❌ node_modules not found. Run 'npm install' first." -ForegroundColor Red
        exit 1
    }
    $process = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
    Write-Host "  Dev server starting (PID: $($process.Id))..." -ForegroundColor Gray
    $waited = 0
    $maxWait = 120
    while (-not (Test-ServerRunning) -and $waited -lt $maxWait) {
        Start-Sleep -Seconds 5
        $waited += 5
        Write-Host "  Waiting for server... ($waited/$maxWait seconds)" -ForegroundColor Gray
    }
    if (-not (Test-ServerRunning)) {
        Write-Host "  ❌ Server failed to start" -ForegroundColor Red
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        exit 1
    }
    Write-Host "  ✅ Server ready!`n" -ForegroundColor Green
    return $process
}

# Check if local server is running
Write-Host "Checking if local dev server is running..." -ForegroundColor Yellow
$serverWasRunning = Test-ServerRunning

if (-not $serverWasRunning) {
    Write-Host "  Server not running, starting it..." -ForegroundColor Yellow
    $serverProcess = Start-DevServer
} else {
    Write-Host "  ✅ Local server is running`n" -ForegroundColor Green
}

# Refresh opponent breakdown via nba-league-data endpoint
# This endpoint fetches leaguedashteamstats MeasureType=Opponent from NBA API
# and caches full opponent stats (pts, reb, ast, fg%, 3p%, stl, blk) + rankings
Write-Host "Refreshing Opponent Breakdown stats from NBA API..." -ForegroundColor Yellow
Write-Host "  Endpoint: /api/cache/nba-league-data" -ForegroundColor Gray
Write-Host "  This fetches OPP_PTS, OPP_REB, OPP_AST, OPP_FG_PCT, etc." -ForegroundColor Gray
Write-Host "  Estimated time: 2-5 minutes`n" -ForegroundColor Gray

try {
    $url = "$baseUrl/api/cache/nba-league-data?season=$Season&force=true"
    $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 600
    
    if ($response.success) {
        Write-Host "  ✅ Success!" -ForegroundColor Green
        
        if ($response.opponentDefensiveRankings) {
            Write-Host "     Opponent Breakdown: $($response.opponentDefensiveRankings.teamsCached) teams cached" -ForegroundColor Green
        }
        if ($response.opponentFreeThrows) {
            Write-Host "     Opponent FT Rankings: $($response.opponentFreeThrows.teamsCached) teams cached" -ForegroundColor Green
        }
        if ($response.summary) {
            Write-Host "     Play Types: $($response.summary.playTypesCached) cached" -ForegroundColor Gray
            Write-Host "     Player Play Types: $($response.summary.playerPlayTypesCached) cached" -ForegroundColor Gray
        }
    } else {
        Write-Host "  ⚠️ Response indicates failure" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Stop dev server if we started it
if (-not $serverWasRunning -and $serverProcess -and -not $serverProcess.HasExited) {
    Write-Host "`nStopping dev server (PID: $($serverProcess.Id))..." -ForegroundColor Gray
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Opponent Breakdown Refresh Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nProduction will now use cached opponent stats for:" -ForegroundColor Green
Write-Host "  ✅ Opponent Breakdown card (pts/reb/ast/fg%/3p%/stl/blk)" -ForegroundColor Green
Write-Host "  ✅ Team defensive rankings (rank 1-30)" -ForegroundColor Green
Write-Host "`nCache key: team_defensive_stats_rankings:$Season" -ForegroundColor Gray
Write-Host "Stored in: Supabase nba_api_cache table" -ForegroundColor Gray

