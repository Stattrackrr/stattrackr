# Tabulates cached Soccerway player-stats coverage for one player.
# Reads /api/soccer/player-props-test?cacheOnly=1 and counts, per category and per stat key:
#   - present:  cell exists (non-null and non-empty string)
#   - nonZero:  numeric value parsed and not exactly 0
#   - missing:  null / blank / absent in that match's category
#
# Example:
#   .\scripts\inspect-soccer-player-stats.ps1 -PlayerKey "haaland-erling"
#   .\scripts\inspect-soccer-player-stats.ps1 -PlayerKey "haaland-erling" -DisplayName "Haaland Erling"

param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$TeamHref = "/team/manchester-city/Wtn9Stg0",
    [Parameter(Mandatory = $true)][string]$PlayerKey,
    [string]$DisplayName = "",
    [int]$Limit = 30,
    [string]$Categories = "all",
    [int]$TimeoutSec = 60
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd("/")

$parts = @(
    "href=$([uri]::EscapeDataString($TeamHref))",
    "cacheOnly=1",
    "playerKey=$([uri]::EscapeDataString($PlayerKey))",
    "limit=$Limit",
    "categories=$([uri]::EscapeDataString($Categories))"
)
if ($DisplayName.Trim().Length -gt 0) {
    $parts += "player=$([uri]::EscapeDataString($DisplayName))"
}
$uri = "$BaseUrl/api/soccer/player-props-test?" + ($parts -join "&")

Write-Host "Inspect soccer player stats" -ForegroundColor Cyan
Write-Host "GET $uri" -ForegroundColor Gray
Write-Host ""

$response = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec $TimeoutSec -ErrorAction Stop

if ($response.success -ne $true) {
    Write-Host "API returned not-success." -ForegroundColor Red
    $response | ConvertTo-Json -Depth 6
    exit 1
}

$matchCount = 0
if ($response.matches) { $matchCount = @($response.matches).Count }
Write-Host "Player:   $($response.player)" -ForegroundColor White
Write-Host "Cache:    $($response.cache.source)  (generatedAt=$($response.cache.generatedAt))" -ForegroundColor White
Write-Host "Matches:  $matchCount" -ForegroundColor White
Write-Host ""

if ($matchCount -eq 0) {
    Write-Host "No cached matches for this player. Run the batch first." -ForegroundColor Yellow
    exit 0
}

# category -> statKey -> @{ present; nonZero }
$buckets = @{}
$catOrder = @('top','shots','attack','passes','defense','goalkeeping','general')

foreach ($match in $response.matches) {
    $cats = $match.categories
    if (-not $cats) { continue }
    foreach ($cat in $catOrder) {
        $row = $cats.$cat
        if (-not $row) { continue }
        $stats = $row.stats
        if (-not $stats) { continue }

        if (-not $buckets.ContainsKey($cat)) { $buckets[$cat] = @{} }
        $catBucket = $buckets[$cat]

        foreach ($prop in $stats.PSObject.Properties) {
            $key = $prop.Name
            $rawValue = $prop.Value
            if (-not $catBucket.ContainsKey($key)) {
                $catBucket[$key] = [pscustomobject]@{ present = 0; nonZero = 0 }
            }
            $entry = $catBucket[$key]
            if ($null -eq $rawValue) { continue }
            $strValue = [string]$rawValue
            if ($strValue.Trim().Length -eq 0) { continue }
            $entry.present++
            $numeric = $strValue -replace '[^\d\.\-]', ''
            $parsed = 0.0
            if ([double]::TryParse($numeric, [ref]$parsed)) {
                if ($parsed -ne 0) { $entry.nonZero++ }
            }
        }
    }
}

foreach ($cat in $catOrder) {
    if (-not $buckets.ContainsKey($cat)) { continue }
    $catBucket = $buckets[$cat]
    if ($catBucket.Count -eq 0) { continue }

    Write-Host ("=== {0,-12}  ({1} stat keys, {2} matches)" -f $cat, $catBucket.Count, $matchCount) -ForegroundColor Magenta

    $rows = $catBucket.GetEnumerator() | ForEach-Object {
        [pscustomobject]@{
            stat     = $_.Key
            present  = $_.Value.present
            missing  = $matchCount - $_.Value.present
            nonZero  = $_.Value.nonZero
            zero     = $_.Value.present - $_.Value.nonZero
        }
    } | Sort-Object -Property nonZero -Descending

    $rows | Format-Table -AutoSize stat, present, missing, nonZero, zero
    Write-Host ""
}
