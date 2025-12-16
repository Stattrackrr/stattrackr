# Quick local test script for update-odds
# Make sure your local server is running: npm run dev

$baseUrl = "http://localhost:3000"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Local Test: Player Props Line Update" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Get a sample prop
Write-Host "[1/4] Fetching current player props..." -ForegroundColor Gray
try {
    $props = Invoke-RestMethod -Uri "$baseUrl/api/nba/player-props" -Method GET -TimeoutSec 30
    if ($props.success -and $props.data.Count -gt 0) {
        $sample = $props.data[0]
        Write-Host "  ✅ Sample prop: $($sample.playerName) $($sample.statType)" -ForegroundColor Green
        Write-Host "    Line: $($sample.line)" -ForegroundColor Gray
        Write-Host "    L5: $($sample.last5HitRate.hits)/$($sample.last5HitRate.total) ($([math]::Round(($sample.last5HitRate.hits / $sample.last5HitRate.total) * 100, 1))%)" -ForegroundColor Gray
        Write-Host "    L10: $($sample.last10HitRate.hits)/$($sample.last10HitRate.total) ($([math]::Round(($sample.last10HitRate.hits / $sample.last10HitRate.total) * 100, 1))%)" -ForegroundColor Gray
        
        # Check if stat arrays exist
        $hasArrays = $sample.__last5Values -or $sample.__last10Values -or $sample.__h2hStats -or $sample.__seasonValues
        if ($hasArrays) {
            Write-Host "    ✅ Stat arrays exist (can recalculate)" -ForegroundColor Green
        } else {
            Write-Host "    ⚠️ No stat arrays - hit rates won't recalculate" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ⚠️ No props found" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Make sure your local server is running: npm run dev" -ForegroundColor Yellow
    exit 1
}

# Step 2: Check odds
Write-Host ""
Write-Host "[2/4] Checking odds cache..." -ForegroundColor Gray
try {
    $odds = Invoke-RestMethod -Uri "$baseUrl/api/odds?check_timestamp=1" -Method GET -TimeoutSec 30
    if ($odds.success) {
        Write-Host "  ✅ Odds cache found" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️ No odds cache - refreshing..." -ForegroundColor Yellow
        Invoke-RestMethod -Uri "$baseUrl/api/odds/refresh" -Method GET -TimeoutSec 60
        Start-Sleep -Seconds 3
    }
} catch {
    Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 3: Update props
Write-Host ""
Write-Host "[3/4] Updating player props..." -ForegroundColor Gray
try {
    $update = Invoke-RestMethod -Uri "$baseUrl/api/nba/player-props/update-odds" -Method POST -TimeoutSec 300
    if ($update.success) {
        Write-Host "  ✅ Updated: $($update.updated)/$($update.total)" -ForegroundColor Green
        Write-Host "    Lines changed: $($update.linesChanged)" -ForegroundColor Gray
        Write-Host "    Hit rates recalculated: $($update.hitRatesRecalculated)" -ForegroundColor Gray
    } else {
        Write-Host "  ❌ Error: $($update.error)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 4: Verify
Write-Host ""
Write-Host "[4/4] Verifying..." -ForegroundColor Gray
Start-Sleep -Seconds 2
try {
    $updated = Invoke-RestMethod -Uri "$baseUrl/api/nba/player-props?refresh=1" -Method GET -TimeoutSec 30
    $same = $updated.data | Where-Object { $_.playerName -eq $sample.playerName -and $_.statType -eq $sample.statType } | Select-Object -First 1
    
    if ($same) {
        Write-Host "  ✅ Updated prop found" -ForegroundColor Green
        Write-Host "    Line: $($sample.line) → $($same.line)" -ForegroundColor Gray
        Write-Host "    L5: $($sample.last5HitRate.hits)/$($sample.last5HitRate.total) → $($same.last5HitRate.hits)/$($same.last5HitRate.total)" -ForegroundColor Gray
        Write-Host "    L10: $($sample.last10HitRate.hits)/$($sample.last10HitRate.total) → $($same.last10HitRate.hits)/$($same.last10HitRate.total)" -ForegroundColor Gray
        
        if ($same.last5HitRate.hits -ne $sample.last5HitRate.hits -or $same.last10HitRate.hits -ne $sample.last10HitRate.hits) {
            Write-Host ""
            Write-Host "  Success: Hit rates were recalculated!" -ForegroundColor Green
        } else {
            Write-Host ""
            Write-Host "  Info: Hit rates unchanged (line may not have changed)" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Complete" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

