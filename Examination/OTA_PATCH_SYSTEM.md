# RMC Examination App — OTA Update & Binary Patch System

> **Written for AI assistants** who need to maintain, debug, or extend this system without prior context.
> Last updated: 2026-06-10.

---

## 1. What This System Does

The RMC Examination Android app can update itself over-the-air without the Play Store.
Instead of downloading a full new APK (~44 MB each time), the backend computes a
**binary differential patch** between the old APK and the new one, compresses it with
GZIP, and serves only that delta (~1–2 MB typical). The Android app downloads the patch,
applies it against the currently-installed APK, and installs the result.

**Bandwidth savings: ~97% per update** (verified with real APKs: 1.16 MB patch vs 44.8 MB full APK).

---

## 2. System Architecture — Bird's Eye View

```
Developer machine
  └─ builds new APK (Android Studio / Gradle)
  └─ copies APK to server  →  examination-backend/uploads/releases/

Server (exam-server PM2 process)
  └─ POST /api/app/publish  (ADMIN token)
       ├─ writes row to apk_releases table
       └─ spawns background Python job:
            generate_patch.py  old.apk  new.apk  →  uploads/patches/v2_to_v3.patch.gz
            writes row to apk_patches table

Android app (on student/teacher device)
  └─ GET /api/app/update-info?version_code=N
       └─ returns strategy: PATCH_CHAIN or FULL_APK
  └─ downloads patch(es) → decompresses → BsPatch.kt applies → installs new APK
```

---

## 3. Key Files — Where Everything Lives

| File | Purpose |
|------|---------|
| `examination-backend/scripts/generate_patch.py` | Generates BSDIFF43 patches between two APKs |
| `examination-backend/src/modules/app-update/release.service.ts` | Registers releases, triggers patch gen, computes best update path |
| `examination-backend/src/modules/app-update/router.ts` | REST endpoints: `/api/app/update-info`, `/api/app/publish`, `/api/app/patches/:file` |
| `examination-compose-v2/app/src/main/java/com/example/updater/BsPatch.kt` | Kotlin patch applier (pure Java/Kotlin, no native deps) |
| `examination-compose-v2/.../data/repository/AppUpdateRepository.kt` | Android: downloads, decompresses, applies patch, verifies SHA-256 |
| `examination-compose-v2/.../viewmodel/AppUpdateViewModel.kt` | Android: drives update UI state |
| `examination-backend/prisma/schema.prisma` | DB models: `apk_releases`, `apk_patches` |
| `examination-backend/uploads/releases/` | Stored APK files on server |
| `examination-backend/uploads/patches/` | Generated compressed patch files |

---

## 4. Database Schema

### `apk_releases`
```prisma
model apk_releases {
  version_code    Int      @unique    // integer: 1, 2, 3, ...
  version_name    String              // e.g. "1.2.0"
  apk_path        String              // "uploads/releases/examination-v3.apk"
  file_size       Int                 // bytes of the full APK
  sha256          String              // SHA-256 of the full APK
  release_notes   String   @default("[]")  // JSON array of strings
  mandatory       Boolean  @default(false)
  published_at    DateTime @default(now())
  ...
}
```

### `apk_patches`
```prisma
model apk_patches {
  from_version_code   Int    // source version (old APK)
  to_version_code     Int    // target version (new APK)
  patch_path          String // "uploads/patches/v2_to_v3.patch.gz"
  patch_size          Int    // bytes of the COMPRESSED patch
  full_apk_size       Int    // bytes of the full new APK (for threshold check)
  sha256              String // SHA-256 of the DECOMPRESSED (raw) patch
  @@unique([from_version_code, to_version_code])
}
```

> **Important SHA-256 note:** `apk_patches.sha256` is the hash of the **raw uncompressed
> patch**, not the .gz file. `apk_releases.sha256` is the hash of the **full APK file**.
> The Android client verifies the reconstructed APK against `apk_releases.sha256`.

---

## 5. Patch File Format (BSDIFF43 / ENDSLEY variant)

The generator produces a raw binary file in this exact layout (before GZIP compression):

```
Offset  Size   Description
------  ----   -----------
0       16     ASCII magic: "ENDSLEY/BSDIFF43"
16      8      New file size, signed 64-bit LE (see integer encoding below)
24+     ...    Repeating control records until new_size bytes reconstructed
```

Each **control record** is 24 bytes (three signed 64-bit LE integers) followed by data:

