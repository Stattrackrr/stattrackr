# PowerShell script to fetch actual positions using our API endpoint
# This uses the server-side API which can call NBA Stats API more reliably
# 
# Usage:
#   .\scripts\fetch-positions-via-api.ps1 -Team MIL  # Single team
#   .\scripts\fetch-positions-via-api.ps1 -All  # All teams
#   .\scripts\fetch-positions-via-api.ps1 -Team MIL -Apply  # Apply fixes

param(
    [string]$Team = "",
    [switch]$All = $false,
    [int]$Season = 2025,  # Default to 2025-26 season
    [switch]$Apply = $false,
    [string]$BaseUrl = "http://localhost:3000"
)

$nbaTeams = @('ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 
              'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK', 
              'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS')

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Fetch Positions via API Endpoint" -ForegroundColor Yellow
Write-Host "Base URL: $BaseUrl" -ForegroundColor Gray
Write-Host "Season: $Season ($($Season)-$([String]::Format('{0:D2}', ($Season + 1) % 100)))" -ForegroundColor Gray
if ($Apply) {
    Write-Host "Mode: APPLY (will update position files)" -ForegroundColor Green
} else {
    Write-Host "Mode: DRY RUN (no changes will be made)" -ForegroundColor Yellow
}
Write-Host "========================================`n" -ForegroundColor Cyan

$teamsToProcess = if ($All) { $nbaTeams } elseif ($Team) { @($Team.ToUpper()) } else { 
    Write-Host "Error: Must provide -Team or -All" -ForegroundColor Red
    exit 1
}

$allResults = @()

