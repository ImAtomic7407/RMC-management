@echo off
echo Starting Cloudflare Tunnel for login.riteshmatics.in...
.\cloudflared.exe --config config_rmc.yml tunnel run rmc_attendance
pause
