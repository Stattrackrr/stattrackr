# PowerShell script to sync all player season averages
# Usage: .\scripts\sync-player-stats.ps1 [season]

param(
    [int]$Season = 2025,
    [string]$BaseUrl = "https://stattrackr.co"
)

Write-Host "`n📦 Player Season Averages Sync Tool" -ForegroundColor Cyan
Write-Host "   Season: $Season" -ForegroundColor Yellow
Write-Host "   URL: $BaseUrl`n" -ForegroundColor Yellow

$uri = "$BaseUrl/api/player-season-averages/sync"
$body = @{
    season = $Season
} | ConvertTo-Json

Write-Host "🔄 Starting sync..." -ForegroundColor Cyan
Write-Host "📡 Calling: $uri`n" -ForegroundColor Gray

try {
    $response = Invoke-WebRequest -Uri $uri -Method POST -Headers @{"Content-Type"="application/json"} -Body $body
    $result = $response.Content | ConvertFrom-Json
    
    if ($result.success) {
        Write-Host "✅ Sync completed successfully!`n" -ForegroundColor Green
        Write-Host "   Season: $($result.season)" -ForegroundColor White
        Write-Host "   Total Players: $($result.totalPlayers)" -ForegroundColor White
        Write-Host "   Synced: $($result.synced)" -ForegroundColor Green
        Write-Host "   Skipped: $($result.skipped)" -ForegroundColor Yellow
        Write-Host "   Errors: $($result.errors)" -ForegroundColor $(if ($result.errors -gt 0) { "Red" } else { "Green" })
        Write-Host "`n📊 All stats cached: PTS, REB, AST, FGM, FGA, FTM, FTA, OREB, DREB, TO, PF, STL, BLK, 3PM" -ForegroundColor Cyan
        
        if ($result.errors -gt 0) {
            Write-Host "`n⚠️  Some players had errors. This is normal if:" -ForegroundColor Yellow
            Write-Host "   - Players don't have stats for this season" -ForegroundColor Gray
            Write-Host "   - Rate limiting occurred (will retry automatically)" -ForegroundColor Gray
            Write-Host "   - API temporarily unavailable" -ForegroundColor Gray
        }
    } else {
        Write-Host "❌ Sync failed: $($result.error)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Error syncing season averages: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Message -like "*404*" -or $_.Exception.Message -like "*could not be resolved*") {
        Write-Host "`n💡 Make sure the app is running at $BaseUrl" -ForegroundColor Yellow
    }
    exit 1
}

