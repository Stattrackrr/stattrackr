# PowerShell script to cache BULK data: Play Types, Shot Charts, Defensive Rankings, Potentials
# This script uses bulk endpoints that fetch ALL players/teams at once (much faster!)
# 
# Usage:
#   .\scripts\cache-bulk.ps1  # Cache everything (production URL)
#   .\scripts\cache-bulk.ps1 -BaseUrl "http://localhost:3000"  # Local dev
#   .\scripts\cache-bulk.ps1 -SkipShotCharts  # Skip shot charts
#   .\scripts\cache-bulk.ps1 -SkipPlayTypes  # Skip play types
#   .\scripts\cache-bulk.ps1 -SkipPotentials  # Skip Potentials (team tracking stats)
#   .\scripts\cache-bulk.ps1 -SkipDefensiveRankings  # Skip defensive rankings

param(
    [string]$BaseUrl = "https://stattrackr.vercel.app",  # Default to production
    
    [int]$Season = 2025,
    
    [switch]$SkipShotCharts = $false,
    [switch]$SkipPlayTypes = $false,
    [switch]$SkipPotentials = $false,
    [switch]$SkipDefensiveRankings = $false
)

# NBA teams for tracking stats
$nbaTeams = @('ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 
              'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK', 
              'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS')

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "BULK CACHE WARM-UP" -ForegroundColor Yellow
Write-Host "Base URL: $BaseUrl" -ForegroundColor Gray
Write-Host "Season: $Season" -ForegroundColor Gray
Write-Host "========================================`n" -ForegroundColor Cyan

$startTime = Get-Date
$playTypeSuccess = $false
$shotChartSuccess = $false
$potentialsSuccess = 0
$potentialsFail = 0
$defensiveRankingsSuccess = $false

# Step 1: Cache Play Types (BULK - all players at once)
if (-not $SkipPlayTypes) {
    Write-Host "[1/4] Caching Play Types (BULK - all players)..." -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    
    try {
        $url = "$BaseUrl/api/cache/nba-league-data?season=$Season"
        Write-Host "  Calling: $url" -ForegroundColor Gray
        Write-Host "  This will fetch all 11 play types for ALL players (11 API calls total)..." -ForegroundColor Gray
        Write-Host "  Estimated time: 3-5 minutes`n" -ForegroundColor Gray
        
        $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 600  # 10 min timeout
        
        if ($response.success -and $response.playerPlayTypes) {
            $playTypesCached = $response.playerPlayTypes.playTypesCached
            $totalPlayers = $response.playerPlayTypes.totalPlayers
            Write-Host "  [OK] Cached $playTypesCached play types for $totalPlayers players" -ForegroundColor Green
            $playTypeSuccess = $true
        } else {
            Write-Host "  [WARN] Response missing expected data" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  [ERROR] Failed: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "[1/4] Skipping Play Types (--SkipPlayTypes)" -ForegroundColor Gray
}

Write-Host ""

# Step 2: Cache Shot Charts (BULK - all players at once)
if (-not $SkipShotCharts) {
    Write-Host "[2/4] Caching Shot Charts (BULK - all players)..." -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    
    Write-Host "  [INFO] Shot chart bulk endpoint not yet implemented" -ForegroundColor Yellow
    Write-Host "  [INFO] For now, use cache-everything.ps1 for individual player shot charts" -ForegroundColor Yellow
    Write-Host "  [INFO] Or wait for bulk shot chart endpoint to be created" -ForegroundColor Yellow
    
    # TODO: When bulk shot chart endpoint is created, uncomment this:
    # try {
    #     $url = "$BaseUrl/api/cache/shot-charts-bulk?season=$Season"
    #     Write-Host "  Calling: $url" -ForegroundColor Gray
    #     $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 600
    #     
    #     if ($response.success) {
    #         Write-Host "  [OK] Cached shot charts for all players" -ForegroundColor Green
    #         $shotChartSuccess = $true
    #     }
    # } catch {
    #     Write-Host "  [ERROR] Failed: $($_.Exception.Message)" -ForegroundColor Red
    # }
} else {
    Write-Host "[2/4] Skipping Shot Charts (--SkipShotCharts)" -ForegroundColor Gray
}

Write-Host ""

# Step 3: Cache Potentials (Team Tracking Stats - passing + rebounding)
if (-not $SkipPotentials) {
    Write-Host "[3/4] Caching Potentials (Team Tracking Stats)..." -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    
    $categories = @('passing', 'rebounding')
    
    foreach ($category in $categories) {
        Write-Host "  Caching $category potentials for all teams..." -ForegroundColor Gray
        
        foreach ($team in $nbaTeams) {
            try {
                $url = "$BaseUrl/api/tracking-stats/team?team=$team&category=$category&season=$Season"
                $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 60
                
                if ($response.success -or $response.data) {
                    $potentialsSuccess++
                } else {
                    $potentialsFail++
                }
            } catch {
                Write-Host "    [ERROR] $team $category : $($_.Exception.Message)" -ForegroundColor Red
                $potentialsFail++
            }
        }
    }
    
    Write-Host "  [OK] Potentials: $potentialsSuccess success, $potentialsFail failed" -ForegroundColor $(if ($potentialsFail -eq 0) { "Green" } else { "Yellow" })
} else {
    Write-Host "[3/4] Skipping Potentials (--SkipPotentials)" -ForegroundColor Gray
}

Write-Host ""

# Step 4: Cache Defensive Rankings (Play Type Rankings + Zone Rankings)
if (-not $SkipDefensiveRankings) {
    Write-Host "[4/4] Caching Defensive Rankings..." -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    
    try {
        $url = "$BaseUrl/api/cache/nba-league-data?season=$Season"
        Write-Host "  Calling: $url" -ForegroundColor Gray
        Write-Host "  This will fetch defensive rankings for all 11 play types..." -ForegroundColor Gray
        
        $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 600  # 10 min timeout
        
        if ($response.success -and $response.playTypeRankings) {
            $playTypesCached = $response.summary.playTypesCached
            Write-Host "  [OK] Cached defensive rankings for $playTypesCached play types" -ForegroundColor Green
            $defensiveRankingsSuccess = $true
        } else {
            Write-Host "  [WARN] Response missing expected data" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  [ERROR] Failed: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "[4/4] Skipping Defensive Rankings (--SkipDefensiveRankings)" -ForegroundColor Gray
}

# Summary
$endTime = Get-Date
$duration = $endTime - $startTime

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Duration: $($duration.ToString('mm\:ss'))" -ForegroundColor Gray
Write-Host ""

if (-not $SkipPlayTypes) {
    Write-Host "Play Types: $(if ($playTypeSuccess) { '[OK] Success' } else { '[ERROR] Failed' })" -ForegroundColor $(if ($playTypeSuccess) { "Green" } else { "Red" })
}

if (-not $SkipShotCharts) {
    Write-Host "Shot Charts: [INFO] Bulk endpoint not yet implemented" -ForegroundColor Yellow
}

if (-not $SkipPotentials) {
    Write-Host "Potentials: $potentialsSuccess success, $potentialsFail failed" -ForegroundColor $(if ($potentialsFail -eq 0) { "Green" } else { "Yellow" })
}

if (-not $SkipDefensiveRankings) {
    Write-Host "Defensive Rankings: $(if ($defensiveRankingsSuccess) { '[OK] Success' } else { '[ERROR] Failed' })" -ForegroundColor $(if ($defensiveRankingsSuccess) { "Green" } else { "Red" })
}

Write-Host "`n========================================" -ForegroundColor Cyan

