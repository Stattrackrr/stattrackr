# PowerShell script to test if update-odds correctly updates lines and recalculates hit rates
# This tests the scenario where a line changes (e.g., 1.5 → 2.5)

$baseUrl = "http://localhost:3000"
# For production testing: $baseUrl = "https://stattrackr.co"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing Player Props Line Update" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Cyan

# Step 1: Get current player props (before update)
Write-Host "[1/5] Fetching current player props..." -ForegroundColor Gray
try {
    $propsBefore = Invoke-RestMethod -Uri "$baseUrl/api/nba/player-props" -Method GET -TimeoutSec 30
    if ($propsBefore.success -and $propsBefore.data.Count -gt 0) {
        $sampleProp = $propsBefore.data[0]
        Write-Host "  ✅ Found $($propsBefore.data.Count) player props" -ForegroundColor Green
        Write-Host "  Sample prop: $($sampleProp.playerName) $($sampleProp.statType)" -ForegroundColor Gray
        Write-Host "    Line: $($sampleProp.line)" -ForegroundColor Gray
        Write-Host "    L5 Hit Rate: $($sampleProp.last5HitRate.hits)/$($sampleProp.last5HitRate.total) ($([math]::Round(($sampleProp.last5HitRate.hits / $sampleProp.last5HitRate.total) * 100, 1))%)" -ForegroundColor Gray
        Write-Host "    L10 Hit Rate: $($sampleProp.last10HitRate.hits)/$($sampleProp.last10HitRate.total) ($([math]::Round(($sampleProp.last10HitRate.hits / $sampleProp.last10HitRate.total) * 100, 1))%)" -ForegroundColor Gray
        $oldLine = $sampleProp.line
        $oldL5Hits = $sampleProp.last5HitRate.hits
        $oldL5Total = $sampleProp.last5HitRate.total
        $oldL10Hits = $sampleProp.last10HitRate.hits
        $oldL10Total = $sampleProp.last10HitRate.total
    } else {
        Write-Host "  ⚠️ No player props found - need to process props first" -ForegroundColor Yellow
        Write-Host "  Run: POST /api/nba/player-props/process" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "  ❌ Error fetching player props: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 2: Check odds cache
Write-Host "`n[2/5] Checking odds cache..." -ForegroundColor Gray
try {
    $oddsResponse = Invoke-RestMethod -Uri "$baseUrl/api/odds?check_timestamp=1" -Method GET -TimeoutSec 30
    if ($oddsResponse.success) {
        Write-Host "  ✅ Odds cache found" -ForegroundColor Green
        Write-Host "  Last updated: $($oddsResponse.lastUpdated)" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠️ No odds cache found - need to refresh odds first" -ForegroundColor Yellow
        Write-Host "  Run: GET /api/odds/refresh" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "  ❌ Error fetching odds: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 3: Trigger player props update
Write-Host "`n[3/5] Triggering player props odds update..." -ForegroundColor Gray
try {
    $updateResponse = Invoke-RestMethod -Uri "$baseUrl/api/nba/player-props/update-odds" -Method POST -TimeoutSec 300
    if ($updateResponse.success) {
        Write-Host "  ✅ Player props update completed successfully." -ForegroundColor Green
        Write-Host "  Updated: $($updateResponse.updated), Not Found: $($updateResponse.notFound), Total: $($updateResponse.total)" -ForegroundColor Gray
        Write-Host "  Elapsed: $($updateResponse.elapsed)" -ForegroundColor Gray
    } else {
        Write-Host "  ❌ Error triggering player props update: $($updateResponse.error)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $errorResponse = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($errorResponse)
        $responseBody = $reader.ReadToEnd()
        Write-Host "  Response: $responseBody" -ForegroundColor Red
    }
    exit 1
}

# Step 4: Wait a moment for cache to update
Write-Host "`n[4/5] Waiting for cache to update..." -ForegroundColor Gray
Start-Sleep -Seconds 3

# Step 5: Verify player props (after update)
Write-Host "`n[5/5] Verifying player props after update..." -ForegroundColor Gray
try {
    # Use refresh=1 to bypass client-side cache and get latest from server
    $updatedPropsResponse = Invoke-RestMethod -Uri "$baseUrl/api/nba/player-props?refresh=1" -Method GET -TimeoutSec 30
    if ($updatedPropsResponse.success -and $updatedPropsResponse.data.Count -gt 0) {
        # Find the same prop we looked at before
        $updatedSampleProp = $updatedPropsResponse.data | Where-Object { 
            $_.playerName -eq $sampleProp.playerName -and $_.statType -eq $sampleProp.statType 
        } | Select-Object -First 1
        
        if ($updatedSampleProp) {
            Write-Host "  ✅ Found updated prop for $($updatedSampleProp.playerName) $($updatedSampleProp.statType)" -ForegroundColor Green
            Write-Host "    Old Line: $oldLine → New Line: $($updatedSampleProp.line)" -ForegroundColor Gray
            Write-Host "    Old L5: $oldL5Hits/$oldL5Total → New L5: $($updatedSampleProp.last5HitRate.hits)/$($updatedSampleProp.last5HitRate.total)" -ForegroundColor Gray
            Write-Host "    Old L10: $oldL10Hits/$oldL10Total → New L10: $($updatedSampleProp.last10HitRate.hits)/$($updatedSampleProp.last10HitRate.total)" -ForegroundColor Gray
            
            # Check if line changed
            if ([math]::Abs($updatedSampleProp.line - $oldLine) > 0.1) {
                Write-Host "`n  🎉 Line changed from $oldLine to $($updatedSampleProp.line)!" -ForegroundColor Green
                
                # Check if hit rates changed (they should if line changed)
                $l5Changed = ($updatedSampleProp.last5HitRate.hits -ne $oldL5Hits) -or ($updatedSampleProp.last5HitRate.total -ne $oldL5Total)
                $l10Changed = ($updatedSampleProp.last10HitRate.hits -ne $oldL10Hits) -or ($updatedSampleProp.last10HitRate.total -ne $oldL10Total)
                
                if ($l5Changed -or $l10Changed) {
                    Write-Host "  ✅ Hit rates recalculated for new line!" -ForegroundColor Green
                } else {
                    Write-Host "  ⚠️ Hit rates did not change - may need to check if stat value arrays are stored" -ForegroundColor Yellow
                }
            } else {
                Write-Host ""
                Write-Host "  Info: Line did not change (still $oldLine) - this is expected if odds have not changed" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  ⚠️ Could not find the same prop after update" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ⚠️ No player props found after update." -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ❌ Error verifying updated player props: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Test Complete" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Cyan

