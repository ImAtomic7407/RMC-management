# Local Development Setup

Complete guide to running both the RMC Mobile app and Examination backend on your local machine.

## Prerequisites

### General
- Node.js 18+ and npm
- Git
- Visual Studio Code (optional but recommended)

### For Mobile App (rmc-mobile)
- Android Studio (for Android development)
- Android SDK 34+ (compileSdkVersion)
- Expo CLI: `npm install -g expo-cli`
- XCode (for iOS, optional)

### For Backend (Examination)
- SQLite (or use the included `examination.db`)
- PM2 (for process management): `npm install -g pm2`

## Step 1: Backend Setup

### 1.1 Install dependencies
```bash
cd Examination
npm install
```

### 1.2 Copy environment file
```bash
cp .env.example .env  # or create your own
```

Edit `.env` to configure:
```env
# Database
DATABASE_URL="file:./examination.db"

# Server
PORT=4200
NODE_ENV=development

# JWT (for auth tokens)
JWT_SECRET=your-secret-key-here-change-in-production

# CORS & URLs
CORS_ORIGIN="http://localhost:8081"
PUBLIC_API_URL="http://localhost:4200"
```

### 1.3 Build & start backend
```bash
npm run build          # Compile TypeScript → dist/
npm run dev            # Start with nodemon (auto-reload)
# or for production-like mode:
npm start              # Run compiled dist/
```

Server runs on `http://localhost:4200`

**Check it works**:
```bash
curl http://localhost:4200/health
# Should return: {"status":"ok"}
```

### 1.4 View/manage data

Use SQLite viewer to inspect `examination.db`:
- **VS Code**: Install "SQLite" extension
- **Online**: Upload to sqliteonline.com (read-only)
- **CLI**: `sqlite3 examination.db`

## Step 2: Mobile App Setup

### 2.1 Install dependencies
```bash
cd ../rmc-mobile
npm install
```

### 2.2 Configure backend URL
Edit `App.tsx` and set:
```typescript
const EXAM_SERVER_URL_OVERRIDE: string = 'http://localhost:4200';
```

### 2.3 Start dev server
```bash
npm start
# or specifically:
expo start
```

This opens the Expo dev server on `http://localhost:8081`

### 2.4 Run on Android
- **Physical device**: Scan QR code with Expo Go app
- **Android Emulator**: 
  - Open Android Studio → AVD Manager
  - Start an emulator
  - Press `a` in Expo dev server terminal to open in emulator

### 2.5 Run on iOS (Mac only)
```bash
expo start --ios
```

Simulator opens automatically.

## Step 3: Test the Exam Flow

### 3.1 Create test accounts (if needed)

Use SQLite to add a teacher and student:
```sql
-- SQLite (examination.db)
INSERT INTO users (id, name, email, password_hash, role) 
VALUES (1, 'Teacher', 'teacher@test.com', 'hashed_pwd', 'TEACHER');

INSERT INTO users (id, name, email, password_hash, role) 
VALUES (2, 'Student', 'student@test.com', 'hashed_pwd', 'STUDENT');
```

### 3.2 Login to the app
- Use credentials defined in `App.tsx` dev section (or create above)
- Teacher credentials are hardcoded for development

### 3.3 Create and attempt an exam
1. Teacher: Create exam, upload question paper
2. Teacher: Publish exam → "PUBLISHED" status
3. Student: Scan gate QR → "VERIFIED" status
4. Student: Attempt exam → see questions + images
5. Student: Submit answers
6. Teacher: Release results
7. Student: View results with images + solution

## Step 4: Debugging

### Backend logs
```bash
# If running with PM2:
pm2 logs exam-server

# If running with npm start:
# Logs appear directly in terminal
```

### App logs
Open Expo dev server terminal (press `d` for device logs)

### Database queries
Use SQLite client or:
```bash
cd Examination
sqlite3 examination.db
sqlite> SELECT * FROM exams LIMIT 5;
sqlite> .tables              # List all tables
```

## Common Issues

| Issue | Solution |
|-------|----------|
| `npm install` fails | Delete `node_modules/` and `package-lock.json`, retry |
| Backend won't start | Check `.env` exists, DATABASE_URL is correct, port 4200 is free |
| App can't connect to backend | Verify `App.tsx` has correct backend URL, backend is running |
| Images don't load | Check `examination.db` has questions with media, token is valid |
| Build fails | Run `npm run clean` then `npm run build` |

See `TROUBLESHOOTING.md` for more help.

---

For deployment to VPS, see `DEPLOYMENT.md`
For Play Store submission, see `PLAY_STORE.md`
