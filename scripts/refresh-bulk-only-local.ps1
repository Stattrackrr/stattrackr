# PowerShell script to refresh ONLY bulk NBA stats locally (skip team tracking)
# This is faster and more reliable - team tracking stats can be done separately
# 
# Refreshes:
# 1. Bulk player play types + defensive rankings
# 2. Team defense rankings (zone rankings)

$baseUrl = "http://localhost:3000"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "NBA Bulk Stats Refresh (Bulk Only)" -ForegroundColor Yellow
Write-Host "Skipping team tracking stats (too unreliable)" -ForegroundColor Gray
Write-Host "========================================`n" -ForegroundColor Cyan

# Step 1: Refresh bulk player play types + defensive rankings
Write-Host "[1/2] Refreshing bulk player play types + defensive rankings..." -ForegroundColor Yellow

try {
    $url = "$baseUrl/api/cache/nba-league-data?season=2025"
    $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 600  # 10 min timeout
    
    Write-Host "  ✅ Success: Bulk player play types + defensive rankings refreshed" -ForegroundColor Green
    if ($response.summary) {
        Write-Host "     $($response.summary)" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ❌ Error: Bulk player play types refresh failed - $($_.Exception.Message)" -ForegroundColor Red
}

# Step 2: Refresh team defense rankings (zone rankings)
Write-Host "`n[2/2] Refreshing team defense rankings (zone rankings)..." -ForegroundColor Yellow

try {
    $url = "$baseUrl/api/team-defense-rankings?season=2025"
    $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 600  # 10 min timeout
    
    Write-Host "  ✅ Success: Team defense rankings refreshed" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Error: Team defense rankings refresh failed - $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Bulk Refresh Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nBulk data has been cached to Supabase." -ForegroundColor Green
Write-Host "Production will now have access to:" -ForegroundColor Green
Write-Host "  ✅ Bulk player play types (all players)" -ForegroundColor Green
Write-Host "  ✅ Defensive rankings (all play types)" -ForegroundColor Green
Write-Host "  ✅ Zone defense rankings (if successful)" -ForegroundColor Green
Write-Host "`nNote: Team tracking stats (potentials) can be refreshed separately" -ForegroundColor Gray
Write-Host "      when the NBA API is more stable." -ForegroundColor Gray

