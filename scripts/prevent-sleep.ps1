# PowerShell script to prevent PC from sleeping while cache script runs
# Run this BEFORE starting the cache script

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Preventing PC Sleep" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "⚠️  Running without admin - some settings may not apply" -ForegroundColor Yellow
    Write-Host ""
}

# Prevent sleep (when plugged in)
Write-Host "Setting power settings to prevent sleep..." -ForegroundColor Cyan
powercfg /change standby-timeout-ac 0  # Never sleep when plugged in
powercfg /change monitor-timeout-ac 0  # Never turn off monitor when plugged in

Write-Host "✅ Power settings updated!" -ForegroundColor Green
Write-Host ""
Write-Host "Your PC will NOT sleep while plugged in." -ForegroundColor White
Write-Host ""
Write-Host "To restore normal sleep settings later:" -ForegroundColor Yellow
Write-Host "  powercfg /change standby-timeout-ac 20" -ForegroundColor Gray
Write-Host "  powercfg /change monitor-timeout-ac 10" -ForegroundColor Gray
Write-Host ""

