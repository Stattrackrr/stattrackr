# PowerShell script to manually trigger the player cache refresh API endpoint locally
# This calls localhost:3000
#
# Usage:
#   .\scripts\trigger-refresh-local.ps1
#
# Make sure your local dev server is running first:
#   npm run dev

$url = "http://localhost:3000/api/cron/refresh-all-player-caches"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Manual Player Cache Refresh (Local)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Calling: $url" -ForegroundColor Gray
Write-Host ""
Write-Host "⚠️  Make sure your dev server is running (npm run dev)" -ForegroundColor Yellow
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $url -Method Get -ErrorAction Stop
    
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
    Write-Host ""
    Write-Host "💡 Make sure:" -ForegroundColor Yellow
    Write-Host "   1. Your dev server is running (npm run dev)" -ForegroundColor Gray
    Write-Host "   2. Your .env.local has BALLDONTLIE_API_KEY set (if needed)" -ForegroundColor Gray
    Write-Host "   3. Your .env.local has Supabase credentials set" -ForegroundColor Gray
    exit 1
}

