# PowerShell script to fix all DvP positions by fetching actual positions from NBA Stats API
# This uses the fetch-actual-positions.js script to get real positions players played
# 
# Usage:
#   .\scripts\fix-all-dvp-positions.ps1  # Analyze all teams (dry run)
#   .\scripts\fix-all-dvp-positions.ps1 -Apply  # Apply position fixes
#   .\scripts\fix-all-dvp-positions.ps1 -Team MIL  # Fix specific team
#   .\scripts\fix-all-dvp-positions.ps1 -Season 2025 -MinGames 5  # Custom season and minimum games

param(
    [string]$Team = "",
    [int]$Season = 2025,  # Default to 2025-26 season (current season)
    [int]$MinGames = 1,
    [switch]$Apply = $false
)

$scriptPath = Join-Path $PSScriptRoot "fetch-actual-positions.js"

if (-not (Test-Path $scriptPath)) {
    Write-Host "Error: fetch-actual-positions.js not found at $scriptPath" -ForegroundColor Red
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Fix DvP Positions from NBA Stats API" -ForegroundColor Yellow
Write-Host "Season: $Season ($($Season)-$([String]::Format('{0:D2}', ($Season + 1) % 100)))" -ForegroundColor Gray
Write-Host "Minimum games: $MinGames" -ForegroundColor Gray
Write-Host "Note: Using current season (2025-26) - adjust if you need previous season data" -ForegroundColor DarkGray
if ($Apply) {
    Write-Host "Mode: APPLY (will update position files)" -ForegroundColor Green
} else {
    Write-Host "Mode: DRY RUN (no changes will be made)" -ForegroundColor Yellow
}
Write-Host "========================================`n" -ForegroundColor Cyan

$args = @(
    "--season", $Season
    "--min-games", $MinGames
)

if ($Team) {
    $args += "--team", $Team.ToUpper()
} else {
    $args += "--all"
}

if ($Apply) {
    $args += "--apply"
}

Write-Host "Running: node $scriptPath $($args -join ' ')`n" -ForegroundColor Gray

try {
    & node $scriptPath $args
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n========================================" -ForegroundColor Cyan
        if ($Apply) {
            Write-Host "✅ Position fixes applied successfully!" -ForegroundColor Green
            Write-Host "`nNext steps:" -ForegroundColor Yellow
            Write-Host "1. Review the updated position files in data/player_positions/teams/" -ForegroundColor Gray
            Write-Host "2. Run DvP re-ingest to apply new positions to DvP data:" -ForegroundColor Gray
            Write-Host "   .\scripts\reingest-dvp-all.ps1" -ForegroundColor Cyan
        } else {
            Write-Host "✅ Analysis complete!" -ForegroundColor Green
            Write-Host "`nTo apply these fixes, run with -Apply flag:" -ForegroundColor Yellow
            Write-Host "   .\scripts\fix-all-dvp-positions.ps1 -Apply" -ForegroundColor Cyan
        }
        Write-Host "========================================`n" -ForegroundColor Cyan
    } else {
        Write-Host "`n❌ Script exited with error code: $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
} catch {
    Write-Host "`n❌ Error running script: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

