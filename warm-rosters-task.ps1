$ErrorActionPreference = 'Stop'
$base = $env:BASE_URL
if (-not $base) { $base = 'http://127.0.0.1:3000' }

function Ymd([datetime]$d){ return $d.ToString('yyyyMMdd') }

$today = Get-Date
$dates = @($today, $today.AddDays(-1), $today.AddDays(1))

# Determine window minutes (PowerShell 5 compatible)
$window = 180
if ($env:ROSTER_WINDOW_MIN -and ($env:ROSTER_WINDOW_MIN -match '^[0-9]+$')) { $window = [int]$env:ROSTER_WINDOW_MIN }

# Smart throttle: outside 180-min window, run effectively hourly (only on minute 0)
function Get-EarliestMinsToTip([datetime]$d){
  try {
    $ymd = Ymd $d
    $sb = Invoke-RestMethod -Uri "https://site.web.api.espn.com/apis/v2/sports/basketball/nba/scoreboard?dates=$ymd" -Method GET -Headers @{ 'Accept'='application/json' }
    $events = @($sb.events)
    if (-not $events) { return $null }
    $now = Get-Date
    $mins = @()
    foreach ($e in $events) {
      $comp = $e.competitions[0]
      $ds = if ($comp.date) { [string]$comp.date } elseif ($e.date) { [string]$e.date } else { $null }
      if ($ds) {
        $tip = Get-Date $ds
        $delta = [Math]::Round(($tip - $now).TotalMinutes)
        $mins += $delta
      }
    }
    if ($mins.Count -gt 0) { return ($mins | Measure-Object -Minimum).Minimum } else { return $null }
  } catch { return $null }
}

$minsToEarliest = Get-EarliestMinsToTip $today
if ($minsToEarliest -ne $null -and $minsToEarliest -gt 180) {
  # Outside 3h pregame; only proceed on top of the hour
  if ((Get-Date).Minute -ne 0) {
    Write-Host "[warm-rosters] skip: earliest tip in $minsToEarliest min (>180), not top of hour"
    exit 0
  }
}

$worked = $false
foreach ($d in $dates) {
  $ymd = Ymd $d
  $url = "$base/api/depth-chart/warm-tminus10?date=$ymd&window_min=$window"
  Write-Host "[warm-rosters] hitting $url"
  try {
    $res = Invoke-RestMethod -Uri $url -Method GET -Headers @{ 'Accept'='application/json' }
    $json = $res | ConvertTo-Json -Depth 5
    Write-Host $json
    if ($res.success -eq $true) { $worked = $true; break }
  } catch {
    Write-Host ("[warm-rosters] request failed for {0}: {1}" -f $ymd, $_.Exception.Message)
  }
}

if (-not $worked) { throw "No games found for today/±1 or requests failed." }
