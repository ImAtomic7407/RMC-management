# RMC Examination System — Deployment & Build Guide

---

## PART 1 — First-Time Server Setup

Run these steps once on the server machine (the Windows PC running RMC).

### Step 1 — Generate secrets

Open PowerShell and run this twice to get two separate secrets:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy both values. You'll use them as:
- `EXAM_BRIDGE_SECRET` — shared between RMC and exam-server (must match)
- `EXAM_JWT_SECRET` — signs exam JWTs (keep private)

---

### Step 2 — Set environment variables

In the same PowerShell session (or add to your system environment variables permanently):

```powershell
$env:EXAM_BRIDGE_SECRET = "paste-first-value-here"
$env:EXAM_JWT_SECRET    = "paste-second-value-here"
```

To make them permanent (survives reboots), run as Administrator:

```powershell
[System.Environment]::SetEnvironmentVariable("EXAM_BRIDGE_SECRET","paste-first-value-here","Machine")
[System.Environment]::SetEnvironmentVariable("EXAM_JWT_SECRET","paste-second-value-here","Machine")
```

---

### Step 3 — Build the examination backend

```powershell
cd A:\RMC_Local_Installer\Examination\examination-backend

# Install dependencies
npm ci

# Generate Prisma client (includes photo_url column)
npx prisma generate

# Apply all database migrations
npx prisma migrate deploy

# Compile TypeScript
npm run build
```

Expected output: `dist/server.js` created with no errors.

---

### Step 4 — Start everything with PM2

```powershell
cd A:\RMC_Local_Installer\portable_suite\server

# Start all services (rmc-server, exam-server, rmc-tunnel, exam-watchdog, etc.)
pm2 start ecosystem.config.js

# Save process list so it restarts after reboot
pm2 save

# Check everything is running
pm2 status
```

You should see these processes all showing `online`:

| Name           | What it does                                |
|----------------|---------------------------------------------|
| `rmc-server`   | Main RMC app on port 8080                   |
| `exam-server`  | Examination backend on port 4200            |
| `rmc-tunnel`   | Cloudflare tunnel → riteshmathematics.in    |
| `exam-watchdog`| Health monitor, restarts dead services      |
| `rmc-burst-worker` | RMC background jobs                    |

---

### Step 5 — Verify the integration

Test RMC is alive:
```
https://riteshmathematics.in/healthz
```

Test exam backend is proxied correctly:
```
https://riteshmathematics.in/exam/health
```

Both should return `{"status":"ok",...}`.

---

### Step 6 — Sync the student and staff roster (one-time)

Once both servers are up, do an initial sync so existing RMC students appear in the exam DB.
You need an ADMIN exam JWT first — log in as the host/admin teacher:

```
POST https://riteshmathematics.in/exam/api/auth/login/rmc/staff
{ "username": "teacher", "password": "<their RMC password>" }
```

Copy the `access_token` from the response, then:

```
POST https://riteshmathematics.in/exam/api/identity/rmc-sync
Authorization: Bearer <access_token>
```

Response will show how many students and staff were synced. Run this again any time new students join RMC.

---

### Updating exam-server after code changes

```powershell
cd A:\RMC_Local_Installer\Examination\examination-backend
npx prisma generate     # only if schema changed
npx prisma migrate deploy  # only if new migrations
npm run build
pm2 restart exam-server
```

---

## PART 2 — Building the Android APK

### Prerequisites (install once)

- **Android Studio** with JDK 17 (Eclipse Adoptium or Microsoft JDK)
- The build script auto-detects JDK at standard install paths

### Step 1 — Update the server URL in the app

Before building, update `ApiConfig.kt` to point to the live server:

File: `examination-compose-v2\app\src\main\java\com\example\network\ApiConfig.kt`

Change it to:

```kotlin
object ApiConfig {
    private const val PRODUCTION_BASE_URL = "https://riteshmathematics.in/exam/"

    fun defaultBaseUrl(): String = PRODUCTION_BASE_URL
}
```

For dev/local testing you can keep the old logic and just change the `DEVICE_BASE_URL`.

### Step 2 — Build the APK

Double-click `Build_And_Install.ps1` (or right-click → Run with PowerShell).

The script will:
1. Find your JDK automatically
2. Run `gradlew assembleDebug`
3. Save the APK to `apk-output\examination-debug-YYYYMMDD_HHmm.apk`
4. Connect to your phone via ADB WiFi and install it

**First build takes 5–10 minutes** (Gradle downloads dependencies). Subsequent builds are fast.

---

## PART 3 — Installing the APK on a Phone

### Method A — ADB over WiFi (automated, via Build_And_Install.ps1)

1. On the phone: **Settings → Developer Options → Wireless debugging** → Enable
2. Tap "Pair device with pairing code" and note the IP:port shown
3. On the PC, run once:
   ```powershell
   adb pair <IP>:<port>   # enter the 6-digit pairing code shown on phone
   ```
4. Note the IP:port shown under "Wireless debugging" (different from pairing port)
5. Update `$ADB_TARGET` in `Build_And_Install.ps1` to that IP:port
6. Run the script — it builds, connects, installs, and launches in one go

### Method B — Direct APK install (no PC needed)

1. Copy the APK file from `apk-output\` to the phone (WhatsApp, Google Drive, USB, etc.)
2. On the phone: open the APK file
3. If prompted "Install unknown apps" → Allow for your file manager
4. Tap Install

### Method C — USB cable

```powershell
adb devices                     # confirm phone is listed
adb install -r path\to\app.apk  # -r replaces existing install
```

---

## How login works in the app

**Students:**
- Enter their RMC student UID (same UID from their RMC profile/ID card)
- No password needed
- Their photo from their RMC ID card shows automatically

**Teachers / Host:**
- Enter their RMC username and password (same as logging into riteshmathematics.in)
- No separate exam account needed

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `exam-server` shows `errored` in `pm2 status` | Run `pm2 logs exam-server --lines 50` to see the error. Most likely `EXAM_JWT_SECRET` not set |
| `https://riteshmathematics.in/exam/health` returns 502 | exam-server isn't running — `pm2 restart exam-server` |
| Student can't log in — "Student not found" | Run the roster sync (Step 6 above) |
| APK build fails with "JDK not found" | Install Eclipse Adoptium JDK 17 from adoptium.net |
| ADB device shows `offline` | `adb kill-server` then re-run the script |
