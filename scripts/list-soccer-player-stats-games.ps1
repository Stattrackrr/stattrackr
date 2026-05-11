# Lists squad players as one line each: "haaland erling - 66 games" (limit + categories must match batch scrape).
#
# Usage:
#   .\scripts\list-soccer-player-stats-games.ps1
#   .\scripts\list-soccer-player-stats-games.ps1 -ShowGames   # optional: print every match line
#   .\scripts\list-soccer-player-stats-games.ps1 -JsonOut ".\tmp\man-city-player-games.json"

param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$TeamHref = "/team/manchester-city/Wtn9Stg0",
    [int]$Limit = 100,
    [string]$Categories = "top",
    [string]$JsonOut = "",
    [switch]$ShowGames
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd("/")

$uri =
    "$BaseUrl/api/soccer/player-stats-roster-report?" +
    "href=$([uri]::EscapeDataString($TeamHref))" +
    "&limit=$Limit" +
    "&categories=$([uri]::EscapeDataString($Categories))"

Write-Host "GET $uri" -ForegroundColor Gray
$response = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 120 -ErrorAction Stop

if ($response.success -ne $true) {
    Write-Host ($response | ConvertTo-Json -Depth 6) -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Team: $($response.teamHref)   limit=$($response.limit)   categories=$($response.categories -join ',')" -ForegroundColor Cyan
Write-Host "Squad listed: $($response.summary.squadListed)  |  With cached games: $($response.summary.playersWithCachedGames)  |  No cache: $($response.summary.playersWithNoCache)" -ForegroundColor White
Write-Host ""

if (-not $ShowGames) {
    $rows = @($response.players) | ForEach-Object {
        [PSCustomObject]@{
            Player = [string]$_.displayName
            Games  = [int]$_.matchCount
        }
    }
    foreach ($row in ($rows | Sort-Object -Property Games -Descending)) {
        $name = $row.Player.Trim()
        if (-not $name) { $name = "?" }
        Write-Host ("{0} - {1} games" -f $name.ToLowerInvariant(), $row.Games)
    }
}
else {
    foreach ($p in @($response.players)) {
        if ($p.matchCount -le 0) {
            Write-Host "--- $($p.displayName) ($($p.playerKey)) -- no cached games ---" -ForegroundColor DarkGray
            continue
        }
        Write-Host "--- $($p.displayName) ($($p.playerKey)) -- $($p.matchCount) games (cache $($p.generatedAt)) ---" -ForegroundColor Yellow
        foreach ($g in @($p.games)) {
            $when = if ($g.kickoffIso) { $g.kickoffIso } else { "?" }
            Write-Host ("  {0}  {1} {2} vs {3}  [{4}]" -f $when, $g.venue, $g.result, $g.opponent, $g.competitionName)
        }
        Write-Host ""
    }
}

if ($JsonOut.Trim().Length -gt 0) {
    $response | ConvertTo-Json -Depth 12 | Set-Content -Path $JsonOut.Trim() -Encoding utf8
    Write-Host "Wrote JSON to $JsonOut" -ForegroundColor Green
}
