# RMC Mobile + Examination System

Complete source code and database for the combined RMC Mobile app (with integrated examination module) and the Examination backend server.

## Quick Reference

| Component | Location | Tech Stack |
|-----------|----------|-----------|
| **Mobile App** | `rmc-mobile/` | React Native (Expo SDK 54), TypeScript |
| **Exam Backend** | `Examination/` | Node.js, Express, Prisma, SQLite |
| **Database** | `Examination/examination.db` | SQLite |

## Quick Start

### Local Development (App + Backend)
```bash
# See SETUP_LOCAL.md for step-by-step instructions
```

### Deploy to VPS
```bash
# See DEPLOYMENT.md for live hosting setup
```

### Build & Publish to Play Store
```bash
# See PLAY_STORE.md for APK signing and Play Console submission
```

### Database & Data Management
```bash
# See DATABASE.md for backup, restoration, and queries
```

## Key Files

- **App config**: `rmc-mobile/App.tsx` (exam server URL, feature flags)
- **Build config**: `rmc-mobile/android/app/build.gradle` (signing, variants, release setup)
- **Backend config**: `Examination/.env` (database, JWT keys, server settings)
- **Backend entry**: `Examination/src/app.ts` (Express server, routes, middleware)
- **Database file**: `Examination/examination.db` (student accounts, exams, attempts, results)

## Important Security Notes

⚠️ **Never commit to git**:
- `.env` files (contains JWT secrets, database passwords)
- `*.keystore` files (signing credentials)
- Private API keys or tokens

✓ **Always keep in `.gitignore`** (already configured):
- `node_modules/`, build artifacts
- OS files (`.DS_Store`, `Thumbs.db`)
- IDE config (`.idea/`, `.vscode/`)

## Directory Structure

```
RMC-management-2/
├── rmc-mobile/              # React Native app (Expo)
│   ├── examination-module/  # Shared exam UI & logic
│   ├── android/             # Native Android config
│   ├── App.tsx              # Main app entry
│   └── package.json
├── Examination/             # Express backend + database
│   ├── src/                 # TypeScript source
│   ├── dist/                # Compiled JavaScript
│   ├── examination.db       # SQLite (student data, exams, attempts)
│   ├── package.json
│   └── tsconfig.json
├── DATABASE.md              # Database schema & management
├── SETUP_LOCAL.md           # Local development setup
├── DEPLOYMENT.md            # VPS/production deployment
├── PLAY_STORE.md            # Play Store publishing
└── TROUBLESHOOTING.md       # Common issues & fixes
```

## Key URLs

- **Exam Server (Live)**: `https://exam.riteshmathematics.in`
- **App Config**: Points to exam server URL (see `App.tsx`)
- **Local Development**: `http://localhost:4200` (backend), `http://localhost:8081` (app dev server)

## Next Steps

1. **Setting up locally?** → Read `SETUP_LOCAL.md`
2. **Deploying to VPS?** → Read `DEPLOYMENT.md`
3. **Building APK for Play Store?** → Read `PLAY_STORE.md`
4. **Managing student data?** → Read `DATABASE.md`
5. **Troubleshooting issues?** → Read `TROUBLESHOOTING.md`

---

Last updated: 2026-06-30 | Created as complete backup for version control
