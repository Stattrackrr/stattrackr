# PowerShell script to refresh ALL bulk NBA stats locally
# This populates Supabase cache which production can then use
# 
# Refreshes:
# 1. Team tracking stats (potentials) - all 30 teams × 2 categories
# 2. Bulk player play types + defensive rankings
# 3. Team defense rankings (zone rankings)

$baseUrl = "http://localhost:3000"
$teams = @(
    "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
    "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
    "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
)
$categories = @("passing", "rebounding")

$total = $teams.Count * $categories.Count + 2  # +2 for bulk endpoints
$current = 0
$success = 0
$errors = 0

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "NBA Bulk Stats Refresh (Local)" -ForegroundColor Yellow
Write-Host "Total: $total refreshes" -ForegroundColor Yellow
Write-Host "  - Team tracking: $($teams.Count) teams × $($categories.Count) categories" -ForegroundColor Gray
Write-Host "  - Bulk player play types + defensive rankings" -ForegroundColor Gray
Write-Host "  - Team defense rankings (zone rankings)" -ForegroundColor Gray
Write-Host "========================================`n" -ForegroundColor Cyan

# Step 1: Refresh team tracking stats (potentials)
Write-Host "Step 1/3: Refreshing team tracking stats (potentials)..." -ForegroundColor Yellow
foreach ($team in $teams) {
    foreach ($cat in $categories) {
        $current++
        $percent = [math]::Round(($current / $total) * 100, 1)
        
        Write-Host "[$current/$total] ($percent%) Refreshing $team $cat..." -ForegroundColor Gray
        
        $url = "$baseUrl/api/cron/refresh-nba-stats?teams=$team&trackingBatch=1&trackingCategories=$cat&trackingTimeout=90000&trackingRetries=1"
        
        try {
            $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 120
            
            if ($response.results.errors -eq 0) {
                $success++
                Write-Host "  ✅ Success: $team $cat refreshed" -ForegroundColor Green
            } else {
                $errors++
                Write-Host "  ❌ Error: $team $cat failed" -ForegroundColor Red
                foreach ($detail in $response.results.details) {
                    if ($detail.status -eq "error") {
                        Write-Host "     $($detail.error)" -ForegroundColor Red
                    }
                }
            }
        } catch {
            $errors++
            Write-Host "  ❌ Exception: $team $cat - $($_.Exception.Message)" -ForegroundColor Red
        }
        
        # Small delay between calls
        Start-Sleep -Seconds 2
    }
}

# Step 2: Refresh bulk player play types + defensive rankings
$current++
$percent = [math]::Round(($current / $total) * 100, 1)
Write-Host "`n[$current/$total] ($percent%) Refreshing bulk player play types + defensive rankings..." -ForegroundColor Yellow

try {
    $url = "$baseUrl/api/cache/nba-league-data?season=2025"
    $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 600  # 10 min timeout
    
    Write-Host "  ✅ Success: Bulk player play types + defensive rankings refreshed" -ForegroundColor Green
    if ($response.summary) {
        Write-Host "     $($response.summary)" -ForegroundColor Gray
    }
    $success++
} catch {
    $errors++
    Write-Host "  ❌ Error: Bulk player play types refresh failed - $($_.Exception.Message)" -ForegroundColor Red
}

# Step 3: Refresh team defense rankings (zone rankings)
$current++
$percent = [math]::Round(($current / $total) * 100, 1)
Write-Host "`n[$current/$total] ($percent%) Refreshing team defense rankings (zone rankings)..." -ForegroundColor Yellow

try {
    $url = "$baseUrl/api/team-defense-rankings?season=2025"
    $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 600  # 10 min timeout
    
    Write-Host "  ✅ Success: Team defense rankings refreshed" -ForegroundColor Green
    $success++
} catch {
    $errors++
    Write-Host "  ❌ Error: Team defense rankings refresh failed - $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Bulk Refresh Complete!" -ForegroundColor Green
Write-Host "  Success: $success" -ForegroundColor Green
Write-Host "  Errors: $errors" -ForegroundColor $(if ($errors -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nAll bulk data has been cached to Supabase." -ForegroundColor Green
Write-Host "Production will now have access to:" -ForegroundColor Green
Write-Host "  ✅ Team tracking stats (potentials)" -ForegroundColor Green
Write-Host "  ✅ Bulk player play types" -ForegroundColor Green
Write-Host "  ✅ Defensive rankings" -ForegroundColor Green
Write-Host "  ✅ Zone defense rankings" -ForegroundColor Green