```
control[0]  diff_len    — number of bytes reconstructed as: new[j] = old[oi] + addend
control[1]  copy_len    — number of verbatim bytes copied straight from the patch stream
control[2]  old_jump    — SIGNED offset added to old cursor AFTER the diff (not before)
data:       diff_len bytes of addends (may all be 0 for matched regions)
            copy_len bytes of verbatim new content (literal gap bytes)
```

**Reconstruction algorithm:**
```
j = 0          # position in new file being written
oi = 0         # position in old file being read

for each control record (diff_len, copy_len, old_jump):
    for k in 0..diff_len-1:
        new[j+k] = (old[oi+k] + addend[k]) & 0xFF
    j += diff_len
    oi += diff_len

    new[j .. j+copy_len] = patch_verbatim_stream[copy_len]
    j += copy_len

    oi += old_jump    # ← jump happens AFTER the diff, not before
```

### Integer encoding

All integers use a **signed-magnitude little-endian** format (not two's complement):
- Bit 63 is the sign bit.
- Bits 0–62 are the magnitude.
- "Negative zero" (`0x8000000000000000`) is illegal and will throw in BsPatch.kt.

Python encoder:
```python
def write_bsdiff_long(value: int) -> bytes:
    if value < 0:
        val = ((-value) & 0x7FFFFFFFFFFFFFFF) | (1 << 63)
    else:
        val = value & 0x7FFFFFFFFFFFFFFF
    return struct.pack("<Q", val)
```

---

## 6. Patch Generator (`generate_patch.py`) — How It Works

### Usage
```bash
python generate_patch.py <old_apk> <new_apk> <output.patch.gz>
```

The script writes a GZIP-compressed patch and prints a `METADATA_JSON=` line to stdout
that the backend parses to extract sha256, sizes, etc.

### Algorithm

**Phase 1 — Build index of old APK:**
```
For every 8th byte position i in old_bytes:
    key = uint32 at old_bytes[i..i+4]   # struct.unpack_from('<I', old, i)
    Store key → [position, ...]          # up to 3 positions per key
```
Memory: ~5.5 M entries for a 44 MB APK → ~300–400 MB RAM.
Speed: very fast (struct.unpack_from reads 4 bytes with zero heap allocation).

**Phase 2 — Scan new APK for matches:**
```
j = 0   # cursor in new
old_offset = 0

while j < len(new):
    # Scan forward byte-by-byte in new for a 4-byte key that hits the index
    match_j = j, match_old = ?, match_len = 0
    while match_j < len(new)-4:
        key = uint32 at new[match_j]
        if key in old_index:
            for each candidate position in old_index[key]:
                length = extend_match(old, new, candidate, match_j)
                if length > match_len:
                    match_len, match_old = length, candidate
            if match_len >= 32:   # MIN_MATCH
                break
        match_j += 1

    if match_len < 32:
        emit terminal copy record for remaining new[j:]
        break

    # Emit gap/seek record if needed
    if match_j > j  OR  match_old != old_offset:
        emit (diff=0, copy=match_j-j, jump=match_old-old_offset)
        copy verbatim new[j..match_j] into patch
        old_offset = match_old

    # Emit diff record (addends are ~all-zero since match_old was aligned)
    emit (diff=match_len, copy=0, jump=0)
    addends = [(new[match_j+k] - old[match_old+k]) & 0xFF for k in range(match_len)]
    old_offset = match_old + match_len
    j = match_j + match_len
```

### Critical design rule: always seek before diff

**The `old_jump` field repositions the old cursor AFTER the diff, not before.**
This means the diff block always consumes from `old[old_offset]`, NOT from `old[match_old]`.

If `match_old != old_offset` at the time of writing a diff block, you MUST emit a
preceding gap/seek record (even with zero gap bytes) to move `old_offset = match_old`
before the diff. Failing to do this silently corrupts the patch: addends computed from
`old[match_old]` get applied at `old[old_offset]` → wrong bytes → reconstruction fails.

The generator always satisfies this invariant:
```python
if match_j > j or match_old != old_offset:   # <── note: OR, not just gap check
    emit gap+seek record
    old_offset = match_old
# Now old_offset == match_old guaranteed
emit diff record with old_jump=0
```

### Constants (tunable)
```python
INDEX_STEP = 8      # Index every Nth byte of old. Lower = better coverage but more RAM.
                    # 8 → ~440 MB RAM for 44 MB APK. Use 4 for ~880 MB / better quality.
MIN_MATCH  = 32     # Minimum match length worth encoding as a diff block.
MAX_EXTEND = 3      # Number of candidates to try per key (handles hash collisions).
```

---

## 7. Release Publishing — Step by Step

### Step 1: Build the APK

In Android Studio or command line:
```bash
cd examination-compose-v2
./gradlew assembleDebug     # or assembleRelease
```

The APK lands in `app/build/outputs/apk/debug/` or `app/build/outputs/apk/release/`.

**Signing:** Both debug and release builds use the committed keystore
`app/rmc-exam-release.jks` (alias `rmcexam`, password `rmcexam2024`). This ensures all
builds are signed with the same key regardless of machine, so Android allows upgrading
existing installs without an uninstall/reinstall cycle.

**Version code:** In `app/build.gradle.kts`:
```kotlin
versionCode = 3        // increment this integer for every release
versionName = "1.2.0"  // human-readable, update as needed
```

### Step 2: Copy APK to server

```bash
# Copy to the backend's uploads directory
cp app-release.apk  examination-backend/uploads/releases/examination-v3.apk
```

### Step 3: Publish via API

```bash
curl -X POST https://riteshmathematics.in/exam/api/app/publish \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "versionCode":   3,
    "versionName":   "1.2.0",
    "apkPath":       "uploads/releases/examination-v3.apk",
    "releaseNotes":  ["Bug fixes", "Image review now loads correctly"],
    "mandatory":     false
  }'
```

The server:
1. Writes a row to `apk_releases`.
2. Starts a **background job** that runs `generate_patch.py` for each of the last
   `MAX_PATCH_CHAIN` (= 3) prior versions.
3. Broadcasts a `app.update.available` WebSocket event to all connected clients.
4. Returns 200 immediately (patch generation continues in background).

### Step 4: Monitor patch generation

```bash
pm2 logs exam-server --lines 100 | grep OTA-Patch
```

Expected output:
```
[OTA-Patch] Starting generation: v2 -> v3
[OTA-Patch] Successfully generated patch: v2 -> v3
```

Once done, `uploads/patches/v2_to_v3.patch.gz` exists on the server.

---

## 8. Update Flow on Android

### What the app does at startup
1. Calls `GET /api/app/update-info?version_code=<current>`.
2. Receives a JSON response:
   - `strategy: "NONE"` — already up to date, do nothing.
   - `strategy: "PATCH_CHAIN"` — patches available, download and apply them.
   - `strategy: "FULL_APK"` — no patch chain (too old or patches not ready), download full APK.

### PATCH_CHAIN strategy (typical case)
The response includes an array of patches, e.g.:
```json
{
  "strategy": "PATCH_CHAIN",
  "targetVersionCode": 3,
  "targetSha256": "513c2c...",
  "patches": [
    { "fromVersion": 2, "toVersion": 3, "url": "/api/app/patches/v2_to_v3.patch.gz", "sha256": "0a73b4...", "size": 1158911 }
  ]
}
```

For each patch:
1. **Download** the .gz file into app cache.
2. **Decompress** with `GZIPInputStream`.
3. **Apply** via `BsPatch.applyPatch(old_raf, new_output_stream, patch_input_stream)`.
4. After all patches, **verify SHA-256** of reconstructed APK against `targetSha256`.
5. **Install** using `FileProvider` + `ACTION_VIEW` intent with `application/vnd.android.package-archive`.

If any step fails, the app falls back to downloading the full APK (if `apkUrl` is not null
in the response).

### Decision thresholds (in `release.service.ts`)
- Max patch chain: **3 hops** (`MAX_PATCH_CHAIN = 3`). Clients more than 3 versions behind always get a full APK.
- Size threshold: patch chain total size must be **< 60% of the full APK** (`PATCH_SAVINGS_THRESHOLD = 0.60`). If patches are somehow large, falls back to full download.

---

## 9. Generating a Patch Manually (for testing / debugging)

### Prerequisites
- Python 3.8+ (tested on 3.14; no C extensions required — pure Python only)
- Two APK files

### Run
```bash
cd examination-backend

python scripts/generate_patch.py \
  "apk-output/examination-debug-20260609_1932.apk" \
  "apk-output/examination-debug-20260610_0822.apk" \
  "apk-output/patch_v2_to_v3.patch.gz"
```

Expected output:
```
[patch-gen] Reading old.apk ...
[patch-gen] Reading new.apk ...
[patch-gen] Old size: 44,268,487 bytes
[patch-gen] New size: 44,828,953 bytes
[patch-gen] Generating patch ...
[patch-gen] Building match index ...
[patch-gen] Scanning new APK for matches ...
[patch-gen] Raw patch size: 44,830,513 bytes
[patch-gen] Compressing with GZIP ...
[patch-gen] Compressed patch size: 1,158,911 bytes
[patch-gen] Bandwidth savings vs full APK: 97.4%
[patch-gen] METADATA_JSON={"from_size": ..., "to_size": ..., "patch_size": ..., ...}
[patch-gen] Done: apk-output/patch_v2_to_v3.patch.gz
```

### Verify a patch (sanity-check script)
```python
import gzip, struct, hashlib

def read_long(data, offset):
    val = struct.unpack_from('<Q', data, offset)[0]
    if val & (1 << 63):
        return -(val & 0x7FFFFFFFFFFFFFFF)
    return val

with gzip.open('patch_v2_to_v3.patch.gz', 'rb') as f:
    patch = f.read()

assert patch[:16] == b'ENDSLEY/BSDIFF43', "Bad signature"
new_size = read_long(patch, 16)

with open('old.apk', 'rb') as f:
    old = f.read()

new = bytearray(new_size)
j, oi, pi = 0, 0, 24
while j < new_size and pi < len(patch):
    dl = read_long(patch, pi); cl = read_long(patch, pi+8); jmp = read_long(patch, pi+16); pi += 24
    for k in range(dl):
        new[j+k] = (old[oi+k] + patch[pi+k]) & 0xFF if oi+k < len(old) else patch[pi+k]
    pi += dl; j += dl; oi += dl
    new[j:j+cl] = patch[pi:pi+cl]; pi += cl; j += cl
    oi += jmp

sha = hashlib.sha256(new).hexdigest()
with open('new.apk', 'rb') as f:
    expected = hashlib.sha256(f.read()).hexdigest()
print("MATCH!" if sha == expected else f"MISMATCH: got {sha}, want {expected}")
```

---

## 10. APK Signing — Important for Upgrades

Android only allows upgrading an installed app if the new APK is signed with the
**same key** as the installed one. If keys differ, install fails with "App not installed."

This project uses a **committed project keystore** to ensure consistent signing:

| Item | Value |
|------|-------|
| Keystore file | `examination-compose-v2/app/rmc-exam-release.jks` |
| Alias | `rmcexam` |
| Keystore password | `rmcexam2024` |
| Key password | `rmcexam2024` |
| Validity | 10,000 days |
| CN | `RMC Examination`, O=`Ritesh Mathematics Coaching`, C=`IN` |

Both debug and release build types in `build.gradle.kts` use this keystore:
```kotlin
signingConfigs {
    create("rmcExam") {
        storeFile = file("rmc-exam-release.jks")
        storePassword = "rmcexam2024"
        keyAlias = "rmcexam"
        keyPassword = "rmcexam2024"
    }
}
buildTypes {
    debug   { signingConfig = signingConfigs.getByName("rmcExam") }
    release { signingConfig = signingConfigs.getByName("rmcExam") }
}
```

> **First-time install note:** Devices that have the app installed with an OLD (debug/machine-specific)
> keystore must manually uninstall before installing the new consistently-signed build. After that,
> all future updates work seamlessly via OTA.

---

## 11. REST API Reference

### `GET /exam/api/app/update-info?version_code=N`
No auth required. Returns the best update path for a client at version N.

**Response (up to date):**
```json
{ "status": "success", "update": { "updateAvailable": false, "strategy": "NONE", ... } }
```

**Response (patch available):**
```json
{
  "status": "success",
  "update": {
    "updateAvailable": true,
    "strategy": "PATCH_CHAIN",
    "targetVersionCode": 3,
    "targetVersionName": "1.2.0",
    "targetSha256": "513c2c...",
    "patches": [
      {
        "fromVersion": 2,
        "toVersion": 3,
        "url": "/api/app/patches/v2_to_v3.patch.gz",
        "sha256": "0a73b4...",
        "size": 1158911
      }
    ],
    "apkUrl": null,
    "mandatory": false,
    "releaseNotes": ["Bug fixes"]
  }
}
```

**Response (full APK fallback):**
```json
{
  "status": "success",
  "update": {
    "updateAvailable": true,
    "strategy": "FULL_APK",
    "apkUrl": "/uploads/releases/examination-v3.apk",
    ...
  }
}
```

### `GET /exam/api/app/patches/:filename`
No auth required. Serves a patch .gz file by name.
Path traversal protected (rejects `..`, `/`, `\` in filename).

### `POST /exam/api/app/publish` (ADMIN only)
```json
{
  "versionCode":  3,
  "versionName":  "1.2.0",
  "apkPath":      "uploads/releases/examination-v3.apk",
  "releaseNotes": ["What changed"],
  "mandatory":    false
}
```
Triggers background patch generation. Returns immediately.

---

## 12. Common Problems and Fixes

### "App not installed" on all devices
**Cause:** APK signed with a different key than what's currently installed.
**Fix:** Ensure `rmc-exam-release.jks` is in the repo and `build.gradle.kts` uses it for
both debug and release. Devices with old installs must uninstall once.

### Patch generation hangs / never finishes
**Cause A (O(n²)):** Old version of generate_patch.py used `bytes.find()` on the entire
44 MB old APK for every gap byte → O(n²).
**Fix:** The current version uses a pre-built `uint32 → position` dict with
`struct.unpack_from` (zero heap allocation). Gap scan is O(1) per byte.

**Cause B:** Python process killed by OOM. Reduce `INDEX_STEP` carefully — larger step =
less RAM but slightly lower patch quality.

### Patch applies but SHA-256 verification fails (reconstruction wrong)
**Cause:** The `old_jump` field in a BSDIFF43 control record repositions the old cursor
**after** the diff, not before. If a match is at `match_old != old_offset`, the diff block
must be preceded by a seek record to align old_offset before addend computation.
**Fix:** Current generator always emits a gap/seek record when `match_old != old_offset`,
even if the gap is 0 bytes.

### "Results have not been released yet" showing even when results are released
**Cause:** Backend device-binding check ran before exam status check, blocking any device
with changed device_id even when results were already released.
**Fix:** In `assigned-paper.ts`, the device-binding checks are now inside the
`if (exam.status !== "RESULT_RELEASED")` guard — released exams skip the device check.

### Review images show "image unavailable"
**Cause:** 5 backend routes used `:versionQuestionId` URL param but validated with
`studentQuestionIdParamSchema` (which expects `questionId`), returning Zod 400 errors.
**Fix:** Added `studentVersionQuestionIdParamSchema` and applied to all 5 affected routes
in `student/router.ts`.

---

## 13. Extending the System

### Adding a new APK version
1. Increment `versionCode` in `build.gradle.kts`.
2. Build APK, copy to `examination-backend/uploads/releases/`.
3. `POST /api/app/publish` with the new metadata.
4. Monitor `pm2 logs exam-server` for `[OTA-Patch]` lines.

### Improving patch quality
- Reduce `INDEX_STEP` from 8 to 4 in `generate_patch.py` for ~2x better coverage
  (uses ~880 MB RAM instead of ~440 MB — check server memory first).
- No code changes required in the Android client or backend.

### Adding a completely new platform (iOS, web, etc.)
The patch format and generator are platform-agnostic binary diff tools. To support a
new platform: implement the reconstruction loop from section 5 in the target language,
and re-use the existing backend endpoints.

### Manual database operations (if needed)
```sql
-- Check all releases
SELECT version_code, version_name, file_size, sha256, mandatory FROM apk_releases ORDER BY version_code;

-- Check all patches
SELECT from_version_code, to_version_code, patch_size, sha256 FROM apk_patches ORDER BY to_version_code;

-- Delete a bad patch (will be re-generated on next publish)
DELETE FROM apk_patches WHERE from_version_code = 2 AND to_version_code = 3;
```

---

## 14. Performance Characteristics (measured on real 44 MB APKs)

| Metric | Value |
|--------|-------|
| Index build time (Python 3.14, Windows) | ~3–5 s |
| Patch generation time | ~5–15 s |
| Compressed patch size (consecutive builds) | ~1–2 MB |
| Bandwidth savings | ~97% |
| RAM used during generation | ~400 MB |
| Android apply time (BsPatch.kt, mid-range device) | ~5–15 s |
| SHA-256 verified? | Yes (both raw patch and reconstructed APK) |
