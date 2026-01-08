# Test script to verify shot chart and play type defense rankings
# This script refreshes the cache and tests both endpoints

Write-Host "`n🧪 Testing Defense Rankings" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:3000"
$season = 2025
$testTeam = "DAL"  # Dallas Mavericks
$testPlayerId = "1629029"  # Luka Doncic (example player)

Write-Host "`n1️⃣ Refreshing Team Defense Rankings (for shot chart)..." -ForegroundColor Yellow
Write-Host "   This calculates per-game FGM rankings for all shot zones" -ForegroundColor Gray
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/team-defense-rankings?season=$season&bypassCache=true" -Method GET -TimeoutSec 300
    Write-Host "   ✅ Team defense rankings refreshed!" -ForegroundColor Green
    Write-Host "   📊 Rankings cached for all teams" -ForegroundColor Gray
} catch {
    Write-Host "   ❌ Error: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`n2️⃣ Testing Shot Chart Defense Rankings..." -ForegroundColor Yellow
Write-Host "   Testing with player: $testPlayerId, opponent: $testTeam" -ForegroundColor Gray
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/shot-chart-enhanced?playerId=$testPlayerId&season=$season&opponentTeam=$testTeam&bypassCache=true" -Method GET -TimeoutSec 300
    if ($response.opponentRankings) {
        Write-Host "   ✅ Shot chart rankings loaded!" -ForegroundColor Green
        Write-Host "   📊 Opponent rankings source: $($response.opponentRankingsSource)" -ForegroundColor Gray
        
        # Show sample ranking
        if ($response.opponentRankings.aboveBreak3) {
            $ab3 = $response.opponentRankings.aboveBreak3
            Write-Host "   📈 Above Break 3: Rank #$($ab3.rank), FGM/G: $($ab3.fgmPerGame), Total Teams: $($ab3.totalTeams)" -ForegroundColor Cyan
        }
    } else {
        Write-Host "   ⚠️ No opponent rankings in response" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ Error: $_" -ForegroundColor Red
}

Write-Host "`n3️⃣ Testing Play Type Defense Rankings..." -ForegroundColor Yellow
Write-Host "   Testing with team: $testTeam" -ForegroundColor Gray
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/opponent-playtype-defense?team=$testTeam&season=$season&bypassCache=true" -Method GET -TimeoutSec 300
    if ($response.playTypes) {
        Write-Host "   ✅ Play type rankings loaded!" -ForegroundColor Green
        Write-Host "   📊 Found $($response.playTypes.Count) play types" -ForegroundColor Gray
        
        # Show top 3 play types by frequency
        $topPlayTypes = $response.playTypes | Sort-Object -Property frequency -Descending | Select-Object -First 3
        Write-Host "`n   Top 3 Play Types (by frequency):" -ForegroundColor Cyan
        foreach ($pt in $topPlayTypes) {
            $fgmDisplay = if ($pt.fgm) { "$($pt.fgm) FGM/G" } else { "N/A" }
            Write-Host "   • $($pt.displayName): Rank #$($pt.rank), $fgmDisplay, $($pt.points) PTS/G" -ForegroundColor White
        }
    } else {
        Write-Host "   ⚠️ No play types in response" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ Error: $_" -ForegroundColor Red
}

Write-Host "`n✅ Testing Complete!" -ForegroundColor Green
Write-Host "`n📝 To view on dashboard:" -ForegroundColor Yellow
Write-Host "   1. Go to: http://localhost:3000/nba/research/dashboard" -ForegroundColor Cyan
Write-Host "   2. Select a player" -ForegroundColor Cyan
Write-Host "   3. Select an opponent team" -ForegroundColor Cyan
Write-Host "   4. Check the Shot Chart section for zone rankings" -ForegroundColor Cyan
Write-Host "   5. Check the Play Type Analysis section for play type rankings" -ForegroundColor Cyan
Write-Host ""

















