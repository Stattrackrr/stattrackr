# Re-ingest DVP data for all teams with new metrics (fg3a, fga, fgm)
# This will refresh all stored DVP data with the new fields

$teams = @(
    "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
    "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
    "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
)

$baseUrl = "http://localhost:3000"
$season = "2025"
$games = "82"

Write-Host "Starting DVP re-ingest for all 30 teams..." -ForegroundColor Green
Write-Host "This will refresh stored data with fg3a, fga, fgm metrics" -ForegroundColor Yellow
Write-Host ""

$successCount = 0
$failCount = 0

foreach ($team in $teams) {
    Write-Host "Ingesting $team... " -NoNewline
    
    try {
        $url = "$baseUrl/api/dvp/ingest?team=$team&season=$season&games=$games&refresh=1"
        $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 300
        
        if ($response.success) {
            Write-Host "[OK] Success ($($response.stored_games) games)" -ForegroundColor Green
            $successCount++
        } else {
            Write-Host "[FAIL] Failed: $($response.error)" -ForegroundColor Red
            $failCount++
        }
    } catch {
        Write-Host "[ERROR] Error: $($_.Exception.Message)" -ForegroundColor Red
        $failCount++
    }
    
    # Small delay to avoid overwhelming the API
    Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "Re-ingest complete!" -ForegroundColor Green
Write-Host "Success: $successCount teams" -ForegroundColor Green
Write-Host "Failed: $failCount teams" -ForegroundColor Red
Write-Host "===============================================" -ForegroundColor Cyan
