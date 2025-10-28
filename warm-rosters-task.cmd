@echo off
setlocal
cd /d C:\Users\nduar\stattrackr
set "LOG=C:\Users\nduar\stattrackr\warm-rosters.log"
echo [%DATE% %TIME%] warm-rosters start >> "%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\nduar\stattrackr\warm-rosters-task.ps1" >> "%LOG%" 2>&1
echo [%DATE% %TIME%] warm-rosters end (exit %errorlevel%) >> "%LOG%"
