# Runs GET /api/soccer/player-stats-batch (full squad scrape with parallel players).
# Requires: npm run dev (or any server) on the target port first.
#
# Examples:
#   .\scripts\run-soccer-player-stats-batch.ps1
#   .\scripts\run-soccer-player-stats-batch.ps1 -BaseUrl "http://127.0.0.1:3000"
#   .\scripts\run-soccer-player-stats-batch.ps1 -Keys "bernardo-silva,rodri-hernandez" -PlayerConcurrency 2
# One player only (simpler): .\scripts\run-soccer-player-stats-single.ps1 -PlayerKey "ake-nathan"
# Production (needs CRON_SECRET):
#   .\scripts\run-soccer-player-stats-batch.ps1 -BaseUrl "https://your-app.vercel.app" -AuthToken $env:CRON_SECRET

param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$TeamHref = "/team/manchester-city/Wtn9Stg0",
    [int]$PlayerConcurrency = 3,
    [int]$MatchConcurrency = 5,
    [int]$MaxPlayers = 40,
    [int]$Limit = 100,
    [string]$Categories = "top",
    [string]$Keys = "",
    [string]$AuthToken = $null,
    [int]$TimeoutSec = 7200
)

$ErrorActionPreference = "Stop"

$BaseUrl = $BaseUrl.TrimEnd("/")

$parts = @(
    "href=$([uri]::EscapeDataString($TeamHref))",
    "refresh=1",
    "playerConcurrency=$PlayerConcurrency",
    "matchConcurrency=$MatchConcurrency",
    "maxPlayers=$MaxPlayers",
    "limit=$Limit",
    "categories=$([uri]::EscapeDataString($Categories))"
)
if ($Keys.Trim().Length -gt 0) {
    $parts += "keys=$([uri]::EscapeDataString($Keys.Trim()))"
}

$uri = "$BaseUrl/api/soccer/player-stats-batch?" + ($parts -join "&")

Write-Host "Soccer player stats batch" -ForegroundColor Cyan
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
    Write-Host "Categories: $($response.categories -join ',')" -ForegroundColor White
    Write-Host ""
    $s = $response.summary
    Write-Host "Summary:" -ForegroundColor Yellow
    Write-Host "  squadSize:            $($s.squadSize)" -ForegroundColor White
    Write-Host "  prefetchedMatchCount: $($s.prefetchedMatchCount)" -ForegroundColor White
    Write-Host "  playerConcurrency:    $($s.playerConcurrency)" -ForegroundColor White
    Write-Host "  matchConcurrency:     $($s.matchConcurrency)" -ForegroundColor White
    Write-Host "  limit:                $($s.limit)" -ForegroundColor White
    Write-Host "  cacheWritesOk:        $($s.cacheWritesOk)" -ForegroundColor Green
    Write-Host "  cacheWritesPartial:   $($s.cacheWritesPartial)" -ForegroundColor DarkYellow
    Write-Host "  scrapeOrWriteFailed:  $($s.scrapeOrWriteFailed)" -ForegroundColor $(if ($s.scrapeOrWriteFailed -gt 0) { "Red" } else { "Gray" })
    Write-Host ""

    $failed = @($response.players | Where-Object { $_.error -or $_.matchCount -eq 0 })
    if ($failed.Count -gt 0) {
        Write-Host "Players with errors or zero matches ($($failed.Count)):" -ForegroundColor Yellow
        $failed | ForEach-Object {
            Write-Host "  $($_.playerKey)  matches=$($_.matchCount)  writeOk=$($_.writeOk)  err=$($_.error)" -ForegroundColor DarkYellow
        }
    }
} catch {
    Write-Host "Request failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    }
    exit 1
}
