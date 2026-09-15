@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================================
echo   Rebuilding examination-backend
echo   (regenerates dist\ from the TypeScript source in src\)
echo ============================================================
echo.

rem Prefer the bundled portable Node runtime; fall back to Node on PATH.
set "NODE_EXE=node"
set "BUNDLED=%~dp0..\..\runtime\node\node.exe"
if exist "%BUNDLED%" set "NODE_EXE=%BUNDLED%"

echo Using Node: %NODE_EXE%
"%NODE_EXE%" -v
echo.

if not exist "node_modules\typescript\bin\tsc" (
  echo TypeScript not found in node_modules -- installing dev dependencies first...
  "%NODE_EXE%" "node_modules\npm\bin\npm-cli.js" install
)

echo Compiling TypeScript -> dist ...
"%NODE_EXE%" "node_modules\typescript\bin\tsc" -p tsconfig.json
if errorlevel 1 (
  echo.
  echo [ERROR] Build FAILED. Nothing was started. See the messages above.
  echo.
  pause
  exit /b 1
)

echo.
echo [OK] Build succeeded. dist\ has been regenerated, including the
echo      body-timeout / keep-alive fix in dist\server.js.
echo.
echo You can now start RMC normally (Start_RMC_All.ps1 or START_RMC.bat).
echo If the exam-server was already running under PM2, restart it:
echo      pm2 restart exam-server --update-env
echo.
pause
