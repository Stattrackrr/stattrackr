# PowerShell script to bulk cache ALL player data needed for dashboard
# Caches: Shot Charts, Play Type Analysis, Defensive Rankings, Team Tracking Stats (Potentials)
# 
# Usage:
#   .\scripts\cache-all-player-data.ps1  # Fetches and caches ALL active players (~500+)
#   .\scripts\cache-all-player-data.ps1 -TopPlayers 50  # Cache only top 50 common players
#   .\scripts\cache-all-player-data.ps1 -PlayerIds @(203076, 201939, 2544)  # Cache specific players

param(
    [Parameter(Mandatory=$false)]
    [int[]]$PlayerIds = @(),
    
    [Parameter(Mandatory=$false)]
    [int]$TopPlayers = 0,
    
    [int]$Season = 2025,
    
    [int]$DelaySeconds = 2,  # Delay between requests
    
    [switch]$SkipShotCharts = $false,
    [switch]$SkipPlayTypes = $false,
    [switch]$SkipPotentials = $false
)

$baseUrl = "http://localhost:3000"

# Common/active player IDs
$commonPlayers = @(
    203076,  # Ivica Zubac
    201939,  # Stephen Curry
    2544,    # LeBron James
    201142,  # Kevin Durant
    201935,  # James Harden
    201566,  # Russell Westbrook
    201144,  # Chris Paul
    201152,  # Paul George
    203081,  # Giannis Antetokounmpo
    1629029, # Luka Doncic
    203999,  # Joel Embiid
    201942,  # Blake Griffin
    202331,  # Anthony Davis
    201980,  # Damian Lillard
    203507,  # Karl-Anthony Towns
    1628369, # Jayson Tatum
    1629028, # Trae Young
    203507,  # KAT
    201939,  # Curry
    203999   # Embiid
)

# NBA teams for potentials (tracking stats)
$nbaTeams = @('ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 
              'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK', 
              'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS')

# Determine which players to cache
$playersToCache = @()

if ($PlayerIds.Count -gt 0) {
    Write-Host "Using provided player IDs..." -ForegroundColor Yellow
    $playersToCache = $PlayerIds
} elseif ($TopPlayers -gt 0) {
    Write-Host "Using top $TopPlayers common players..." -ForegroundColor Yellow
    $playersToCache = $commonPlayers[0..([Math]::Min($TopPlayers - 1, $commonPlayers.Length - 1))]
} else {
    Write-Host "Fetching ALL active players from API..." -ForegroundColor Yellow
    try {
        # Fetch all active players from BDL API
        $playersUrl = "$baseUrl/api/bdl/players?all=true&max_hops=60&per_page=100"
        Write-Host "  Calling: $playersUrl" -ForegroundColor Gray
        $playersResponse = Invoke-RestMethod -Uri $playersUrl -Method GET -TimeoutSec 120
        
        if ($playersResponse.results -and $playersResponse.results.Count -gt 0) {
            # Extract player IDs (BDL IDs - will be converted to NBA Stats IDs by the API)
            $playersToCache = $playersResponse.results | ForEach-Object { $_.id } | Where-Object { $_ -ne $null }
            Write-Host "  [OK] Found $($playersToCache.Count) active players" -ForegroundColor Green
        } else {
            Write-Host "  [WARN] No players found, using default common players..." -ForegroundColor Yellow
            $playersToCache = $commonPlayers
        }
    } catch {
        Write-Host "  [ERROR] Failed to fetch players: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  Using default common players instead..." -ForegroundColor Yellow
        $playersToCache = $commonPlayers
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Bulk Player Data Cache" -ForegroundColor Yellow
Write-Host "Players to cache: $($playersToCache.Count)" -ForegroundColor $(if ($playersToCache.Count -gt 100) { "Green" } else { "Gray" })
Write-Host "Season: $Season" -ForegroundColor Gray
Write-Host "Delay between requests: ${DelaySeconds}s" -ForegroundColor Gray
if ($playersToCache.Count -gt 100) {
    $estimatedTime = [math]::Round(($playersToCache.Count * 3 * $DelaySeconds) / 60, 1)
    Write-Host "Estimated time: ~$estimatedTime minutes" -ForegroundColor Yellow
}
Write-Host "========================================`n" -ForegroundColor Cyan

$shotChartSuccess = 0
$playTypeSuccess = 0
$potentialsSuccess = 0
$shotChartFail = 0
$playTypeFail = 0
$potentialsFail = 0

# Step 1: Cache Shot Charts
if (-not $SkipShotCharts) {
    Write-Host "[1/3] Caching Shot Charts..." -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    
    foreach ($playerId in $playersToCache) {
        Write-Host "[$($playersToCache.IndexOf($playerId) + 1)/$($playersToCache.Count)] Player $playerId - Shot Chart..." -ForegroundColor Gray
        
        try {
            $url = "$baseUrl/api/shot-chart-enhanced?playerId=$playerId&season=$Season&bypassCache=true"
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
                }
            }
        } catch {
            Write-Host "  [ERROR] Failed: $($_.Exception.Message)" -ForegroundColor Red
            $shotChartFail++
        }
        
        if ($playersToCache.IndexOf($playerId) -lt $playersToCache.Count - 1) {
            Start-Sleep -Seconds $DelaySeconds
        }
    }
}

