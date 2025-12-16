# PowerShell script to test Last 5 Games cache
# Usage: .\scripts\test-last5-cache.ps1

$baseUrl = "http://localhost:3000"
# For production: $baseUrl = "https://stattrackr.co"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing Last 5 Games Cache" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Cyan

# Test 1: Trigger bulk refresh
Write-Host "[1/3] Triggering bulk refresh..." -ForegroundColor Gray
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/tracking-stats/refresh" -Method GET -TimeoutSec 300
    Write-Host "✅ Refresh complete!" -ForegroundColor Green
    Write-Host "   Teams processed: $($response.teamsProcessed)" -ForegroundColor Gray
    Write-Host "   Last 5 Games cached: $($response.last5GamesCached)" -ForegroundColor Gray
    Write-Host "   Errors: $($response.last5GamesErrors)" -ForegroundColor Gray
    Write-Host "   Elapsed: $($response.elapsed)" -ForegroundColor Gray
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n[2/3] Testing a few teams..." -ForegroundColor Gray

# Test 2: Check if Last 5 Games data is cached for a few teams
$testTeams = @("LAL", "BOS", "GSW")
$testCategory = "passing"

foreach ($team in $testTeams) {
    try {
        $url = "$baseUrl/api/tracking-stats/team?team=$team&category=$testCategory&lastNGames=5"
        $response = Invoke-RestMethod -Uri $url -Method GET
        
        if ($response.players -and $response.players.Length -gt 0) {
            Write-Host "   ✅ $team $testCategory (Last 5): $($response.players.Length) players cached" -ForegroundColor Green
        } else {
            Write-Host "   ⚠️ $team $testCategory (Last 5): No players found" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "   ❌ $team $testCategory (Last 5): Error - $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n[3/3] Testing All Games vs Last 5 Games..." -ForegroundColor Gray

# Test 3: Compare All Games vs Last 5 Games for one team
$testTeam = "LAL"
try {
    $allGamesUrl = "$baseUrl/api/tracking-stats/team?team=$testTeam&category=passing"
    $last5Url = "$baseUrl/api/tracking-stats/team?team=$testTeam&category=passing&lastNGames=5"
    
    $allGames = Invoke-RestMethod -Uri $allGamesUrl -Method GET
    $last5 = Invoke-RestMethod -Uri $last5Url -Method GET
    
    Write-Host "   $testTeam Passing Stats:" -ForegroundColor Gray
    Write-Host "   - All Games: $($allGames.players.Length) players" -ForegroundColor Gray
    Write-Host "   - Last 5 Games: $($last5.players.Length) players" -ForegroundColor Gray
    
    if ($last5.players.Length -gt 0) {
        Write-Host "   ✅ Last 5 Games cache is working!" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️ Last 5 Games cache may not be populated yet" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ Error comparing: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Test Complete!" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Cyan

