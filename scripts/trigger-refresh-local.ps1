# PowerShell script to manually trigger the player cache refresh API endpoint
# This can be used locally or in CI/CD (GitHub Actions)
#
# Usage (local):
#   .\scripts\trigger-refresh-local.ps1
#   .\scripts\trigger-refresh-local.ps1 -Url "http://localhost:3000/api/cron/refresh-all-player-caches"
#
# Usage (production/CI):
#   .\scripts\trigger-refresh-local.ps1 -Url "https://stattrackr.vercel.app/api/cron/refresh-all-player-caches" -AuthToken $env:CRON_SECRET
#
# Make sure your local dev server is running first:
#   npm run dev

param(
    [string]$Url = "http://localhost:3000/api/cron/refresh-all-player-caches",
    [string]$AuthToken = $null
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Manual Player Cache Refresh (Local)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Calling: $Url" -ForegroundColor Gray
Write-Host ""
Write-Host "⚠️  Make sure your dev server is running (npm run dev)" -ForegroundColor Yellow
Write-Host ""

try {
    $headers = @{}
    if ($AuthToken) {
        $headers["Authorization"] = "Bearer $AuthToken"
        Write-Host "Using authentication token" -ForegroundColor Gray
    } else {
        Write-Host "⚠️  No auth token provided (may fail in production)" -ForegroundColor Yellow
    }
    
    $response = Invoke-RestMethod -Uri $Url -Method Get -Headers $headers -ErrorAction Stop
    
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
    
    # Try to get response body if available
    if ($_.Exception.Response) {
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $responseBody = $reader.ReadToEnd()
            $reader.Close()
            $stream.Close()
            Write-Host "Response: $responseBody" -ForegroundColor Red
        } catch {
            Write-Host "Could not read response body: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    if ($Url -like "*localhost*") {
        Write-Host "💡 Make sure:" -ForegroundColor Yellow
        Write-Host "   1. Your dev server is running (npm run dev)" -ForegroundColor Gray
        Write-Host "   2. Your .env.local has BALLDONTLIE_API_KEY set (if needed)" -ForegroundColor Gray
        Write-Host "   3. Your .env.local has Supabase credentials set" -ForegroundColor Gray
    } else {
        Write-Host "💡 Make sure:" -ForegroundColor Yellow
        Write-Host "   1. CRON_SECRET is set correctly in GitHub Secrets" -ForegroundColor Gray
        Write-Host "   2. The API endpoint is accessible" -ForegroundColor Gray
    }
    exit 1
}

