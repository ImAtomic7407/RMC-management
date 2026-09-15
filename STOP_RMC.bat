@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo       RMC GLOBAL SYSTEM TERMINATOR (STRIKE)
echo ===================================================

:: 1. Force kill PM2 and its managed processes
echo [Step 1] Terminating PM2 ecosystem...
powershell -ExecutionPolicy Bypass -Command "pm2 delete all; pm2 kill" 2>nul

:: 2. Kill residual specialized workers
echo [Step 2] Cleaning residual binaries...
taskkill /F /IM node.exe /T 2>nul
taskkill /F /IM cloudflared.exe /T 2>nul
taskkill /F /IM python.exe /T 2>nul

:: 3. Port Cleanup (Hard Force)
echo [Step 3] Clearing critical communication ports...

set "PORTS=8080 7070 2020 3000"

for %%P in (%PORTS%) do (
    echo   - Checking port %%P...
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%%P ^| findstr LISTENING') do (
        echo     ! Killing PID %%a holding port %%P
        taskkill /F /PID %%a /T 2>nul
    )
)

echo ===================================================
echo    SUCCESS: All RMC Services have been halted.
echo ===================================================
pause
