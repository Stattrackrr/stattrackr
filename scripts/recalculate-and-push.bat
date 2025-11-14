@echo off
REM Script to recalculate buckets and push to GitHub
REM Usage: scripts\recalculate-and-push.bat [TEAM|ALL]

set TEAM=%1
if "%TEAM%"=="" set TEAM=ALL

echo.
echo Recalculating buckets...

if "%TEAM%"=="ALL" (
    node scripts/recalculate-buckets.js ALL
) else (
    node scripts/recalculate-buckets.js %TEAM%
)

if errorlevel 1 (
    echo Recalculation failed!
    exit /b 1
)

echo.
echo Checking for changes...

git status --short | findstr /C:"data/dvp_store/" >nul
if errorlevel 1 (
    echo No changes detected in dvp_store files.
    echo Buckets may already be up to date.
    exit /b 0
)

echo Found changes.
echo.
echo Staging changes...
git add data/dvp_store/2025/

echo Committing changes...
set COMMIT_MSG=Recalculate buckets
if not "%TEAM%"=="ALL" set COMMIT_MSG=Recalculate buckets for %TEAM%
git commit -m "%COMMIT_MSG%"

if errorlevel 1 (
    echo Commit failed!
    exit /b 1
)

echo Pushing to GitHub...
git push

if errorlevel 1 (
    echo Push failed!
    exit /b 1
)

echo.
echo Success! Buckets recalculated and pushed to GitHub.
echo Vercel will deploy automatically. Stats will update after deployment.
echo.

