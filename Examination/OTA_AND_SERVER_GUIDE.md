# RMC Examination System — Developer & OTA Guide
This document serves as a handoff and reference guide for any developer/AI working on the RMC Examination project. It clarifies how components are entangled, where files are located, how the OTA patch system works, and common system pitfalls.

---

## 📂 Server Architecture & File Locations

The system consists of two primary server applications running together under PM2 in the local installer environment:

### 1. RMC Main Portal
* **Source Location**: `A:\RMC_Local_Installer\portable_suite\server`
* **Process Name**: `rmc-server`
* **Database**: `A:\RMC_Local_Installer\portable_suite\server\rmc_pro_database.db` (SQLite)
* **Configuration**: `.env` (inside the server directory)

### 2. Examination Backend
* **Source Location**: `A:\RMC_Local_Installer\Examination\examination-backend`
* **Process Name**: `exam-server`
* **Database**: `A:\RMC_Local_Installer\Examination\examination-backend\prisma\dev.db` (SQLite)
* **Configuration**: `.env` (inside the backend directory)
* **TypeScript Entry**: `src/server.ts`
* **Compiled JS Entry**: `dist/server.js`

### 3. Server Logs
* **PM2 Logs**: Located in `C:\Users\sunny\.pm2\logs\`
  * `exam-server-out-X.log` / `exam-server-error-X.log` (stdout/stderr for exam backend)
  * `rmc-server-out-X.log` / `rmc-server-error-X.log` (stdout/stderr for RMC portal)
  * `exam-proxy-out-X.log` (HTTP/WebSocket proxy logs)

---

## 🔌 Port Mapping & Networking

The servers listen on these specific ports:

| Service | Port | Bound IP | Description |
| :--- | :---: | :---: | :--- |
| **RMC Main Portal** | `8080` | `::` | Main user portal web interface and local API. |
| **Exam Backend** | `4200` | `127.0.0.1` | Examination system core API (internal loopback only). |
| **Exam Proxy** | `8082` | `0.0.0.0` | **Public gateway for exam clients**. Proxies `/exam/*` and WS connections to port `4200`. |
| **n8n Workflow** | `5678` | `::` | Workflow automation server. |
| **Smart Scaler** | `7070` | `0.0.0.0` | Adapts system performance profile based on connections. |

---

## 📲 OTA Update & Differential Patch System

The Android client (`examination-compose-v2`) supports incremental updates using binary delta patches. If a patch fails, it throws a `SHA mismatch` or falls back to downloading the full APK.

### Key File Paths
* **Uploaded baseline APKs**: `A:\RMC_Local_Installer\Examination\examination-backend\uploads\apk\`
  * Filenames are formatted as: `rmc-exam-v1.5.[version].apk`
* **Differential Patches**: `A:\RMC_Local_Installer\Examination\examination-backend\uploads\patches\`
  * Filenames are formatted as: `v[from_version]_to_v[to_version].patch.gz`
* **Patch Generator Script**: `A:\RMC_Local_Installer\Examination\examination-backend\scripts\generate_patch.py` (pure Python bsdiff wrapper).

### How to Generate a Patch
Run the patch generator script passing the old APK, new APK, and output compressed patch target:
```powershell
python A:\RMC_Local_Installer\Examination\examination-backend\scripts\generate_patch.py <old_apk_path> <new_apk_path> <compressed_patch_output_path>
```
**Example**:
```powershell
python A:\RMC_Local_Installer\Examination\examination-backend\scripts\generate_patch.py A:\RMC_Local_Installer\Examination\examination-backend\uploads\apk\rmc-exam-v1.5.13.apk A:\RMC_Local_Installer\Examination\examination-backend\uploads\apk\rmc-exam-v1.5.14.apk A:\RMC_Local_Installer\Examination\examination-backend\uploads\patches\v29_to_v30.patch.gz
```
The script will output a `METADATA_JSON` line containing:
* `from_size`: Size of original APK.
* `to_size`: Size of target APK.
* `patch_size`: Size of compressed `.patch.gz` file on disk.
* `raw_patch_sha256`: **Uncompressed raw patch SHA-256 hash** (crucial for client reconstruction verification).
* `new_apk_sha256`: SHA-256 hash of target APK.

### Database Registration
Ensure both releases and patches are correctly registered in the database `dev.db`:

#### `apk_releases` Table:
* **`version_code`**: Integer version (e.g., `29`, `30`).
* **`file_size`**: Size of the full APK on disk (must match actual byte length exactly).
* **`sha256`**: SHA-256 hash of the full APK (crucial for verification).
* **`apk_path`**: Relative path, e.g., `uploads/apk/rmc-exam-v1.5.13.apk`.
* **`mandatory`**: Set to `1` (true) to force update prompts on client startup.

#### `apk_patches` Table:
* **`from_version_code`**: Old version (e.g., `29`).
* **`to_version_code`**: New version (e.g., `30`).
* **`patch_path`**: Relative path, e.g., `uploads/patches/v29_to_v30.patch.gz`.
* **`patch_size`**: Size of the compressed `.patch.gz` file.
* **`full_apk_size`**: Size of the target APK.
* **`sha256`**: **The raw (decompressed) patch SHA-256** (`raw_patch_sha256` output by the generator script).

> [!WARNING]
> **Common OTA Mismatch Pitfall**: If a version was published with an APK baseline file whose size/hash doesn't match the actual build installed on devices, the delta generation will build a patch that fails client-side verification. You must overwrite the baseline file in `uploads/apk/`, update the release row in the database, regenerate the patch, and update the patch metadata in the database.

---

## 🕸️ Entanglements & Troubleshooting

### 1. PM2 EPERM Access Denied
If the PM2 daemon was started by a command prompt with elevated (Administrator) privileges, executing commands like `pm2 list` or `pm2 restart` from a non-elevated prompt will fail with `connect EPERM //./pipe/rpc.sock` or `Access is denied` errors.
* **Fix**: Use the **Server Manager Dashboard** (`A:\RMC_Local_Installer\SERVER_MANAGER.bat`) to manage/restart processes as it handles process controls, or run commands from an elevated command prompt.
* **Fallback Restart**: You can find the PID of the node process listening on port `4200` using `netstat -aon | findstr :4200` and kill it. PM2's watchdog will automatically respawn a fresh process with the updated JS code.

### 2. The 409 Conflict Manual Entry Bug
If a student starts an exam and their session is terminated, or they get logged out/auto-submitted, their attempt in the database becomes terminal (`SUBMITTED`, `AUTO_SUBMITTED`, `EXPIRED`).
* **Symptom**: When trying to log back in manually, the API `/exams/:examId/start` checks the existing attempt, sees the terminal status, and throws a `409 Conflict` (`ATTEMPT_ALREADY_SUBMITTED`).
* **Code-Level Fix**: There is an auto-reopening logic built in `src/modules/student/service.ts`. If the student's gate session `verified_at` timestamp (when the teacher verified their QR scan) is **newer** than the attempt's `updated_at` time, the backend transitions the attempt status back to `IN_PROGRESS`, clears `submitted_at`, and re-allows access.
* **Immediate DB Recovery**: To manually reopen a student's attempt immediately during an exam:
  ```sql
  UPDATE exam_attempts
  SET status = 'IN_PROGRESS', submitted_at = null, is_auto_submitted = 0, updated_at = CURRENT_TIMESTAMP
  WHERE exam_id = [EXAM_ID] AND student_id = [STUDENT_ID];
  ```

### 3. Roster & Batch Synchronization
Batches and students are kept synchronized between RMC and the Exam System using three mechanisms:
* **Student Logins (Instant)**: Whenever a student logs in on a mobile device (`/login/rmc/student`), the server queries RMC to verify credentials and dynamically invokes `importStudentRecord` to update the student's local profile and batch memberships.
* **Background Sync Scheduler (Every 5 minutes)**: The scheduler in `src/shared/exam-scheduler.ts` runs a background RMC roster sync task every 5 minutes. Any new students added to batches in RMC will automatically have their profiles and batch memberships synchronized to the exam database without manual intervention.
* **Manual Sync**: Admins can trigger a full sync on demand via the admin panel dashboard or by calling the `POST /api/identity/rmc-sync` endpoint.
