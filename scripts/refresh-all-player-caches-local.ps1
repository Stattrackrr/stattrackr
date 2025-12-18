# PowerShell script to refresh all player shot charts and play type analysis locally
# This script calls the Node.js script which can reach NBA API from your local machine
#
# Usage:
#   .\scripts\refresh-all-player-caches-local.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Refresh All Player Shot Charts & Play Types" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if .env.local exists
if (-not (Test-Path ".env.local")) {
    Write-Host "⚠️  Warning: .env.local not found. Make sure environment variables are set." -ForegroundColor Yellow
    Write-Host ""
}

# Check if Node.js is available
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js version: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js not found. Please install Node.js first." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🔄 Starting player cache refresh..." -ForegroundColor Yellow
Write-Host "This will fetch all active players and refresh their shot charts." -ForegroundColor Gray
Write-Host "This may take 20-30 minutes for all players." -ForegroundColor Gray
Write-Host ""

# Run the Node.js script
node scripts/refresh-all-player-caches.js

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Refresh complete!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ Refresh failed with exit code: $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

