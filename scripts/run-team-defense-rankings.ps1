# PowerShell script to populate team defense rankings cache
# This will fetch rankings for all 30 teams and cache them

$baseUrl = "http://localhost:3000"
$season = 2025

Write-Host "`n🏀 Populating Team Defense Rankings Cache" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Season: $season" -ForegroundColor Gray
Write-Host "URL: $baseUrl/api/team-defense-rankings?season=$season&bypassCache=true" -ForegroundColor Gray
Write-Host ""

try {
    Write-Host "⏳ Fetching team defense rankings (this may take 2-5 minutes)..." -ForegroundColor Yellow
    $response = Invoke-RestMethod -Uri "$baseUrl/api/team-defense-rankings?season=$season&bypassCache=true" -Method GET -TimeoutSec 600
    
    if ($response.rankings) {
        $teamCount = ($response.rankings | Get-Member -MemberType NoteProperty).Count
        Write-Host "✅ Successfully cached team defense rankings!" -ForegroundColor Green
        Write-Host "📊 Teams cached: $teamCount" -ForegroundColor Gray
        
        # Show sample rankings
        $sampleTeam = ($response.rankings | Get-Member -MemberType NoteProperty | Select-Object -First 1).Name
        if ($sampleTeam) {
            $sample = $response.rankings.$sampleTeam
            Write-Host "`n📋 Sample rankings for $sampleTeam :" -ForegroundColor Gray
            Write-Host "   Restricted Area: Rank #$($sample.restrictedArea.rank)" -ForegroundColor Gray
            Write-Host "   Paint: Rank #$($sample.paint.rank)" -ForegroundColor Gray
            Write-Host "   Mid-Range: Rank #$($sample.midRange.rank)" -ForegroundColor Gray
        }
    } else {
        Write-Host "⚠️ Response received but no rankings found" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`n✅ Done!" -ForegroundColor Green
