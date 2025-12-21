# Quick script to check if props have stat arrays stored

$baseUrl = "http://localhost:3000"

Write-Host "Checking if props have stat arrays..." -ForegroundColor Cyan

try {
    $props = Invoke-RestMethod -Uri "$baseUrl/api/nba/player-props" -Method GET -TimeoutSec 30
    
    if ($props.success -and $props.data.Count -gt 0) {
        $sample = $props.data[0]
        
        Write-Host "`nSample prop: $($sample.playerName) $($sample.statType)" -ForegroundColor Yellow
        Write-Host "Line: $($sample.line)" -ForegroundColor Gray
        
        $hasL5 = $sample.__last5Values -and $sample.__last5Values.Count -gt 0
        $hasL10 = $sample.__last10Values -and $sample.__last10Values.Count -gt 0
        $hasH2H = $sample.__h2hStats -and $sample.__h2hStats.Count -gt 0
        $hasSeason = $sample.__seasonValues -and $sample.__seasonValues.Count -gt 0
        
        Write-Host "`nStat arrays:" -ForegroundColor Yellow
        Write-Host "  __last5Values: $(if ($hasL5) { "✅ $($sample.__last5Values.Count) values" } else { "❌ Missing" })" -ForegroundColor $(if ($hasL5) { "Green" } else { "Red" })
        Write-Host "  __last10Values: $(if ($hasL10) { "✅ $($sample.__last10Values.Count) values" } else { "❌ Missing" })" -ForegroundColor $(if ($hasL10) { "Green" } else { "Red" })
        Write-Host "  __h2hStats: $(if ($hasH2H) { "✅ $($sample.__h2hStats.Count) values" } else { "❌ Missing" })" -ForegroundColor $(if ($hasH2H) { "Green" } else { "Red" })
        Write-Host "  __seasonValues: $(if ($hasSeason) { "✅ $($sample.__seasonValues.Count) values" } else { "❌ Missing" })" -ForegroundColor $(if ($hasSeason) { "Green" } else { "Red" })
        
        if ($hasL5 -or $hasL10 -or $hasH2H -or $hasSeason) {
            Write-Host "`n✅ Stat arrays exist - hit rates can be recalculated!" -ForegroundColor Green
        } else {
            Write-Host "`n❌ No stat arrays - need to reprocess props" -ForegroundColor Red
        }
        
        # Check De'Aaron Fox specifically
        $fox = $props.data | Where-Object { $_.playerName -like "*Fox*" -and $_.statType -eq "THREES" } | Select-Object -First 1
        if ($fox) {
            Write-Host "`nDe'Aaron Fox THREES:" -ForegroundColor Yellow
            Write-Host "  Line: $($fox.line)" -ForegroundColor Gray
            Write-Host "  L5: $($fox.last5HitRate.hits)/$($fox.last5HitRate.total)" -ForegroundColor Gray
            Write-Host "  Has stat arrays: $(if ($fox.__last5Values) { "Yes" } else { "No" })" -ForegroundColor Gray
        }
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}






