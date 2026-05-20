# Warm deep player-stats for all 20 Premier League squads (current season).
# Runs teams concurrently (defaults = max caps). Requires npm run dev on BaseUrl first.
#
# Examples:
#   .\scripts\run-soccer-player-stats-pl.ps1
#   .\scripts\run-soccer-player-stats-pl.ps1 -TeamConcurrency 3
#   .\scripts\run-soccer-player-stats-pl.ps1 -Teams "arsenal,liverpool"
#   .\scripts\run-soccer-player-stats-pl.ps1 -DryRun
# Production:
#   .\scripts\run-soccer-player-stats-pl.ps1 -BaseUrl "https://your-app.vercel.app" -AuthToken $env:CRON_SECRET

param(
    [string]$BaseUrl = "http://localhost:3000",
    [int]$TeamConcurrency = 3,
    [string]$Limit = "season",
    [int]$MaxPlayers = 35,
    [int]$PlayerConcurrency = 6,
    [string]$Teams = "",
    [switch]$DryRun,
    [string]$AuthToken = $null
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$env:SOCCER_PL_STATS_BASE_URL = $BaseUrl.TrimEnd("/")
$env:SOCCER_PL_STATS_TEAM_CONCURRENCY = "$TeamConcurrency"
$env:SOCCER_PL_STATS_LIMIT = "$Limit"
$env:SOCCER_PL_STATS_MAX_PLAYERS = "$MaxPlayers"
$env:SOCCER_PL_STATS_PLAYER_CONCURRENCY = "$PlayerConcurrency"
if ($Teams.Trim().Length -gt 0) {
    $env:SOCCER_PL_STATS_TEAMS = $Teams.Trim()
}
if ($DryRun) {
    $env:SOCCER_PL_STATS_DRY_RUN = "1"
}
if ($AuthToken) {
    $env:CRON_SECRET = $AuthToken
}

Write-Host "Premier League player-stats warm (all squads)" -ForegroundColor Cyan
Write-Host "  teamConcurrency=$TeamConcurrency  limit=$Limit (0/season=full season)  season=current" -ForegroundColor Gray
Write-Host ""

node (Join-Path $RepoRoot "scripts\warm-soccer-player-stats-pl.js")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
