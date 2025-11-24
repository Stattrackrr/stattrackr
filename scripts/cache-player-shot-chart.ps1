# PowerShell script to cache a specific player's shot chart
# Usage: .\scripts\cache-player-shot-chart.ps1 -PlayerId 203076

param(
    [Parameter(Mandatory=$true)]
    [string]$PlayerId,
    
    [int]$Season = 2025
)

$baseUrl = "http://localhost:3000"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Caching Player Shot Chart" -ForegroundColor Yellow
Write-Host "Player ID: $PlayerId" -ForegroundColor Gray
Write-Host "Season: $Season" -ForegroundColor Gray
Write-Host "========================================`n" -ForegroundColor Cyan

try {
    $url = "$baseUrl/api/shot-chart-enhanced?playerId=$PlayerId&season=$Season&bypassCache=true"
    Write-Host "Fetching shot chart data..." -ForegroundColor Yellow
    
    $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 120  # 2 min timeout
    
    if ($response.shotZones) {
        $totalShots = $response.shotZones.restrictedArea.fga + 
                     $response.shotZones.paint.fga + 
                     $response.shotZones.midRange.fga + 
                     $response.shotZones.leftCorner3.fga + 
                     $response.shotZones.rightCorner3.fga + 
                     $response.shotZones.aboveBreak3.fga
        
        if ($totalShots -gt 0) {
            Write-Host "  ✅ Success: Shot chart cached ($totalShots total shots)" -ForegroundColor Green
            Write-Host "     Restricted Area: $($response.shotZones.restrictedArea.fga) FGA" -ForegroundColor Gray
            Write-Host "     Paint: $($response.shotZones.paint.fga) FGA" -ForegroundColor Gray
            Write-Host "     Mid-Range: $($response.shotZones.midRange.fga) FGA" -ForegroundColor Gray
            Write-Host "     Left Corner 3: $($response.shotZones.leftCorner3.fga) FGA" -ForegroundColor Gray
            Write-Host "     Right Corner 3: $($response.shotZones.rightCorner3.fga) FGA" -ForegroundColor Gray
            Write-Host "     Above Break 3: $($response.shotZones.aboveBreak3.fga) FGA" -ForegroundColor Gray
        } else {
            Write-Host "  ⚠️ Warning: No shot data found for this player" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ❌ Error: Invalid response format" -ForegroundColor Red
    }
} catch {
    Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Done!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

