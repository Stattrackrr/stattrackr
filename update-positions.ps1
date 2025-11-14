# Helper script to quickly commit and push player position updates
# Usage: .\update-positions.ps1 [commit message]

param(
    [string]$Message = "Update player positions"
)

Write-Host "🔄 Checking for position file changes..." -ForegroundColor Cyan

# Check if there are any changes to position files
$positionFiles = git status --short | Select-String -Pattern "data/player_positions/"

if (-not $positionFiles) {
    Write-Host "❌ No changes detected in position files." -ForegroundColor Yellow
    Write-Host "💡 Make sure you've saved your changes in VS Code first!" -ForegroundColor Yellow
    exit 0
}

Write-Host "✅ Found changes in position files:" -ForegroundColor Green
$positionFiles | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }

# Stage position files
Write-Host "`n📦 Staging position files..." -ForegroundColor Cyan
git add data/player_positions/

# Commit
Write-Host "💾 Committing changes..." -ForegroundColor Cyan
git commit -m $Message

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Commit failed!" -ForegroundColor Red
    exit 1
}

# Push
Write-Host "🚀 Pushing to GitHub..." -ForegroundColor Cyan
git push

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Push failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`n✅ Success! Position updates pushed to GitHub." -ForegroundColor Green
Write-Host "⏳ Vercel will deploy automatically. DVP stats will update after deployment." -ForegroundColor Cyan

