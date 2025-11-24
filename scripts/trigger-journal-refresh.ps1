# PowerShell script to manually trigger journal bet refresh in production
# This checks and updates all pending journal bets

param(
    [string]$BaseUrl = "https://stattrackr.co",
    [string]$Secret = "cf5fa506d35effd43a75a7d94c50ddce4dc1764e986ac5000d9f5efe93e78f08"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Manual Journal Bet Refresh" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ([string]::IsNullOrEmpty($Secret)) {
    Write-Host "⚠️  No secret provided. Trying without authentication..." -ForegroundColor Yellow
    Write-Host ""
}

# Use query parameter for easier authentication
$url = "$BaseUrl/api/check-journal-bets"
if (-not [string]::IsNullOrEmpty($Secret)) {
    $url += "?secret=$Secret"
}

Write-Host "Calling: $url" -ForegroundColor Gray
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 300
    
    Write-Host "✅ Success!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Response:" -ForegroundColor Cyan
    $response | ConvertTo-Json -Depth 10 | Write-Host
    
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody" -ForegroundColor Yellow
    }
    
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Refresh complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