foreach ($teamAbbr in $teamsToProcess) {
    Write-Host "[$($teamsToProcess.IndexOf($teamAbbr) + 1)/$($teamsToProcess.Count)] Fetching positions for $teamAbbr..." -ForegroundColor Gray
    
    try {
        # Use BasketballMonster (has historical games, server-rendered, cached in Supabase)
        $url = "$BaseUrl/api/dvp/fetch-basketballmonsters-lineups?team=$teamAbbr&season=$Season"
        $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 60
        
        if ($response.error) {
            Write-Host "  [ERROR] $($response.error)" -ForegroundColor Red
            continue
        }
        
        if ($response.players -and $response.players.Count -gt 0) {
            Write-Host "  [OK] Found $($response.players.Count) players from $($response.gamesProcessed) games" -ForegroundColor Green
            if ($response.debug) {
                Write-Host "  [DEBUG] $($response.debug.messages -join '; ')" -ForegroundColor Gray
                if ($response.debug.detailedLogs -and $response.debug.detailedLogs.Count -gt 0) {
                    Write-Host "  [DETAILED LOGS] (showing first 15):" -ForegroundColor DarkGray
                    $response.debug.detailedLogs | Select-Object -First 15 | ForEach-Object {
                        Write-Host "    $_" -ForegroundColor DarkGray
                    }
                }
            }
            $allResults += $response
        } else {
            Write-Host "  [WARN] No players found" -ForegroundColor Yellow
            if ($response.debug) {
                Write-Host "  [DEBUG] $($response.debug.messages -join '; ')" -ForegroundColor Gray
                if ($response.debug.detailedLogs -and $response.debug.detailedLogs.Count -gt 0) {
                    Write-Host "  [DETAILED LOGS] (showing first 15):" -ForegroundColor DarkGray
                    $response.debug.detailedLogs | Select-Object -First 15 | ForEach-Object {
                        Write-Host "    $_" -ForegroundColor DarkGray
                    }
                }
            }
        }
    } catch {
        Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # Small delay between teams
    if ($teamAbbr -ne $teamsToProcess[-1]) {
        Start-Sleep -Seconds 1
    }
}

# Display results
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "RESULTS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan

foreach ($result in $allResults) {
        if ($result.error) {
            Write-Host "`nERROR $($result.team): $($result.error)" -ForegroundColor Red
            if ($result.debug -and $result.debug.detailedLogs) {
                Write-Host "  [DETAILED LOGS] (showing first 20):" -ForegroundColor DarkGray
                $result.debug.detailedLogs | Select-Object -First 20 | ForEach-Object {
                    Write-Host "    $_" -ForegroundColor DarkGray
                }
            }
            continue
        }
    
    Write-Host "`n$($result.team) ($($result.gamesProcessed)/$($result.totalGames) games processed, $($result.players.Count) players)" -ForegroundColor Cyan
    
    # Load current positions for comparison
    $teamFile = Join-Path $PSScriptRoot "..\data\player_positions\teams\$($result.team).json"
    $masterFile = Join-Path $PSScriptRoot "..\data\player_positions\master.json"
    
    $currentPositions = @{}
    if (Test-Path $teamFile) {
        $teamData = Get-Content $teamFile | ConvertFrom-Json
        if ($teamData.positions) {
            # Convert PSCustomObject to hashtable
            foreach ($key in $teamData.positions.PSObject.Properties.Name) {
                $currentPositions[$key] = $teamData.positions.$key
            }
        }
    }
    if (Test-Path $masterFile) {
        $masterData = Get-Content $masterFile | ConvertFrom-Json
        if ($masterData.positions) {
            foreach ($key in $masterData.positions.PSObject.Properties.Name) {
                if (-not $currentPositions.ContainsKey($key)) {
                    $currentPositions[$key] = $masterData.positions.$key
                }
            }
        }
    }
    
    foreach ($player in $result.players) {
        $normalized = $player.name.ToLower().Trim()
        if ($currentPositions.ContainsKey($normalized)) {
            $currentPos = $currentPositions[$normalized]
        } else {
            $currentPos = 'NOT SET'
        }
        $needsUpdate = $currentPos -ne $player.recommendedPosition
        $status = if ($needsUpdate) { 'UPDATE' } else { 'OK' }
        
        $breakdown = ($player.positionBreakdown.PSObject.Properties | ForEach-Object { "$($_.Name):$($_.Value)" }) -join ', '
        $confidencePct = [math]::Round($player.confidence * 100)
        $confidenceStr = "$confidencePct" + "%"
        Write-Host "$status $($player.name.PadRight(30)) | Current: $($currentPos.ToString().PadRight(8)) | Recommended: $($player.recommendedPosition) | $($player.totalGames)G ($($player.starterGames)S) | $confidenceStr | $breakdown" -ForegroundColor $(if ($needsUpdate) { "Yellow" } else { "Gray" })
    }
}

# Apply updates if requested
if ($Apply) {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "APPLYING POSITION UPDATES" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    
    $totalUpdated = 0
    
    foreach ($result in $allResults) {
        if ($result.error -or -not $result.players) {
            continue
        }
        
        $teamFile = Join-Path $PSScriptRoot "..\data\player_positions\teams\$($result.team).json"
        $teamDir = Split-Path $teamFile -Parent
        
        if (-not (Test-Path $teamDir)) {
            New-Item -ItemType Directory -Path $teamDir -Force | Out-Null
        }
        
        $existing = if (Test-Path $teamFile) {
            Get-Content $teamFile | ConvertFrom-Json
        } else {
            @{ positions = @{}; aliases = @{} }
        }
        
        $updated = 0
        foreach ($player in $result.players) {
            $normalized = $player.name.ToLower().Trim()
            if ($existing.positions.$normalized -ne $player.recommendedPosition) {
                $existing.positions.$normalized = $player.recommendedPosition
                $updated++
            }
        }
        
        if ($updated -gt 0) {
            $existing | ConvertTo-Json -Depth 10 | Set-Content $teamFile
            Write-Host "OK $($result.team): Updated $updated position(s)" -ForegroundColor Green
            $totalUpdated += $updated
        } else {
            Write-Host "OK $($result.team): No updates needed" -ForegroundColor Gray
        }
    }
    
    Write-Host "`nTotal: $totalUpdated position(s) updated" -ForegroundColor Green
    Write-Host "`nNext step: Run DvP re-ingest to apply new positions:" -ForegroundColor Yellow
    Write-Host "   .\scripts\reingest-dvp-all.ps1" -ForegroundColor Cyan
} else {
    Write-Host "`nTo apply these updates, run with -Apply flag:" -ForegroundColor Yellow
    Write-Host "   .\scripts\fetch-positions-via-api.ps1 -Team $Team -Apply" -ForegroundColor Cyan
    if ($All) {
        Write-Host "   .\scripts\fetch-positions-via-api.ps1 -All -Apply" -ForegroundColor Cyan
    }
}

Write-Host "`n========================================`n" -ForegroundColor Cyan

