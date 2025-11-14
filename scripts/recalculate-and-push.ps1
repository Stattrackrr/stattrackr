# Script to recalculate buckets and push to GitHub
# Usage: .\scripts\recalculate-and-push.ps1 [TEAM|ALL]

param(
    [string]$Team = "ALL"
)

Write-Host "[*] Recalculating buckets..." -ForegroundColor Cyan

# Run the recalculate script
if ($Team -eq "ALL") {
    node scripts/recalculate-buckets.js ALL
} else {
    node scripts/recalculate-buckets.js $Team.ToUpper()
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] Recalculation failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`n[*] Checking for changes..." -ForegroundColor Cyan

# Check if there are changes to dvp_store files
$changes = git status --short | Select-String -Pattern "data/dvp_store/"

if (-not $changes) {
    Write-Host "[!] No changes detected in dvp_store files." -ForegroundColor Yellow
    Write-Host "[*] Buckets may already be up to date." -ForegroundColor Gray
    exit 0
}

Write-Host "[+] Found changes:" -ForegroundColor Green
$changes | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }

# Stage dvp_store files
Write-Host "`n[*] Staging changes..." -ForegroundColor Cyan
git add data/dvp_store/2025/

# Commit
Write-Host "[*] Committing changes..." -ForegroundColor Cyan
$commitMsg = if ($Team -eq "ALL") { 
    "Recalculate buckets for all teams" 
} else { 
    "Recalculate buckets for $Team" 
}
git commit -m $commitMsg

if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] Commit failed!" -ForegroundColor Red
    exit 1
}

# Push
Write-Host "[*] Pushing to GitHub..." -ForegroundColor Cyan
git push

if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] Push failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`n[+] Success! Buckets recalculated and pushed to GitHub." -ForegroundColor Green
Write-Host "[*] Vercel will deploy automatically. Stats will update after deployment." -ForegroundColor Cyan

