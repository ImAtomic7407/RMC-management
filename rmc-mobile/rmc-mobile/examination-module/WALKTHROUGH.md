# RMC Examination Module — Integration Walkthrough

## Overview

This module lives at `rmc-mobile/examination-module/` and is self-contained: it can be reviewed and tested in isolation, then wired into the main App.tsx incrementally. The backend is at `A:\RMC_Local_Installer\Examination\examination-backend\` and runs on port **4200** by default.

---

## Step 1 — Add missing dependencies

The examination module requires two packages that are not yet in `rmc-mobile/package.json`:

```bash
cd A:\RMC_Local_Installer\rmc-mobile
npx expo install @react-native-async-storage/async-storage expo-screen-capture expo-print
```

`expo-camera`, `expo-secure-store`, and `expo-sharing` are already present. `expo-print` is needed by `TeacherHistoryTab` for PDF export — without it the build will fail on that import.

---

## Step 2 — Copy Kotlin native module

Copy the two Kotlin files into the Android project:

```
examination-module/native/RmcLockTaskModule.kt   →  android/app/src/main/java/in/rmc/mobile/
examination-module/native/RmcLockTaskPackage.kt  →  android/app/src/main/java/in/rmc/mobile/
```

### Register in MainApplication.kt

Open `android/app/src/main/java/in/rmc/mobile/MainApplication.kt` and add the package to `getPackages()`:

```kotlin
override fun getPackages(): List<ReactPackage> = PackageList(this).packages.apply {
    add(RmcLockTaskPackage())   // <-- add this line
}
```

### Required MainActivity patch — focus loss + unpin detection

Add the following override to `MainActivity.kt`. This handles two separate events:
1. **`notifyUnpinned`** — fires when the student exits lock task mode entirely (triggers `APP_SWITCH` violation + auto-submit after 2nd exit)
2. **`notifyFocusLost`** — fires when an overlay covers the app while lock task is still active (notification bar, assistant, etc.) — triggers `APP_BACKGROUND` violation only, no auto-submit

```kotlin
override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    val module = reactInstanceManager
        ?.currentReactContext
        ?.getNativeModule(RmcLockTaskModule::class.java)
    if (!hasFocus) {
        // Try unpin path first — if lock task is gone, this emits onAppUnpinned
        module?.notifyUnpinned()
        // If lock task is still active (overlay/notification), emit onFocusLost
        module?.notifyFocusLost()
    }
}
```

**Without this patch:** unpin detection falls back to 500 ms polling (still works). Focus-loss (`APP_BACKGROUND`) violations will NOT be reported to the server at all.

---

## Step 3 — Configure the exam API base URL

The exam backend is a **separate server** from the main RMC backend. Call `setExamBaseUrl` and (optionally) `setExamWsPort` once at app startup — before any examination screen is rendered.

In `App.tsx`, near where `STORAGE_BASE_URL` is read:

```typescript
import { setExamBaseUrl, setExamWsPort } from './examination-module';

// Inside your init/useEffect:
const examBackendUrl = 'http://YOUR_EXAM_SERVER_IP:4200';   // e.g. http://192.168.1.100:4200
setExamBaseUrl(examBackendUrl);
// setExamWsPort(4200);  // only needed if port differs from 4200
```

The base URL resolves to `<examBackendUrl>/api` for HTTP requests and `ws://<host>:4200/ws` for WebSocket.

---

## Step 4 — Authentication (important)

The examination backend uses **Bearer JWT tokens** — completely separate from the main app's cookie auth (`rmcmobilecookiev2_clone`). Students and teachers must log in to the exam backend independently.

### Login flows

| Role | Endpoint | Payload |
|---|---|---|
| Student | `POST /api/auth/login/rmc/student` | `{ uid: "<student UID>" }` |
| Teacher/Admin | `POST /api/auth/login/rmc/staff` | `{ username, password }` |
| Standard local | `POST /api/auth/login` | `{ username, password }` |

All three return `{ access_token, token_type: "Bearer", user }`.

Store the token before mounting the exam module:

```typescript
import * as SecureStore from 'expo-secure-store';
import { STORAGE_EXAM_TOKEN } from './examination-module';

const response = await examFetch('/auth/login/rmc/student', {
  method: 'POST',
  body: JSON.stringify({ uid: currentStudentUid }),
});
await SecureStore.setItemAsync(STORAGE_EXAM_TOKEN, response.access_token);
```

**The current staging code has no login screen.** Authentication must happen before `ExamNavigator` is mounted. Add a thin pre-flight in your App.tsx tab handler that logs the user into the exam backend (using their already-known RMC UID or staff credentials) before navigating to the exam tab.

