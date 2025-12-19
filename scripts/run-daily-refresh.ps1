# PowerShell script to run daily player cache refresh
# Designed to be run as a Windows Scheduled Task
#
# Usage:
#   .\scripts\run-daily-refresh.ps1
#
# This script:
#   1. Checks if the dev server is running
#   2. Starts it if needed (or waits for it)
#   3. Calls the refresh endpoint
#   4. Logs results to a file

$ErrorActionPreference = "Stop"

# Configuration
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$logDir = Join-Path $projectRoot "logs"
$logFile = Join-Path $logDir "refresh-$(Get-Date -Format 'yyyy-MM-dd').log"
$apiUrl = "http://localhost:3000/api/cron/refresh-all-player-caches"
$maxWaitTime = 300 # 5 minutes max wait for server to start

# Ensure log directory exists
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    Write-Host $logMessage
    Add-Content -Path $logFile -Value $logMessage
}

function Test-ServerRunning {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000/api/cache/health" -Method Get -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Start-DevServer {
    Write-Log "Starting dev server..."
    
    # Check if node_modules exists
    $nodeModules = Join-Path $projectRoot "node_modules"
    if (-not (Test-Path $nodeModules)) {
        Write-Log "node_modules not found. Run 'npm install' first." "ERROR"
        exit 1
    }
    
    # Start dev server in background
    $process = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
    
    Write-Log "Dev server starting (PID: $($process.Id))..."
    
    # Wait for server to be ready
    $waited = 0
    while (-not (Test-ServerRunning) -and $waited -lt $maxWaitTime) {
        Start-Sleep -Seconds 5
        $waited += 5
        Write-Log "Waiting for server to start... ($waited/$maxWaitTime seconds)"
    }
    
    if (-not (Test-ServerRunning)) {
        Write-Log "Server failed to start within $maxWaitTime seconds" "ERROR"
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        exit 1
    }
    
    Write-Log "Server is ready!"
    return $process
}

function Stop-DevServer {
    param([System.Diagnostics.Process]$Process)
    
    if ($Process -and -not $Process.HasExited) {
        Write-Log "Stopping dev server (PID: $($Process.Id))..."
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        Write-Log "Dev server stopped"
    }
}

# Main execution
Write-Log "========================================"
Write-Log "Daily Player Cache Refresh"
Write-Log "========================================"
Write-Log ""

$serverProcess = $null
$serverWasRunning = Test-ServerRunning

if (-not $serverWasRunning) {
    Write-Log "Dev server is not running. Starting it..."
    $serverProcess = Start-DevServer
} else {
    Write-Log "Dev server is already running"
}

try {
    Write-Log "Calling refresh endpoint: $apiUrl"
    Write-Log ""
    
    $response = Invoke-RestMethod -Uri $apiUrl -Method Get -TimeoutSec 2700 -ErrorAction Stop # 45 min timeout
    
    Write-Log "✅ Refresh completed successfully!"
    Write-Log ""
    Write-Log "Results:"
    Write-Log "  Total Players: $($response.results.totalPlayers)"
    Write-Log "  Shot Charts: $($response.results.shotCharts.success) success, $($response.results.shotCharts.failed) failed"
    Write-Log "  Play Types: $($response.results.playTypes.success) success, $($response.results.playTypes.failed) failed"
    Write-Log "  Duration: $($response.duration)"
    Write-Log ""
    Write-Log "========================================"
    Write-Log "Refresh completed successfully"
    Write-Log "========================================"
    
    exit 0
} catch {
    Write-Log "❌ Error: $($_.Exception.Message)" "ERROR"
    
    if ($_.Exception.Response) {
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $responseBody = $reader.ReadToEnd()
            $reader.Close()
            $stream.Close()
            Write-Log "Response: $responseBody" "ERROR"
        } catch {
            Write-Log "Could not read response body" "WARN"
        }
    }
    
    Write-Log ""
    Write-Log "========================================"
    Write-Log "Refresh failed"
    Write-Log "========================================"
    
    exit 1
} finally {
    # Only stop server if we started it
    if (-not $serverWasRunning -and $serverProcess) {
        Stop-DevServer -Process $serverProcess
    }
}

