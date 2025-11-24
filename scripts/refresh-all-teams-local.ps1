# PowerShell script to refresh all team tracking stats locally
# This populates Supabase cache which production can then use

$baseUrl = "http://localhost:3000"
$teams = @(
    "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
    "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
    "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
)
$categories = @("passing", "rebounding")

$total = $teams.Count * $categories.Count
$current = 0
$success = 0
$errors = 0

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "NBA Team Tracking Stats Refresh (Local)" -ForegroundColor Yellow
Write-Host "Total: $total refreshes ($($teams.Count) teams × $($categories.Count) categories)" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Cyan

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
        
        # Small delay between calls to avoid overwhelming the NBA API
        Start-Sleep -Seconds 2
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Refresh Complete!" -ForegroundColor Green
Write-Host "  Success: $success" -ForegroundColor Green
Write-Host "  Errors: $errors" -ForegroundColor $(if ($errors -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