---

## Step 5 — Wire ExamNavigator into App.tsx

The main app uses a monolithic `App.tsx` with custom state-based tab navigation. `ExamNavigator` is designed to drop into that pattern.

Add an "Exam" tab entry. When the tab is selected, render the navigator with the user's role:

```typescript
import { ExamNavigator } from './examination-module';

// Inside your tab render switch/if-else:
if (activeTab === 'exam') {
  const userRole = isTeacher ? 'teacher' : 'student';
  return (
    <ExamNavigator
      role={userRole}
      onExit={() => setActiveTab('home')}
    />
  );
}
```

`onExit` is called when the user navigates back past the root exam screen (e.g. taps Back from the exam list).

---

## Step 6 — Android permissions

Add to `android/app/src/main/AndroidManifest.xml` inside `<manifest>`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<!-- Screen capture prevention — no explicit permission needed, handled by expo-screen-capture -->
```

Camera permission is already prompted at runtime by `TeacherQrScanner` via `useCameraPermissions`.

---

## Known Issues and Design Notes

### 1. Teacher question-editing workflow mismatch

`TeacherDashboard` navigates to `TeacherQuestionEditor` passing `paperId: item.id` (the exam's numeric ID). However, `TeacherQuestionEditor` calls `GET /api/question-papers/:paperId/questions` — a route that expects a **question paper ID**, not an exam ID.

The backend uses two separate workflows:
- **Direct exam creation** (`POST /api/exams`): creates an exam with section specs, but no linked question paper. This is what `TeacherExamCreator` uses.
- **Schedule from paper** (`POST /api/exams/schedule`): schedules an exam from a pre-existing question paper.

**To fix:** The teacher flow needs one of:
- (a) Create a question paper first (`POST /api/question-papers`), add questions to it, then schedule the exam from that paper using `POST /api/exams/schedule`. This requires redesigning `TeacherExamCreator`.
- (b) Change `TeacherDashboard` to navigate with `paperId: item.question_paper_id` — but `POST /api/exams` (direct creation) does not create a linked paper, so `question_paper_id` will be `null` for directly-created exams.

Until this is resolved, the `TeacherQuestionEditor` screen will receive a 404 for exams created via the current `TeacherExamCreator`.

### 2. QR generation uses an external image CDN

`StudentWaitingRoom` generates QR images via `https://api.qrserver.com/v1/create-qr-code/`. This requires internet access during the exam. For offline/air-gapped deployments, replace with a local QR library (e.g. `react-native-qrcode-svg`).

### 3. Unpin detection requires physical device testing

The `startLockTask()` / `stopLockTask()` flow only works on a real Android device — Expo Go and the simulator do not support lock task mode. The polling-based detection in `RmcLockTaskModule` cannot be verified without hardware.

### 4. AsyncStorage keys

| Purpose | Key |
|---|---|
| Cached exam answers | `@rmc_exam_answers_<examId>` |
| Student device ID | `@rmc_device_id` |

These are separate from the main app's AsyncStorage usage.

### 5. WebSocket reconnect on exam tab hide

If the main app hides the exam tab (rather than unmounting it), the WebSocket stays open. Call `examWs.disconnect()` when exiting the exam tab and `examWs.connect(examId)` when re-entering to avoid stale subscriptions.

---

## File reference

```
examination-module/
├── ExamNavigator.tsx            Self-contained stack navigator (no react-navigation)
├── index.ts                     Barrel exports
├── services/
│   ├── api.ts                   examFetch wrapper; setExamBaseUrl / setExamWsPort
│   └── websocket.ts             Singleton WebSocket manager
├── hooks/
│   └── useExamTimer.ts          Countdown timer + answer cache (AsyncStorage)
├── screens/
│   ├── student/
│   │   ├── StudentExamList.tsx  Lists exams; routes to waiting room
│   │   ├── StudentWaitingRoom.tsx  QR display + gate polling
│   │   └── SecureAttemptScreen.tsx  Pinned exam UI with 2-unpin auto-submit
│   └── teacher/
│       ├── TeacherDashboard.tsx    Exam list + status controls
│       ├── TeacherQrScanner.tsx    expo-camera QR gate scanner
│       ├── TeacherExamCreator.tsx  Draft exam creation form
│       └── TeacherQuestionEditor.tsx  MCQ/Integer question editor (see §Known Issues §1)
└── native/
    ├── RmcLockTaskModule.kt     Android screen pinning + polling unpin detection
    └── RmcLockTaskPackage.kt    ReactPackage registration
```
