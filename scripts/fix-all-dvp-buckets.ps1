# Recalculate DVP bucket totals for all teams
# Usage: .\scripts\fix-all-dvp-buckets.ps1

Write-Host "🔧 Recalculating DVP buckets for all teams..." -ForegroundColor Cyan
node scripts/recalculate-dvp-buckets.js all 2025
