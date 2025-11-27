# Verify all NBA team abbreviations are correctly mapped for BasketballMonsters

$standardTeams = @(
    'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
    'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
    'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
)

# Current mappings from the code
$STANDARD_TO_BM = @{
    'PHX' = 'PHO'
    'GSW' = 'GS'
    'NOP' = 'NO'
    'NYK' = 'NY'
    'SAS' = 'SA'
    'UTA' = 'UTAH'
    'WAS' = 'WSH'
}

Write-Host "=== Checking all 30 NBA teams ===" -ForegroundColor Cyan
Write-Host ""

$mapped = @()

foreach ($team in $standardTeams) {
    if ($STANDARD_TO_BM.ContainsKey($team)) {
        $bmAbbr = $STANDARD_TO_BM[$team]
        Write-Host "MAPPED: $team maps to $bmAbbr" -ForegroundColor Green
        $mapped += $team
    } else {
        Write-Host "SAME:   $team uses same abbreviation" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Total teams: $($standardTeams.Count)"
Write-Host "Teams with mappings: $($mapped.Count)"
Write-Host "Teams using same abbreviation: $($standardTeams.Count - $mapped.Count)"
