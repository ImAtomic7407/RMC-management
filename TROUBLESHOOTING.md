# Troubleshooting

Common issues and quick fixes for RMC Mobile + Examination system.

## Backend

**Port already in use**
- Find: `lsof -i :4200`
- Kill: `kill -9 <PID>`

**Database locked**
- Stop: `pm2 kill`
- Restart: `pm2 start "npm start" --name exam-server`

**Compilation errors**
```bash
cd Examination && rm -rf dist node_modules && npm install && npm run build
```

## Mobile App

**Can't connect to server**
1. Check backend: `curl http://localhost:4200/health`
2. Verify `App.tsx` backend URL
3. Rebuild: `npm run build:apk`

**Images fail to load**
- Root cause: Exam is CLOSED or RESULT_RELEASED
- Only LIVE/SCHEDULED exams serve live-attempt images
- Create a LIVE test exam to verify

**App crashes**
- Run `npm start` and check Expo logs
- Press `d` for device logs

## Exam Data

**Can't log in**: Check user exists in database
**Exam access denied**: Verify exam status is SCHEDULED or LIVE

## Network

**Tunnel degraded**: Restart with `sudo systemctl restart cloudflared`
**503 errors**: Check `pm2 logs exam-server`

## Emergency Recovery

```bash
pm2 kill
cp examination_backup_latest.db Examination/examination.db
pm2 start "npm start" --name exam-server
sudo systemctl start cloudflared
```

See SETUP_LOCAL.md, DEPLOYMENT.md, DATABASE.md for detailed guides.
