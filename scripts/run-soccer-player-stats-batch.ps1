# Runs GET /api/soccer/player-stats-batch (full squad scrape with parallel players).
# Requires: npm run dev (or any server) on the target port first.
#
# Examples:
#   .\scripts\run-soccer-player-stats-batch.ps1
#   .\scripts\run-soccer-player-stats-batch.ps1 -BaseUrl "http://127.0.0.1:3000"
#   Default batch: puppeteerOnly (API default) - full current season x all categories.
#   Experiment with plain fetch first: .\scripts\run-soccer-player-stats-batch.ps1 -TryFetchFirst
#   .\scripts\run-soccer-player-stats-batch.ps1 -Keys "bernardo-silva,rodri-hernandez" -PlayerConcurrency 2
# One player only (simpler): .\scripts\run-soccer-player-stats-single.ps1 -PlayerKey "ake-nathan"
# Production (needs CRON_SECRET):
#   .\scripts\run-soccer-player-stats-batch.ps1 -BaseUrl "https://your-app.vercel.app" -AuthToken $env:CRON_SECRET

param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$TeamHref = "/team/manchester-city/Wtn9Stg0",
    [int]$PlayerConcurrency = 6,
    [int]$MatchConcurrency = 25,
    [int]$FetchConcurrency = 60,
    [int]$MaxPlayers = 35,
    # Defaults: full current season (limit=season), all 7 categories. Use -Limit 30 for a quick smoke test.
    [string]$Limit = "season",
    [string]$Categories = "all",
    [string]$Keys = "",
    [switch]$TryFetchFirst,
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
    "fetchConcurrency=$FetchConcurrency",
    "maxPlayers=$MaxPlayers",
    "limit=$Limit",
    "categories=$([uri]::EscapeDataString($Categories))",
    "season=current",
    "incremental=1"
)
if ($TryFetchFirst) {
    $parts += "puppeteerOnly=0"
}
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
    Write-Host "  fetchConcurrency:     $($s.fetchConcurrency)" -ForegroundColor White
    Write-Host "  puppeteerFallback:    $($s.puppeteerFallback)" -ForegroundColor White
    Write-Host "  puppeteerOnly:        $($s.puppeteerOnly)" -ForegroundColor White
    Write-Host "  limit:                $($s.limit)" -ForegroundColor White
    Write-Host "  cacheWritesOk:        $($s.cacheWritesOk)" -ForegroundColor Green
    Write-Host "  cacheWritesPartial:   $($s.cacheWritesPartial)" -ForegroundColor DarkYellow
    Write-Host "  scrapeErrors:         $($s.scrapeErrors)" -ForegroundColor $(if ($s.scrapeErrors -gt 0) { "Red" } else { "Gray" })
    Write-Host "  noAppearances (DNP):  $($s.noAppearances)" -ForegroundColor DarkGray
    Write-Host ""

    $scraped = @($response.players | Where-Object { $_.matchCount -gt 0 })
    $errors  = @($response.players | Where-Object { $_.error -and $_.error.ToString().Trim().Length -gt 0 })
    $dnp     = @($response.players | Where-Object { -not $_.error -and $_.matchCount -eq 0 })

    if ($scraped.Count -gt 0) {
        Write-Host "Scraped players ($($scraped.Count)):" -ForegroundColor Green
        $scraped | Sort-Object -Property matchCount -Descending | ForEach-Object {
            Write-Host ("  {0,-26}  matches={1}  writeOk={2}" -f $_.playerKey, $_.matchCount, $_.writeOk) -ForegroundColor White
        }
        Write-Host ""
    }

    if ($errors.Count -gt 0) {
        Write-Host "Errors ($($errors.Count)):" -ForegroundColor Red
        $errors | ForEach-Object {
            Write-Host "  $($_.playerKey)  matches=$($_.matchCount)  writeOk=$($_.writeOk)  err=$($_.error)" -ForegroundColor Red
        }
        Write-Host ""
    }

    if ($dnp.Count -gt 0) {
        Write-Host "No appearances in last $($s.limit) matches ($($dnp.Count); coaches, reserves, injured, etc.):" -ForegroundColor DarkGray
        $dnp | ForEach-Object {
            Write-Host "  $($_.playerKey)" -ForegroundColor DarkGray
        }
    }
} catch {
    Write-Host "Request failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    }
    exit 1
}
