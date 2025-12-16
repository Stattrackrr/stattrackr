# Quick PowerShell script to test the update-odds endpoint
# Usage: .\scripts\test-update-odds.ps1

param(
    [string]$Url = "https://stattrackr.co/api/nba/player-props/update-odds"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing Player Props Odds Update" -ForegroundColor Yellow
Write-Host "URL: $Url" -ForegroundColor Gray
Write-Host "========================================`n" -ForegroundColor Cyan

try {
    Write-Host "Sending POST request..." -ForegroundColor Gray
    $response = Invoke-RestMethod -Uri $Url -Method POST -TimeoutSec 60
    
    Write-Host "`n✅ Success!" -ForegroundColor Green
    Write-Host "Response:" -ForegroundColor Gray
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "`n❌ Error:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response body:" -ForegroundColor Yellow
        Write-Host $responseBody -ForegroundColor Yellow
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan

