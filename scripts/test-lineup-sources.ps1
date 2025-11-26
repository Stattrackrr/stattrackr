# Test different lineup websites to find a reliable source
# 
# Usage:
#   .\scripts\test-lineup-sources.ps1 -Team MIL
#   .\scripts\test-lineup-sources.ps1 -Team MIL -Date "2025-11-26"

param(
    [string]$Team = "MIL",
    [string]$Date = "",
    [string]$BaseUrl = "http://localhost:3000"
)

$testDate = if ($Date) { $Date } else { Get-Date -Format "yyyy-MM-dd" }

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing Lineup Sources" -ForegroundColor Yellow
Write-Host "Team: $Team" -ForegroundColor Gray
Write-Host "Date: $testDate" -ForegroundColor Gray
Write-Host "========================================`n" -ForegroundColor Cyan

try {
    $url = "$BaseUrl/api/dvp/test-lineup-sources?team=$Team&date=$testDate"
    $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 60
    
    Write-Host "Results:" -ForegroundColor Yellow
    Write-Host "  Total sources tested: $($response.summary.total)" -ForegroundColor Gray
    Write-Host "  Successful: $($response.summary.successful)" -ForegroundColor Green
    Write-Host "  Failed: $($response.summary.failed)" -ForegroundColor $(if ($response.summary.failed -gt 0) { "Yellow" } else { "Gray" })
    Write-Host ""
    
    if ($response.successfulSources -and $response.successfulSources.Count -gt 0) {
        Write-Host "✅ SUCCESSFUL SOURCES:" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Cyan
        foreach ($source in $response.successfulSources) {
            Write-Host "`n$($source.source)" -ForegroundColor Cyan
            Write-Host "  URL: $($source.url)" -ForegroundColor Gray
            Write-Host "  Note: $($source.note)" -ForegroundColor Gray
            if ($source.sample) {
                Write-Host "  Sample HTML (first 200 chars):" -ForegroundColor DarkGray
                Write-Host "    $($source.sample.Substring(0, [Math]::Min(200, $source.sample.Length)))..." -ForegroundColor DarkGray
            }
        }
    }
    
    if ($response.failedSources -and $response.failedSources.Count -gt 0) {
        Write-Host "`n❌ FAILED SOURCES:" -ForegroundColor Red
        Write-Host "========================================" -ForegroundColor Cyan
        foreach ($source in $response.failedSources) {
            Write-Host "$($source.source): $($source.error)" -ForegroundColor Yellow
        }
    }
    
    Write-Host "`n$($response.recommendation)" -ForegroundColor Yellow
    Write-Host "`n========================================`n" -ForegroundColor Cyan
    
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

