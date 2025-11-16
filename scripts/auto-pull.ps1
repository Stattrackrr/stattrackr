# Auto-pull script for VS Code
# This script automatically pulls the latest changes from GitHub
# Run this periodically or set it up as a scheduled task

$ErrorActionPreference = "Continue"

Write-Host "Checking for updates from GitHub..." -ForegroundColor Cyan

# Get the repository root directory
$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) {
    Write-Host "[!] Not in a git repository!" -ForegroundColor Red
    exit 1
}

# Change to repo root
Set-Location $repoRoot

# Fetch latest changes (doesn't modify working directory)
Write-Host "Fetching latest changes..." -ForegroundColor Cyan
git fetch origin master 2>&1 | Out-Null

# Check if there are updates
$localCommit = git rev-parse HEAD
$remoteCommit = git rev-parse origin/master

if ($localCommit -eq $remoteCommit) {
    Write-Host "Already up to date" -ForegroundColor Green
    exit 0
}

Write-Host "New changes detected" -ForegroundColor Yellow
Write-Host ("    Local:  {0}" -f $localCommit.Substring(0, 7)) -ForegroundColor Gray
Write-Host ("    Remote: {0}" -f $remoteCommit.Substring(0, 7)) -ForegroundColor Gray

# Check if there are uncommitted changes
$status = git status --porcelain
if ($status) {
    Write-Host "You have uncommitted changes. Stashing..." -ForegroundColor Yellow
    git stash push -m "Auto-stash before pull $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" 2>&1 | Out-Null
    $stashed = $true
} else {
    $stashed = $false
}

# Pull the changes
Write-Host "Pulling latest changes..." -ForegroundColor Cyan
try {
    $pullOutput = git pull --rebase origin master 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Successfully pulled latest changes" -ForegroundColor Green
        
        # Show what changed
        $commitCount = (git rev-list --count HEAD..origin/master 2>$null)
        if ($commitCount -gt 0) {
            Write-Host "New commits:" -ForegroundColor Cyan
            git log --oneline HEAD~$commitCount..HEAD 2>&1 | ForEach-Object {
                Write-Host "    $_" -ForegroundColor Gray
            }
        }
        
        # Restore stashed changes if any
        if ($stashed) {
            Write-Host "Restoring your uncommitted changes..." -ForegroundColor Cyan
            git stash pop 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-Host "Warning: Some conflicts may have occurred when restoring stashed changes" -ForegroundColor Yellow
            }
        }
        
        Write-Host ""
        Write-Host "Ready to edit! Check VS Code for the latest game data." -ForegroundColor Green
    } else {
        Write-Host "Pull failed:" -ForegroundColor Red
        $pullOutput | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        
        # Restore stash if pull failed
        if ($stashed) {
            Write-Host "Restoring stashed changes..." -ForegroundColor Cyan
            git stash pop 2>&1 | Out-Null
        }
        exit 1
    }
} catch {
    $msg = $_.Exception.Message
    Write-Host ("Error during pull: {0}" -f $msg) -ForegroundColor Red
    if ($stashed) {
        git stash pop 2>&1 | Out-Null
    }
    exit 1
}

