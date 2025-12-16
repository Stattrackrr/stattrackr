# PowerShell script to pre-cache "Last 5 Games" tracking stats for all teams
# This populates Supabase cache for instant loading

$baseUrl = "https://stattrackr.co"  # Change to http://localhost:3000 for local testing
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
Write-Host "Pre-caching Last 5 Games Tracking Stats" -ForegroundColor Yellow
Write-Host "Total: $total refreshes" -ForegroundColor Yellow
Write-Host "  - $($teams.Count) teams × $($categories.Count) categories" -ForegroundColor Gray
Write-Host "========================================`n" -ForegroundColor Cyan

foreach ($team in $teams) {
    foreach ($cat in $categories) {
        $current++
        $percent = [math]::Round(($current / $total) * 100, 1)
        
        Write-Host "[$current/$total] ($percent%) Caching $team $cat (Last 5 Games)..." -ForegroundColor Gray
        
        $url = "$baseUrl/api/tracking-stats/team?team=$team&category=$cat&lastNGames=5&season=2025"
        
        try {
            $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 60
            
            if ($response.players -and $response.players.Count -gt 0) {
                $success++
                Write-Host "  ✅ Success: $team $cat cached ($($response.players.Count) players)" -ForegroundColor Green
            } else {
                $errors++
                Write-Host "  ⚠️ Warning: $team $cat - No players found" -ForegroundColor Yellow
            }
        } catch {
            $errors++
            Write-Host "  ❌ Error: $team $cat - $($_.Exception.Message)" -ForegroundColor Red
        }
        
        # Small delay to avoid rate limiting
        Start-Sleep -Seconds 1
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Complete!" -ForegroundColor Yellow
Write-Host "  Success: $success" -ForegroundColor Green
Write-Host "  Errors: $errors" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "Green" })
Write-Host "========================================" -ForegroundColor Cyan