# Step 2: Cache Play Type Analysis
if (-not $SkipPlayTypes) {
    Write-Host "`n[2/3] Caching Play Type Analysis..." -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    
    foreach ($playerId in $playersToCache) {
        Write-Host "[$($playersToCache.IndexOf($playerId) + 1)/$($playersToCache.Count)] Player $playerId - Play Types..." -ForegroundColor Gray
        
        try {
            $url = "$baseUrl/api/play-type-analysis?playerId=$playerId&season=$Season&bypassCache=true"
            $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 120
            
            if ($response.playTypes -and $response.playTypes.Count -gt 0) {
                $validPlayTypes = ($response.playTypes | Where-Object { $_.points -gt 0 }).Count
                Write-Host "  [OK] Play Types: $validPlayTypes play types with data" -ForegroundColor Green
                $playTypeSuccess++
            } else {
                Write-Host "  [WARN] No play type data" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "  [ERROR] Failed: $($_.Exception.Message)" -ForegroundColor Red
            $playTypeFail++
        }
        
        if ($playersToCache.IndexOf($playerId) -lt $playersToCache.Count - 1) {
            Start-Sleep -Seconds $DelaySeconds
        }
    }
}

# Step 3: Cache Defensive Rankings (for shot chart opponent ranks & play type filter)
Write-Host "`n[3/4] Caching Defensive Rankings..." -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan

# 3a: Zone Defense Rankings (for shot chart opponent ranks)
Write-Host "[3a/4] Zone Defense Rankings (for shot chart opponent ranks)..." -ForegroundColor Gray
try {
    $url = "$baseUrl/api/team-defense-rankings?season=$Season"
    $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 600  # 10 min timeout
    
    Write-Host "  [OK] Zone defense rankings cached" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Zone defense rankings failed: $($_.Exception.Message)" -ForegroundColor Red
}

Start-Sleep -Seconds $DelaySeconds

# 3b: Play Type Defensive Rankings (for play type filter)
Write-Host "[3b/4] Play Type Defensive Rankings (for play type filter)..." -ForegroundColor Gray
try {
    $url = "$baseUrl/api/cache/nba-league-data?season=$Season"
    $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 600  # 10 min timeout
    
    Write-Host "  [OK] Play type defensive rankings cached" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Play type defensive rankings failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Step 4: Cache Team Tracking Stats (Potentials)
# This requires getting player's team first, then caching tracking stats
if (-not $SkipPotentials) {
    Write-Host "`n[4/4] Caching Team Tracking Stats (Potentials)..." -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Note: This caches all teams for 'passing' and 'rebounding' categories" -ForegroundColor Gray
    Write-Host "      Potentials will work for any player once their team is cached" -ForegroundColor Gray
    Write-Host ""
    
    $categories = @('passing', 'rebounding')
    
    foreach ($team in $nbaTeams) {
        foreach ($category in $categories) {
            Write-Host "[$($nbaTeams.IndexOf($team) * 2 + $categories.IndexOf($category) + 1)/$($nbaTeams.Count * 2)] $team - $category..." -ForegroundColor Gray
            
            try {
                $url = "$baseUrl/api/tracking-stats/team?team=$team&category=$category&season=$Season&bypassCache=true"
                $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 120
                
                if ($response.players -and $response.players.Count -gt 0) {
                    Write-Host "  [OK] $team $category: $($response.players.Count) players" -ForegroundColor Green
                    $potentialsSuccess++
                } else {
                    Write-Host "  [WARN] No players" -ForegroundColor Yellow
                }
            } catch {
                Write-Host "  [ERROR] Failed: $($_.Exception.Message)" -ForegroundColor Red
                $potentialsFail++
            }
            
            Start-Sleep -Seconds $DelaySeconds
        }
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Bulk Cache Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

if (-not $SkipShotCharts) {
    Write-Host "Shot Charts: [OK] $shotChartSuccess success, [ERROR] $shotChartFail failed" -ForegroundColor $(if ($shotChartFail -eq 0) { "Green" } else { "Yellow" })
}
if (-not $SkipPlayTypes) {
    Write-Host "Play Types: [OK] $playTypeSuccess success, [ERROR] $playTypeFail failed" -ForegroundColor $(if ($playTypeFail -eq 0) { "Green" } else { "Yellow" })
}
if (-not $SkipPotentials) {
    Write-Host "Potentials: [OK] $potentialsSuccess success, [ERROR] $potentialsFail failed" -ForegroundColor $(if ($potentialsFail -eq 0) { "Green" } else { "Yellow" })
}

Write-Host "`nProduction can now read all cached data!" -ForegroundColor Green
Write-Host "`nAll data cached to Supabase!" -ForegroundColor Green
Write-Host "  - Shot Charts (with opponent ranks)" -ForegroundColor Gray
Write-Host "  - Play Type Analysis (with defensive rankings)" -ForegroundColor Gray
Write-Host "  - Zone Defense Rankings" -ForegroundColor Gray
Write-Host "  - Play Type Defensive Rankings" -ForegroundColor Gray
Write-Host "  - Team Tracking Stats (Potentials)" -ForegroundColor Gray

