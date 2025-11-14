# Helper script to quickly commit and push player position updates
# Usage: .\update-positions.ps1 [commit message]

param(
    [string]$Message = "Update player positions"
)

Write-Host "[*] Checking for position file changes..." -ForegroundColor Cyan

# Check if there are any changes to position files (both modified and untracked)
$allChanges = git status --short
$positionFiles = $allChanges | Select-String -Pattern "data/player_positions/"

# Also check for untracked files in the directory
$untrackedFiles = git ls-files --others --exclude-standard data/player_positions/

if (-not $positionFiles -and -not $untrackedFiles) {
    Write-Host "[!] No changes detected in position files." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "[*] Troubleshooting:" -ForegroundColor Cyan
    Write-Host "   1. Make sure you saved the file in VS Code (Ctrl+S)" -ForegroundColor Gray
    Write-Host "   2. Check if VS Code shows unsaved changes (white dot on file tab)" -ForegroundColor Gray
    Write-Host "   3. Try closing and reopening the file in VS Code" -ForegroundColor Gray
    Write-Host ""
    Write-Host "[*] Current git status:" -ForegroundColor Cyan
    $status = git status --short data/player_positions/ 2>&1
    if ($status) {
        $status | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }
    } else {
        Write-Host "   (no changes)" -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "[*] Files in data/player_positions/:" -ForegroundColor Cyan
    if (Test-Path "data/player_positions") {
        Get-ChildItem -Path "data/player_positions" -Recurse -File | ForEach-Object { 
            $relPath = $_.FullName.Replace((Get-Location).Path + '\', '').Replace('\', '/')
            $gitStatus = git status --short $relPath 2>&1
            if ($gitStatus) {
                Write-Host "   $relPath $gitStatus" -ForegroundColor Yellow
            } else {
                Write-Host "   $relPath (no changes)" -ForegroundColor DarkGray
            }
        }
    }
    Write-Host ""
    Write-Host "[*] Tip: If you made changes, save the file (Ctrl+S) and run this script again." -ForegroundColor Yellow
    exit 0
}

Write-Host "[+] Found changes in position files:" -ForegroundColor Green
if ($positionFiles) {
    $positionFiles | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }
}
if ($untrackedFiles) {
    $untrackedFiles | ForEach-Object { Write-Host "   [NEW] $_" -ForegroundColor Green }
}

# Stage position files
Write-Host "`n[*] Staging position files..." -ForegroundColor Cyan
git add data/player_positions/
if ($untrackedFiles) {
    # Also add untracked files
    $untrackedFiles | ForEach-Object { git add $_ }
}

# Commit
Write-Host "[*] Committing changes..." -ForegroundColor Cyan
git commit -m $Message

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

Write-Host "`n[+] Success! Position updates pushed to GitHub." -ForegroundColor Green
Write-Host "[*] Vercel will deploy automatically. DVP stats will update after deployment." -ForegroundColor Cyan

