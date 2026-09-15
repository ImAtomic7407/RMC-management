@echo off
cd /d "%~dp0"
echo ========================================
echo     RMC MASTER LAUNCHER (PM2)        
echo ========================================
echo Starting Cloudflare Tunnel and Node.js Server...

:: Using PowerShell Bypass because directly calling pm2.ps1 is blocked by system policy
powershell -ExecutionPolicy Bypass -Command "pm2 delete all; pm2 start ecosystem.config.js; pm2 save; pm2 status; pm2 logs --lines 10 --no-daemon"

pause
