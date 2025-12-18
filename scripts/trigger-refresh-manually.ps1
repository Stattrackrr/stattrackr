# PowerShell script to manually trigger the player cache refresh API endpoint
# This calls the same endpoint that runs automatically at 12am
#
# Usage:
#   .\scripts\trigger-refresh-manually.ps1

$protocol = "https"
$apiHost = "stattrackr.vercel.app"  # Change to your production domain

# Or use localhost for local testing
# $protocol = "http"
# $apiHost = "localhost:3000"

$url = "${protocol}://${apiHost}/api/cron/refresh-all-player-caches"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Manual Player Cache Refresh Trigger" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Calling: $url" -ForegroundColor Gray
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $url -Method Get -Headers @{
        "Authorization" = "Bearer $env:CRON_SECRET"
    } -ErrorAction Stop
    
    Write-Host "✅ Success!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Results:" -ForegroundColor Yellow
    Write-Host "  Total Players: $($response.results.totalPlayers)" -ForegroundColor White
    Write-Host "  Shot Charts: $($response.results.shotCharts.success) success, $($response.results.shotCharts.failed) failed" -ForegroundColor White
    Write-Host "  Play Types: $($response.results.playTypes.success) success, $($response.results.playTypes.failed) failed" -ForegroundColor White
    Write-Host "  Duration: $($response.duration)" -ForegroundColor White
    Write-Host ""
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody" -ForegroundColor Red
    }
    exit 1
}

