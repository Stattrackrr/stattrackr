param(
  [string]$BaseUrl = "http://localhost:3000",
  [switch]$Deep = $true,
  [switch]$SkipFetch,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Section($text) {
  Write-Host ""
  Write-Host "=== $text ===" -ForegroundColor Cyan
}

function Run-Step($name, $command) {
  Write-Host ""
  Write-Host ">> $name" -ForegroundColor Yellow
  Write-Host "$command" -ForegroundColor DarkGray
  if ($DryRun) {
    Write-Host "(dry-run) skipped" -ForegroundColor DarkYellow
    return
  }
  Invoke-Expression $command
  if ($LASTEXITCODE -ne 0) {
    throw "Step failed: $name"
  }
}

function Assert-File($path) {
  if (!(Test-Path $path)) {
    throw "Required file missing: $path"
  }
  Write-Host "OK file: $path" -ForegroundColor Green
}

function Assert-JsonField($path, $fieldPath) {
  $json = Get-Content -Raw $path | ConvertFrom-Json
  $value = $json
  foreach ($segment in $fieldPath.Split(".")) {
    if ($null -eq $value) {
      throw "Missing field '$fieldPath' in $path"
    }
    $value = $value.$segment
  }
  if ($null -eq $value) {
    throw "Field '$fieldPath' is null/missing in $path"
  }
  Write-Host "OK field: $fieldPath = $value" -ForegroundColor Green
}

Write-Section "AFL Model Local Validation"
Write-Host "Base URL: $BaseUrl"
Write-Host "Deep mode: $Deep"
Write-Host "Skip fetch: $SkipFetch"
Write-Host "Dry run: $DryRun"

if (-not $DryRun) {
  try {
    $health = Invoke-WebRequest -UseBasicParsing -Uri $BaseUrl -TimeoutSec 8
    Write-Host "Local server reachable: $BaseUrl (status $($health.StatusCode))" -ForegroundColor Green
  } catch {
    throw "Cannot reach $BaseUrl. Start dev server first (`npm run dev`)."
  }
}

Write-Section "1) Python syntax sanity"
Run-Step "Compile python scripts" "python -m py_compile `"scripts/afl_model/train_disposals_model.py`" `"scripts/afl_model/score_upcoming.py`" `"scripts/afl_model/evaluate_closed_loop.py`""

if (-not $SkipFetch) {
  Write-Section "2) Refresh context files"
  Run-Step "Fetch AFL DFS usage" "npm run fetch:afl:dfs-usage"
  Run-Step "Fetch AFL weather context" "npm run fetch:afl:weather-context"
}

Write-Section "3) Build / Train / Score / Evaluate"
Run-Step "Build dataset" "python scripts/afl_model/build_dataset.py --base-url `"$BaseUrl`""

if ($Deep) {
  Run-Step "Train candidate (deep)" "python scripts/afl_model/train_disposals_model.py --candidate-only --cv-folds 5 --tune-depth deep --importance-max-rows 2500 --drop-candidate-lookback 16 --drop-candidate-min-runs 6 --calibration-min-samples 140"
} else {
  Run-Step "Train candidate (standard)" "python scripts/afl_model/train_disposals_model.py --candidate-only"
}

Run-Step "Score candidate projections" "python scripts/afl_model/score_upcoming.py --base-url `"$BaseUrl`" --artifact `"data/afl-model/models/latest-candidate-model.json`" --latest-output-path `"data/afl-model/latest-candidate-disposals-projections.json`""
Run-Step "Evaluate + guarded promote" "python scripts/afl_model/evaluate_closed_loop.py --promote-if-pass --freeze-fail-streak 3 --candidate-artifact `"data/afl-model/models/latest-candidate-model.json`" --current-artifact `"data/afl-model/models/latest-model.json`" --candidate-projections `"data/afl-model/latest-candidate-disposals-projections.json`""

Write-Section "4) Output verification"
$requiredFiles = @(
  "data/afl-model/models/latest-candidate-model.json",
  "data/afl-model/models/latest-candidate-calibration.json",
  "data/afl-model/latest-candidate-disposals-projections.json",
  "data/afl-model/history/model-eval-latest.json",
  "data/afl-model/history/model-performance-history.json",
  "data/afl-model/history/model-card-latest.json",
  "data/afl-model/history/model-card-latest.md"
)
foreach ($file in $requiredFiles) {
  if (-not $DryRun) { Assert-File $file } else { Write-Host "(dry-run) would verify file: $file" -ForegroundColor DarkYellow }
}

if (-not $DryRun) {
  Assert-JsonField "data/afl-model/history/model-eval-latest.json" "decision.pass"
  Assert-JsonField "data/afl-model/history/model-eval-latest.json" "decision.promoted"
  Assert-JsonField "data/afl-model/history/model-eval-latest.json" "decision.freezeActive"
  Assert-JsonField "data/afl-model/history/model-eval-latest.json" "candidate.brierScore"
  Assert-JsonField "data/afl-model/history/model-eval-latest.json" "candidate.logLoss"
  Assert-JsonField "data/afl-model/history/model-eval-latest.json" "candidate.positiveClvRate"
}

Write-Section "PASS"
Write-Host "Local AFL model validation completed successfully." -ForegroundColor Green
