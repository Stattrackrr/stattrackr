@echo off
REM Windows batch script for cache refresh operations

set CACHE_REFRESH_TOKEN=4c121f5b8cca78b7819a3ccbee697b801071b29eba11f7ec2d3d2a2406881847

echo.
echo ================================================
echo   NBA Stats Dashboard - Cache Refresh Utility
echo ================================================
echo.

if "%1"=="help" (
    echo Usage:
    echo   cache-refresh.bat [command]
    echo.
    echo Commands:
    echo   help      - Show this help message
    echo   dry-run   - Show what would be refreshed
    echo   refresh   - Refresh all caches
    echo   player    - Refresh only player stats
    echo   health    - Check if server is running
    echo.
    goto :end
)


if "%1"=="dry-run" (
    echo Running dry-run...
    node scripts/cache-refresh.js --dry-run
    goto :end
)

if "%1"=="refresh" (
    echo Refreshing all caches...
    node scripts/cache-refresh.js
    goto :end
)

if "%1"=="player" (
    echo Refreshing player stats...
    node scripts/cache-refresh.js --job player_stats
    goto :end
)

if "%1"=="health" (
    echo Checking if server is running...
    echo Note: Start your dev server first (npm run dev)
    echo.
    powershell -Command "try { Invoke-WebRequest -Uri 'http://localhost:3000/' -UseBasicParsing -TimeoutSec 5 | Out-Null; Write-Host 'Server is running.' -ForegroundColor Green } catch { Write-Host 'Error: Could not connect to server. Make sure it is running.' -ForegroundColor Red }"
    goto :end
)

if "%1"=="" (
    echo No command specified. Available commands:
    echo.
    echo   cache-refresh.bat dry-run   - Show what would be refreshed
    echo   cache-refresh.bat refresh   - Refresh all caches
    echo   cache-refresh.bat player    - Refresh only player stats
    echo   cache-refresh.bat health    - Check if server is running
    echo   cache-refresh.bat help      - Show detailed help
    echo.
    goto :end
)

echo Unknown command: %1
echo Use "cache-refresh.bat help" for available commands.

:end
