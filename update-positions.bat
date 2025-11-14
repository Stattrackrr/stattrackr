@echo off
REM Helper script to quickly commit and push player position updates
REM Usage: update-positions.bat [commit message]

set MESSAGE=%1
if "%MESSAGE%"=="" set MESSAGE=Update player positions

echo.
echo Checking for position file changes...

git status --short | findstr /C:"data/player_positions/" >nul
if errorlevel 1 (
    echo No changes detected in position files.
    echo Make sure you've saved your changes in VS Code first!
    exit /b 0
)

echo Found changes in position files.
echo.
echo Staging position files...
git add data/player_positions/

echo Committing changes...
git commit -m "%MESSAGE%"
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
echo Success! Position updates pushed to GitHub.
echo Vercel will deploy automatically. DVP stats will update after deployment.
echo.

