# Examination Module — Claude Context

## What This Is
A full-stack exam management system for RMC coaching institute. Consists of:
- **examination-backend**: TypeScript + Express + Prisma, port 4200, WebSocket at `/ws`
- **examination-android**: Kotlin/Jetpack Compose Android app (older, connected to backend)
- **examination-compose-v2**: Kotlin/Jetpack Compose Android app (newer, more complete models)

## Architecture — Backend
- Express + Prisma + SQLite/PostgreSQL
- Module structure: each feature has `router.ts`, `service.ts`, `schemas.ts`, `index.ts`
- Auth: JWT tokens, roles: ADMIN, TEACHER, STUDENT
- Real-time: WebSocket at `/ws` via `shared/realtime.ts`
- All routes require `requireAuthMiddleware` + `requireSchemaReady`

## Architecture — Android
- MVVM: ViewModel → Repository → API (Retrofit)
- State: `StateFlow` + `MutableStateFlow` in ViewModels
- UI: Jetpack Compose screens in `ui/screens/`
- Navigation: `AppNavGraph.kt` with `NavHost`
- No Hilt — uses manual `AppContainer` DI

## Exam Flow (how it works)
1. Teacher creates exam (DRAFT) → attaches question paper → publishes (PUBLISHED)
2. Teacher starts exam manually → status becomes LIVE
3. Student opens app → sees exam → generates QR code (`/api/student/exams/{id}/gate/qr`)
4. Teacher scans QR → verifies student → student enters waiting room
5. Exam goes LIVE → student starts attempt (`/api/student/exams/{id}/start`)
6. Student answers questions, saves answers per-question
7. Student submits OR timer expires → AUTO_SUBMITTED
8. Teacher finalizes → results calculated → released

## Known Issues (do not introduce workarounds for these — fix them properly)
- Android app missing QR gate flow entirely
- `startAttempt` doesn't send `device_id` — backend will reject with `QR_VERIFICATION_REQUIRED`
- Status check for "Start Attempt" button uses `PUBLISHED` but should require `LIVE`
- No WebSocket integration in Android app
- No results/scoreboard screen for students
- `sections`, `attempts`, `analytics`, `audit` backend modules are empty stubs

## Key Files
- Backend entry: `src/server.ts`, `src/app.ts`
- Exam logic: `src/modules/exams/service.ts`
- Gate/QR: `src/modules/exam-gate/service.ts`
- Student exam: `src/modules/student/service.ts`, `src/modules/student/router.ts`
- Android attempt screen: `ui/screens/student/StudentExamScreens.kt`
- Android ViewModel: `viewmodel/StudentExamViewModel.kt`
- Navigation: `navigation/AppNavGraph.kt`

## Sections always: PHYSICS, CHEMISTRY, MATHS (hardcoded, in that order)
## Question types: MCQ, INTEGER
## Exam modes: LIVE, PRACTICE


## RMC Integration (added)
The examination backend is integrated with the main RMC server and accessible at the
same domain — no separate subdomain needed.

### Public URL
All exam API calls go through the existing RMC tunnel:
- `https://riteshmathematics.in/exam/api/...`  — exam REST API
- `wss://riteshmathematics.in/exam/ws`          — exam WebSocket

The RMC server proxies `/exam/*` internally to the exam-server on `localhost:4200`,
stripping the `/exam` prefix before forwarding.

### How auth works
- Android app calls `POST /exam/api/auth/login/rmc/student` with `{ uid }` (RMC student UID)
- Android app calls `POST /exam/api/auth/login/rmc/staff` with `{ username, password }`
- Examination backend calls RMC's internal bridge API to verify the credentials
- On success, user is upserted into examination DB and an exam JWT is issued
- The local `POST /exam/api/auth/login` (password-based) still works for dev/fallback

### Internal bridge API (RMC server → exam, server-to-server only)
All routes require header `x-exam-secret: <EXAM_INTERNAL_SECRET>`:
- `GET  /api/internal/exam/healthz`       — health ping
- `POST /api/internal/exam/verify-staff`  — verify teacher/host credentials
- `POST /api/internal/exam/verify-student`— verify student by uid
- `GET  /api/internal/exam/roster`        — full student roster (for sync)
- `GET  /api/internal/exam/staff-roster`  — full staff roster (for sync)

### Roster sync
- `POST /exam/api/identity/rmc-sync` (ADMIN JWT required) — pulls all students + staff from RMC and upserts them

### Key new files
- `src/shared/rmc-bridge.ts`             — HTTP client for calling RMC internal API
- `src/modules/identity/rmc-sync.ts`     — bulk roster sync logic

### Environment variables (production, set via PM2 ecosystem.config.js)
- `RMC_API_URL`          — http://localhost:8080 (same machine)
- `RMC_INTERNAL_SECRET`  — shared secret (must match `EXAM_INTERNAL_SECRET` on RMC)
- `RMC_AUTH_ENABLED`     — "true" to activate RMC login endpoints

### PM2 processes (all in portable_suite/server/ecosystem.config.js)
- `rmc-server`   — RMC main app, port 8080; also proxies /exam/* to exam-server
- `exam-server`  — Examination backend, localhost:4200 (not directly exposed)
- `exam-watchdog`— Health monitor; restarts dead services via PM2
- `rmc-tunnel`   — Cloudflare tunnel → riteshmathematics.in (covers both apps)

### Deployment (first time)
```
# 1. Build examination-backend
cd Examination/examination-backend
npm ci
npx prisma migrate deploy
npm run build
cd ../../portable_suite/server

# 2. Set secrets (in environment or a local .env file, never commit values)
#    EXAM_BRIDGE_SECRET=<64-char hex>   <- shared between rmc-server and exam-server
#    EXAM_JWT_SECRET=<64-char hex>      <- JWT signing key for exam tokens

# 3. No Cloudflare changes needed — the existing rmc-tunnel already covers everything

# 4. Start everything
pm2 start ecosystem.config.js
pm2 save
```
