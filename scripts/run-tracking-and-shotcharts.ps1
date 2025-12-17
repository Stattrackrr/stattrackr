param(
    [string]$BaseUrl = "http://localhost:3000"
)

Write-Host "== Season-only potentials ==" -ForegroundColor Yellow
C:\Windows\System32\curl.exe "$BaseUrl/api/tracking-stats/refresh?mode=season"

Write-Host "== Full potentials (season + L5) ==" -ForegroundColor Yellow
C:\Windows\System32\curl.exe "$BaseUrl/api/tracking-stats/refresh"

Write-Host "== Shot charts / defensive rankings ==" -ForegroundColor Yellow
# Replace with your existing shot chart/defensive command, for example:
# node scripts/populate-all-nba-cache.js

