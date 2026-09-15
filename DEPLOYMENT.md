# VPS Deployment & Live Hosting

Guide to deploying the Examination backend to a production VPS with Cloudflare Zero Trust tunnel.

## Current Live Setup

- **VPS**: Hetzner (or similar)
- **Domain**: `exam.riteshmathematics.in`
- **Tunnel**: Cloudflare Zero Trust (tunnel ID: `9f516d9a-bff0-4b27-86d1-d995b541a677`)
- **Process Manager**: PM2
- **Database**: SQLite (on VPS)

## Prerequisites

- VPS with SSH access
- Cloudflare account with Zero Trust enabled
- `cloudflared` CLI installed on VPS
- PM2 CLI installed on VPS

## Step 1: SSH into VPS

```bash
ssh root@your-vps-ip
# or if using key file:
ssh -i /path/to/key root@your-vps-ip
```

## Step 2: Install Node.js (if not already installed)

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pm2
```

## Step 3: Upload Backend Code

### Option A: Git clone on VPS (recommended)
```bash
cd /home && git clone https://github.com/ImAtomic7407/RMC-management-2.git
cd RMC-management-2/Examination
npm install
npm run build
```

### Option B: SCP (copy files from local)
```bash
# From your local machine:
scp -r Examination root@your-vps-ip:/home/
```

## Step 4: Set Up Database & Environment

```bash
cd /home/RMC-management-2/Examination  # or /home/Examination

# Copy database from backup (or use existing one)
# If you have a database file locally, SCP it:
# scp examination.db root@your-vps-ip:/home/Examination/

# Create .env (change values as needed)
cat > .env << 'EOF'
DATABASE_URL="file:./examination.db"
PORT=4200
NODE_ENV=production
JWT_SECRET="use-a-strong-random-secret-here"
CORS_ORIGIN="https://exam.riteshmathematics.in"
PUBLIC_API_URL="https://exam.riteshmathematics.in"
LOG_LEVEL="info"
EOF

# Make sure database file exists and is readable
ls -la examination.db
chmod 644 examination.db
```

## Step 5: Start Backend with PM2

```bash
# Start the backend
pm2 start "npm start" --name exam-server

# Save PM2 config so it restarts on reboot
pm2 startup
pm2 save

# View status
pm2 list
pm2 logs exam-server
```

**Verify backend is running**:
```bash
curl http://localhost:4200/health
# Should return: {"status":"ok"}
```

## Step 6: Set Up Cloudflare Zero Trust Tunnel

### 6.1 Install & authenticate cloudflared
```bash
# Install cloudflared
sudo apt-get install -y cloudflare-warp-cli

# Or download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# Authenticate
cloudflared login
# Follow the browser prompt to authorize with Cloudflare
```

### 6.2 Create tunnel config
```bash
mkdir -p /etc/cloudflared
cat > /etc/cloudflared/config.yml << 'EOF'
tunnel: 9f516d9a-bff0-4b27-86d1-d995b541a677
credentials-file: /etc/cloudflared/9f516d9a-bff0-4b27-86d1-d995b541a677.json

ingress:
  - hostname: exam.riteshmathematics.in
    service: http://localhost:4200
  - service: http_status:404
EOF
```

### 6.3 Run tunnel as service
```bash
# Install as systemd service
sudo cloudflared service install

# Start service
sudo systemctl start cloudflared
sudo systemctl enable cloudflared

# Check status
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -f
```

### 6.4 Verify tunnel works
```bash
curl https://exam.riteshmathematics.in/health
# Should return: {"status":"ok"}
```

## Step 7: Mobile App Configuration

Update `rmc-mobile/App.tsx`:
```typescript
const EXAM_SERVER_URL_OVERRIDE: string = 'https://exam.riteshmathematics.in';
```

Rebuild and deploy APK/AAB to Play Store.

## Monitoring & Logs

### Backend logs
```bash
pm2 logs exam-server          # Real-time
pm2 logs exam-server -0 100   # Last 100 lines
```

### Tunnel logs
```bash
sudo journalctl -u cloudflared -f
```

### Database health
```bash
# Connect to VPS and check DB
sqlite3 /home/Examination/examination.db ".tables"
```

## Updating Production Backend

When you push changes:

```bash
# SSH into VPS
ssh root@your-vps-ip

# Pull latest code
cd /home/RMC-management-2/Examination
git pull origin main

# Rebuild
npm run build

# Restart service
pm2 restart exam-server
pm2 logs exam-server

# Verify
curl https://exam.riteshmathematics.in/health
```

## Backup Strategy

### Backup database to local machine
```bash
# From your local machine:
scp root@your-vps-ip:/home/Examination/examination.db ./exam_backup_$(date +%s).db
```

### Restore database if needed
```bash
# Copy backup back to VPS:
scp ./exam_backup_TIMESTAMP.db root@your-vps-ip:/home/Examination/examination.db

# Restart backend
ssh root@your-vps-ip "pm2 restart exam-server"
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Tunnel shows "degraded" | Check `systemctl status cloudflared`, restart if needed |
| Backend returns 502/503 | `pm2 logs exam-server` to check errors, restart: `pm2 restart exam-server` |
| Can't connect via HTTPS | Verify DNS record points to Cloudflare, tunnel credentials are valid |
| Database locks up | Kill zombie processes: `pm2 kill`, wait 30s, restart: `pm2 start "npm start" --name exam-server` |

---

For local development, see `SETUP_LOCAL.md`
For Play Store publishing, see `PLAY_STORE.md`
