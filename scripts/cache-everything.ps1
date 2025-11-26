# PowerShell script to cache EVERYTHING: All players, teams, opponents, and play types
# Caches: 
#   - Shot Charts (all players)
#   - Play Type Analysis (all players)
#   - Team Tracking Stats / Potentials (all teams, passing + rebounding)
#   - Defensive Rankings (play type + zone rankings)
# 
# Usage:
#   .\scripts\cache-everything.ps1  # Cache everything (production URL)
#   .\scripts\cache-everything.ps1 -BaseUrl "http://localhost:3000"  # Local dev
#   .\scripts\cache-everything.ps1 -SkipShotCharts  # Skip shot charts
#   .\scripts\cache-everything.ps1 -SkipPlayTypes  # Skip play types
#   .\scripts\cache-everything.ps1 -SkipPotentials  # Skip Potentials (team tracking stats)

param(
    [string]$BaseUrl = "https://stattrackr.vercel.app",  # Default to production
    
    [int]$Season = 2025,
    
    [int]$DelaySeconds = 1,  # Delay between requests (1 second default)
    
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
Write-Host "COMPREHENSIVE CACHE WARM-UP" -ForegroundColor Yellow
Write-Host "Base URL: $BaseUrl" -ForegroundColor Gray
Write-Host "Season: $Season" -ForegroundColor Gray
Write-Host "Delay: ${DelaySeconds}s" -ForegroundColor Gray
Write-Host "========================================`n" -ForegroundColor Cyan

$startTime = Get-Date
$shotChartSuccess = 0
$shotChartFail = 0
$playTypeSuccess = 0
$playTypeFail = 0
$potentialsSuccess = 0
$potentialsFail = 0
$defensiveRankingsSuccess = 0
$defensiveRankingsFail = 0

# Step 1: Get ALL active players
Write-Host "[1/5] Fetching all active players..." -ForegroundColor Yellow
$playersToCache = @()
try {
    $playersUrl = "$BaseUrl/api/bdl/players?all=true&max_hops=60&per_page=100"
    Write-Host "  Calling: $playersUrl" -ForegroundColor Gray
    $playersResponse = Invoke-RestMethod -Uri $playersUrl -Method GET -TimeoutSec 120
    
    if ($playersResponse.results -and $playersResponse.results.Count -gt 0) {
        $playersToCache = $playersResponse.results | ForEach-Object { $_.id } | Where-Object { $_ -ne $null }
        Write-Host "  [OK] Found $($playersToCache.Count) active players" -ForegroundColor Green
    } else {
        Write-Host "  [ERROR] No players found in API response" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  [ERROR] Failed to fetch players: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 2: Cache Shot Charts for all players
if (-not $SkipShotCharts) {
    Write-Host "`n[2/5] Caching Shot Charts for all players..." -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    
    $playerIndex = 0
    foreach ($playerId in $playersToCache) {
        $playerIndex++
        Write-Host "[$playerIndex/$($playersToCache.Count)] Player $playerId - Shot Chart..." -ForegroundColor Gray
        
        try {
            $url = "$BaseUrl/api/shot-chart-enhanced?playerId=$playerId&season=$Season&bypassCache=true"
            $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 120
            
            if ($response.shotZones) {
                $totalShots = $response.shotZones.restrictedArea.fga + 
                             $response.shotZones.paint.fga + 
                             $response.shotZones.midRange.fga + 
                             $response.shotZones.leftCorner3.fga + 
                             $response.shotZones.rightCorner3.fga + 
                             $response.shotZones.aboveBreak3.fga
                
                if ($totalShots -gt 0) {
                    Write-Host "  [OK] Shot Chart: $totalShots shots" -ForegroundColor Green
                    $shotChartSuccess++
                } else {
                    Write-Host "  [WARN] No shot data" -ForegroundColor Yellow
                    $shotChartFail++
                }
            } else {
                Write-Host "  [WARN] Invalid response structure" -ForegroundColor Yellow
                $shotChartFail++
            }
        } catch {
            Write-Host "  [ERROR] Failed: $($_.Exception.Message)" -ForegroundColor Red
            $shotChartFail++
        }
        
        if ($playerIndex -lt $playersToCache.Count) {
            Start-Sleep -Seconds $DelaySeconds
        }
    }
} else {
    Write-Host "`n[2/5] Skipping Shot Charts (--SkipShotCharts)" -ForegroundColor Gray
}

# Step 3: Cache Play Type Analysis for all players
if (-not $SkipPlayTypes) {
    Write-Host "`n[3/5] Caching Play Type Analysis for all players..." -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    
    $playerIndex = 0
    foreach ($playerId in $playersToCache) {
        $playerIndex++
        Write-Host "[$playerIndex/$($playersToCache.Count)] Player $playerId - Play Types..." -ForegroundColor Gray
        
        try {
            # Don't use bypassCache=true for play types - it forces 11 sequential API calls
            # which can exceed Vercel's 60s timeout. Let it use cache when available.
            $url = "$BaseUrl/api/play-type-analysis?playerId=$playerId&season=$Season"
            # Increase timeout to 90s to handle slow NBA API responses
            $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 90
            
            if ($response.playTypes -and $response.playTypes.Count -gt 0) {
                $validPlayTypes = ($response.playTypes | Where-Object { $_.points -gt 0 }).Count
                Write-Host "  [OK] Play Types: $validPlayTypes play types with data" -ForegroundColor Green
                $playTypeSuccess++
            } else {
                Write-Host "  [WARN] No play type data" -ForegroundColor Yellow
                $playTypeFail++
            }
        } catch {
            Write-Host "  [ERROR] Failed: $($_.Exception.Message)" -ForegroundColor Red
            $playTypeFail++
        }
        
        if ($playerIndex -lt $playersToCache.Count) {
            Start-Sleep -Seconds $DelaySeconds
        }
    }
} else {
    Write-Host "`n[3/5] Skipping Play Types (--SkipPlayTypes)" -ForegroundColor Gray
}

# Step 4: Cache Team Tracking Stats (Potentials) for all teams
if (-not $SkipPotentials) {
    Write-Host "`n[4/5] Caching Team Tracking Stats (Potentials) for all teams..." -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Note: Caching both 'passing' and 'rebounding' categories" -ForegroundColor Gray
    Write-Host ""
    
    $categories = @('passing', 'rebounding')
    $totalItems = $nbaTeams.Count * $categories.Count
    $currentItem = 0
    
    foreach ($team in $nbaTeams) {
        foreach ($category in $categories) {
            $currentItem++
            Write-Host "[$currentItem/$totalItems] $team - $category..." -ForegroundColor Gray
            
            try {
                $url = "$BaseUrl/api/tracking-stats/team?team=$team&category=$category&season=$Season&bypassCache=true"
                $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 120
                
                if ($response.players -and $response.players.Count -gt 0) {
                    Write-Host "  [OK] Potentials: $($response.players.Count) players" -ForegroundColor Green
                    $potentialsSuccess++
                } else {
                    Write-Host "  [WARN] No players found" -ForegroundColor Yellow
                    $potentialsFail++
                }
            } catch {
                Write-Host "  [ERROR] Failed: $($_.Exception.Message)" -ForegroundColor Red
                $potentialsFail++
            }
            
            if ($currentItem -lt $totalItems) {
                Start-Sleep -Seconds $DelaySeconds
            }
        }
    }
} else {
    Write-Host "`n[4/5] Skipping Potentials (--SkipPotentials)" -ForegroundColor Gray
}

# Step 5: Cache Defensive Rankings (Play Type Rankings + Zone Rankings)
if (-not $SkipDefensiveRankings) {
    Write-Host "`n[5/5] Caching Defensive Rankings..." -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    
    # 5a: Play Type Defensive Rankings
    Write-Host "[5a/5] Play Type Defensive Rankings..." -ForegroundColor Gray
    try {
        $url = "$BaseUrl/api/cache/nba-league-data?season=$Season&bypassCache=true"
        $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 600  # 10 min timeout
        
        if ($response.summary) {
            Write-Host "  [OK] Play type defensive rankings cached" -ForegroundColor Green
            $defensiveRankingsSuccess++
        } else {
            Write-Host "  [WARN] No summary in response" -ForegroundColor Yellow
            $defensiveRankingsFail++
        }
    } catch {
        Write-Host "  [ERROR] Failed: $($_.Exception.Message)" -ForegroundColor Red
        $defensiveRankingsFail++
    }
    
    Start-Sleep -Seconds $DelaySeconds
    
    # 5b: Zone Defense Rankings
    Write-Host "[5b/5] Zone Defense Rankings..." -ForegroundColor Gray
    try {
        $url = "$BaseUrl/api/team-defense-rankings?season=$Season&bypassCache=true"
        $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 600  # 10 min timeout
        
        if ($response.rankings -or $response.zones) {
            Write-Host "  [OK] Zone defense rankings cached" -ForegroundColor Green
            $defensiveRankingsSuccess++
        } else {
            Write-Host "  [WARN] No rankings in response" -ForegroundColor Yellow
            $defensiveRankingsFail++
        }
    } catch {
        Write-Host "  [ERROR] Failed: $($_.Exception.Message)" -ForegroundColor Red
        $defensiveRankingsFail++
    }
} else {
    Write-Host "`n[5/5] Skipping Defensive Rankings (--SkipDefensiveRankings)" -ForegroundColor Gray
}

# Summary
$endTime = Get-Date
$duration = $endTime - $startTime
$durationMinutes = [math]::Round($duration.TotalMinutes, 1)

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "CACHE WARM-UP COMPLETE" -ForegroundColor Yellow
Write-Host "Duration: $durationMinutes minutes" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan

if (-not $SkipShotCharts) {
    Write-Host "Shot Charts: $shotChartSuccess success, $shotChartFail failed" -ForegroundColor $(if ($shotChartFail -eq 0) { "Green" } else { "Yellow" })
}
if (-not $SkipPlayTypes) {
    Write-Host "Play Types: $playTypeSuccess success, $playTypeFail failed" -ForegroundColor $(if ($playTypeFail -eq 0) { "Green" } else { "Yellow" })
}
if (-not $SkipPotentials) {
    Write-Host "Potentials: $potentialsSuccess success, $potentialsFail failed" -ForegroundColor $(if ($potentialsFail -eq 0) { "Green" } else { "Yellow" })
}
if (-not $SkipDefensiveRankings) {
    Write-Host "Defensive Rankings: $defensiveRankingsSuccess success, $defensiveRankingsFail failed" -ForegroundColor $(if ($defensiveRankingsFail -eq 0) { "Green" } else { "Yellow" })
}

Write-Host "========================================`n" -ForegroundColor Cyan

