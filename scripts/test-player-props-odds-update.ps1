# PowerShell script to test player props odds update
# This tests the /api/nba/player-props/update-odds endpoint

$baseUrl = "http://localhost:3000"
# In production, replace with your Vercel URL:
# $baseUrl = "https://stattrackr.co"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing Player Props Odds Update" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Cyan

# Step 1: Check current player props (before update)
Write-Host "[1/4] Checking current player props..." -ForegroundColor Gray
try {
    $propsResponse = Invoke-RestMethod -Uri "$baseUrl/api/nba/player-props" -Method GET -TimeoutSec 30
    if ($propsResponse.success -and $propsResponse.data.Count -gt 0) {
        $sampleProp = $propsResponse.data[0]
        Write-Host "  ✅ Found $($propsResponse.data.Count) player props" -ForegroundColor Green
        Write-Host "  Sample prop: $($sampleProp.playerName) $($sampleProp.statType) - Line: $($sampleProp.line), Over: $($sampleProp.overOdds), Under: $($sampleProp.underOdds)" -ForegroundColor Gray
        $oldLine = $sampleProp.line
        $oldOverOdds = $sampleProp.overOdds
        $oldUnderOdds = $sampleProp.underOdds
    } else {
        Write-Host "  ⚠️ No player props found - need to process props first" -ForegroundColor Yellow
        Write-Host "  Run: POST /api/nba/player-props/process" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "  ❌ Error fetching player props: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 2: Check current odds cache
Write-Host "`n[2/4] Checking odds cache..." -ForegroundColor Gray
try {
    $oddsResponse = Invoke-RestMethod -Uri "$baseUrl/api/odds?check_timestamp=1" -Method GET -TimeoutSec 30
    if ($oddsResponse.success) {
        Write-Host "  ✅ Odds cache found" -ForegroundColor Green
        Write-Host "  Last updated: $($oddsResponse.lastUpdated)" -ForegroundColor Gray
        Write-Host "  Next update: $($oddsResponse.nextUpdate)" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠️ No odds cache found - need to refresh odds first" -ForegroundColor Yellow
        Write-Host "  Run: GET /api/odds/refresh" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "  ❌ Error fetching odds: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 3: Trigger odds update endpoint
Write-Host "`n[3/4] Triggering player props odds update..." -ForegroundColor Gray
Write-Host "  This should ONLY update props with changed odds/lines, not process all props" -ForegroundColor Gray
try {
    $updateResponse = Invoke-RestMethod -Uri "$baseUrl/api/nba/player-props/update-odds" -Method POST -TimeoutSec 120
    if ($updateResponse.success) {
        Write-Host "  ✅ Update completed successfully" -ForegroundColor Green
        Write-Host "  Updated existing props: $($updateResponse.updated)" -ForegroundColor Green
        Write-Host "  Removed props (odds disappeared): $($updateResponse.removed)" -ForegroundColor Yellow
        Write-Host "  New props added: $($updateResponse.newProps)" -ForegroundColor Cyan
        Write-Host "  Previous total: $($updateResponse.previousTotal)" -ForegroundColor Gray
        Write-Host "  New total: $($updateResponse.total)" -ForegroundColor Gray
        
        # Verify it's not processing everything from scratch
        # The key indicator is: if 'updated' equals 'total', it's processing everything
        # 'updated' should be much less than 'total' (only props with changed odds)
        if ($updateResponse.updated -lt $updateResponse.total) {
            $percentUpdated = [math]::Round(($updateResponse.updated / $updateResponse.total) * 100, 1)
            Write-Host "  ✅ Only updated $($updateResponse.updated) of $($updateResponse.total) props ($percentUpdated%) - correct!" -ForegroundColor Green
        } elseif ($updateResponse.updated -eq $updateResponse.total -and $updateResponse.total -gt 50) {
            Write-Host "  ⚠️ Updated all $($updateResponse.total) props - might be reprocessing everything" -ForegroundColor Yellow
            Write-Host "     (This is normal if odds changed for all props, but check if it's happening every time)" -ForegroundColor Gray
        } else {
            Write-Host "  ✅ Update looks efficient" -ForegroundColor Green
        }
    } else {
        Write-Host "  ❌ Update failed: $($updateResponse.error)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  ❌ Error updating player props: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 4: Verify player props were updated
Write-Host "`n[4/4] Verifying player props were updated..." -ForegroundColor Gray
try {
    $propsResponseAfter = Invoke-RestMethod -Uri "$baseUrl/api/nba/player-props?refresh=1" -Method GET -TimeoutSec 30
    if ($propsResponseAfter.success -and $propsResponseAfter.data.Count -gt 0) {
        $samplePropAfter = $propsResponseAfter.data[0]
        Write-Host "  ✅ Player props refreshed" -ForegroundColor Green
        Write-Host "  Sample prop: $($samplePropAfter.playerName) $($samplePropAfter.statType)" -ForegroundColor Gray
        Write-Host "  Line: $($samplePropAfter.line) (was: $oldLine)" -ForegroundColor Gray
        Write-Host "  Over: $($samplePropAfter.overOdds) (was: $oldOverOdds)" -ForegroundColor Gray
        Write-Host "  Under: $($samplePropAfter.underOdds) (was: $oldUnderOdds)" -ForegroundColor Gray
        
        if ($samplePropAfter.line -ne $oldLine -or $samplePropAfter.overOdds -ne $oldOverOdds) {
            Write-Host "  ✅ Odds were updated!" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️ Odds appear unchanged (may be same as before)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ⚠️ Could not verify update" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ⚠️ Error verifying update: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Testing Complete" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Cyan

