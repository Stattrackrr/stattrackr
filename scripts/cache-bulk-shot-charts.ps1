# PowerShell script to bulk cache shot charts for multiple players
# Usage: 
#   .\scripts\cache-bulk-shot-charts.ps1 -PlayerIds @(203076, 201939, 2544)
#   .\scripts\cache-bulk-shot-charts.ps1 -PlayerIds (Get-Content players.txt)
#   .\scripts\cache-bulk-shot-charts.ps1 -TopPlayers 50  # Cache top 50 players by usage

param(
    [Parameter(Mandatory=$false)]
    [int[]]$PlayerIds = @(),
    
    [Parameter(Mandatory=$false)]
    [int]$TopPlayers = 0,
    
    [int]$Season = 2025,
    
    [int]$DelaySeconds = 2  # Delay between requests to avoid overwhelming
)

$baseUrl = "http://localhost:3000"

# Common/active player IDs (you can expand this list)
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
    203076,  # Ivica Zubac
    203999,  # Joel Embiid
    201939   # Stephen Curry
)

# Determine which players to cache
$playersToCache = @()

if ($TopPlayers -gt 0) {
    Write-Host "Using top $TopPlayers common players..." -ForegroundColor Yellow
    $playersToCache = $commonPlayers[0..([Math]::Min($TopPlayers - 1, $commonPlayers.Length - 1))]
} elseif ($PlayerIds.Count -gt 0) {
    Write-Host "Using provided player IDs..." -ForegroundColor Yellow
    $playersToCache = $PlayerIds
} else {
    Write-Host "No players specified. Using default common players..." -ForegroundColor Yellow
    $playersToCache = $commonPlayers
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Bulk Shot Chart Cache" -ForegroundColor Yellow
Write-Host "Players to cache: $($playersToCache.Count)" -ForegroundColor Gray
Write-Host "Season: $Season" -ForegroundColor Gray
Write-Host "Delay between requests: ${DelaySeconds}s" -ForegroundColor Gray
Write-Host "========================================`n" -ForegroundColor Cyan

$successCount = 0
$failCount = 0
$skippedCount = 0

foreach ($playerId in $playersToCache) {
    Write-Host "[$($playersToCache.IndexOf($playerId) + 1)/$($playersToCache.Count)] Caching player $playerId..." -ForegroundColor Yellow
    
    try {
        $url = "$baseUrl/api/shot-chart-enhanced?playerId=$playerId&season=$Season&bypassCache=true"
        $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 120  # 2 min timeout
        
        if ($response.shotZones) {
            $totalShots = $response.shotZones.restrictedArea.fga + 
                         $response.shotZones.paint.fga + 
                         $response.shotZones.midRange.fga + 
                         $response.shotZones.leftCorner3.fga + 
                         $response.shotZones.rightCorner3.fga + 
                         $response.shotZones.aboveBreak3.fga
            
            if ($totalShots -gt 0) {
                Write-Host "  ✅ Cached: $totalShots total shots" -ForegroundColor Green
                $successCount++
            } else {
                Write-Host "  ⚠️ Skipped: No shot data (rookie or no games)" -ForegroundColor Yellow
                $skippedCount++
            }
        } else {
            Write-Host "  ⚠️ Skipped: Invalid response" -ForegroundColor Yellow
            $skippedCount++
        }
    } catch {
        Write-Host "  ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
        $failCount++
    }
    
    # Delay between requests (except for last one)
    if ($playersToCache.IndexOf($playerId) -lt $playersToCache.Count - 1) {
        Start-Sleep -Seconds $DelaySeconds
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Bulk Cache Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ Success: $successCount" -ForegroundColor Green
Write-Host "⚠️ Skipped: $skippedCount" -ForegroundColor Yellow
Write-Host "❌ Failed: $failCount" -ForegroundColor Red
Write-Host "`nTotal players processed: $($playersToCache.Count)" -ForegroundColor Gray
Write-Host "`nProduction can now read these from cache!" -ForegroundColor Green

