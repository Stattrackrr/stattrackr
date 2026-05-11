# Scrape + cache Soccerway player stats for ONE squad member (uses keys= on the batch API).
# Requires: dev server (or production URL) running.
#
# The slug is the Soccerway /player/{slug}/... segment (same as roster playerKey), e.g. ake-nathan.
# Find it: open the team squad on Soccerway, click the player, or call GET /api/soccer/player-stats-roster-report?href=...
#
# Examples:
#   .\scripts\run-soccer-player-stats-single.ps1 -PlayerKey "ake-nathan"
#   npm run soccer:player-stats:one -- -PlayerKey "ake-nathan"
#   $env:SOCCER_PLAYER_KEY = "ake-nathan"; .\scripts\run-soccer-player-stats-single.ps1
#   .\scripts\run-soccer-player-stats-single.ps1 -PlayerKey "ake-nathan" -BaseUrl "http://127.0.0.1:3000"
# Production (needs CRON_SECRET in Authorization):
#   .\scripts\run-soccer-player-stats-single.ps1 -PlayerKey "ake-nathan" -BaseUrl "https://your-app.vercel.app" -AuthToken $env:CRON_SECRET

param(
    [string]$PlayerKey = "",
    [string]$BaseUrl = "http://localhost:3000",
    [string]$TeamHref = "/team/manchester-city/Wtn9Stg0",
    [int]$PlayerConcurrency = 1,
    [int]$MatchConcurrency = 5,
    [int]$Limit = 100,
    [string]$Categories = "top",
    [string]$AuthToken = $null,
    [int]$TimeoutSec = 3600
)

$ErrorActionPreference = "Stop"

$key = $PlayerKey.Trim()
if (-not $key) {
    $key = [string]$env:SOCCER_PLAYER_KEY
}
$key = $key.Trim().ToLowerInvariant()
if (-not $key) {
    Write-Host "Missing -PlayerKey (Soccerway squad slug, e.g. ake-nathan)." -ForegroundColor Red
    Write-Host "Set SOCCER_PLAYER_KEY or pass: -PlayerKey ake-nathan" -ForegroundColor Yellow
    exit 1
}

$BaseUrl = $BaseUrl.TrimEnd("/")

$parts = @(
    "href=$([uri]::EscapeDataString($TeamHref))",
    "refresh=1",
    "keys=$([uri]::EscapeDataString($key))",
    "playerConcurrency=$PlayerConcurrency",
    "matchConcurrency=$MatchConcurrency",
    "maxPlayers=55",
    "limit=$Limit",
    "categories=$([uri]::EscapeDataString($Categories))"
)

$uri = "$BaseUrl/api/soccer/player-stats-batch?" + ($parts -join "&")

Write-Host "Soccer player stats (single player)" -ForegroundColor Cyan
Write-Host "  playerKey: $key" -ForegroundColor White
Write-Host "GET $uri" -ForegroundColor Gray
Write-Host ""

$headers = @{}
if ($AuthToken) {
    $headers["Authorization"] = "Bearer $AuthToken"
    Write-Host "Using Authorization: Bearer ***" -ForegroundColor Gray
}

try {
    $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec $TimeoutSec -ErrorAction Stop

    if ($response.success -ne $true) {
        Write-Host "Response was not success: $($response | ConvertTo-Json -Depth 5)" -ForegroundColor Red
        exit 1
    }

    Write-Host "Finished: $($response.finishedAt)" -ForegroundColor Green
    Write-Host "Team: $($response.teamHref)" -ForegroundColor White
    Write-Host ""

    foreach ($p in @($response.players)) {
        $color = if ($p.matchCount -gt 0 -and $p.writeOk) { "Green" } else { "Yellow" }
        $dn = $p.displayName
        Write-Host "  $($p.playerKey)  displayName=$dn  matches=$($p.matchCount)  writeOk=$($p.writeOk)  err=$($p.error)" -ForegroundColor $color
        if ($p.hint) {
            Write-Host "  hint: $($p.hint)" -ForegroundColor DarkGray
        }
    }
} catch {
    $msg = $_.Exception.Message
    Write-Host ('Request failed: ' + $msg) -ForegroundColor Red
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    }
    exit 1
}
