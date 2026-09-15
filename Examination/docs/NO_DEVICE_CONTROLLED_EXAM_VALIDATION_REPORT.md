# No Device Controlled Exam Validation Report

## A. Device Check Result
- `adb devices -l` returned no connected device.
- No emulator or phone was available for install or runtime UI validation.
- `installDebug` was not run.

## B. Backend Health
- `GET http://localhost:4200/health` returned `status: ok`.
- Backend was healthy before and after validation.
- `npx prisma generate` initially hit a Windows file lock from the backend watcher, then succeeded after stopping and restarting the watcher.

## C. Assigned-Paper Race Smoke Result
- Command: `npx tsx src/scripts/assigned-paper-race-smoke.ts --same 10 --multi 9`
- Result: PASS
- Output summary:
  - same-student concurrent requests rejected = 0
  - multi-student concurrent requests rejected = 0
  - no duplicate `assigned_student_number`
  - idempotency OK

## D. Attempt Lifecycle Smoke Result
- Temp exam created through the real schedule/start flow.
- Exam id: `28`
- Student attempt results:
  - first start -> `STARTED_NEW_ATTEMPT`
  - second start same device -> `RESUMED_EXISTING_ATTEMPT`
  - wrong device -> `DEVICE_BIND_MISMATCH`
  - submit once -> result created
  - submit again -> `ATTEMPT_ALREADY_SUBMITTED`
  - save after submit -> rejected
  - save after expiry -> `ATTEMPT_EXPIRED`
  - start after submit/finalize -> terminal rejection

## E. Teacher Finalize / Release Smoke Result
- Finalize result:
  - exam moved from `LIVE` to `CLOSED`
  - `already_submitted = 1`
  - `auto_submitted = 2`
  - `expired_finalized = 1`
  - `results_created = 3`
  - `results_existing = 1`
  - `errors = []`
- Before release:
  - review unlock returned `REVIEW_NOT_RELEASED`
- Release result:
  - exam moved to `RESULT_RELEASED`
  - review unlock succeeded afterward
  - review payload succeeded afterward
  - leaderboard contained 4 rows after regeneration

## F. Frontend Build Result
- `.\gradlew.bat assembleDebug` passed.
- No Android device was connected, so `installDebug` was not run.

## G. Assigned-Package Cache Static Inspection
File: `A:/RMC_Local_Installer/Examination/examination-compose-v2/app/src/main/java/com/example/data/session/AssignedPackageCacheStore.kt`

```kotlin
private val cacheDir = File(appContext.filesDir, "assigned-paper-cache")

suspend fun save(record: AssignedPackageCacheRecord) = withContext(Dispatchers.IO) {
    cacheDir.mkdirs()
    val file = cacheFile(record.examId, record.deviceId)
    file.writeText(gson.toJson(record))
}
```

```kotlin
private fun isValid(record: AssignedPackageCacheRecord, examId: Long, deviceId: String): Boolean {
    if (record.examId != examId) return false
    if (record.deviceId != deviceId) return false
    if (record.assignedPaperInstanceId <= 0L) return false
    if (assignedPaper.sections.isEmpty()) return false
    if (assignedPaper.sections.none { it.questions.isNotEmpty() }) return false
    return true
}
```

- Stores safe assigned paper only in app-private storage.
- Validates `examId` and `deviceId`.
- Deletes invalid/corrupt cache on load.
- Does not store correct answers, solutions, unlock keys, or answer keys.
- Assessment: PASS

## H. Answer Outbox Static Inspection
File: `A:/RMC_Local_Installer/Examination/examination-compose-v2/app/src/main/java/com/example/data/session/AnswerOutboxStore.kt`

```kotlin
data class AnswerOutboxRow(
    val assignedQuestionId: Long,
    val versionQuestionId: Long,
    val selectedOptionId: Long? = null,
    val selectedOptionLabel: String? = null,
    val integerAnswer: String? = null,
    val markedForReview: Boolean = false,
    val syncStatus: String = "PENDING",
    val lastBackendErrorCode: String? = null,
)
```

```kotlin
private fun isValid(record: AnswerOutboxRecord, context: AnswerOutboxContext): Boolean {
    if (record.examId != context.examId) return false
    if (record.attemptId != context.attemptId) return false
    if (record.deviceId != context.deviceId) return false
    if (record.assignedPaperInstanceId != context.assignedPaperInstanceId) return false
    if (record.answers.any { it.assignedQuestionId <= 0L || it.versionQuestionId <= 0L }) return false
    return true
}
```

- Stores only student-selected answer data plus sync metadata.
- Uses app-private `filesDir/answer-outbox`.
- `SYNCING` rows are restored as retryable pending state in `ExamViewModel`.
- Outbox is cleared after successful submit or already-submitted terminal confirmation.
- Does not store correct answers, solutions, or official marks.
- Assessment: PASS

## I. Secure Shell Static Inspection
File: `A:/RMC_Local_Installer/Examination/examination-compose-v2/app/src/main/java/com/example/ui/screens/StudentSecureAttemptScreen.kt`

```kotlin
window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
controller?.hide(WindowInsetsCompat.Type.systemBars())
```

```kotlin
BackHandler(enabled = true) {
    privacyOverlayMessage = "Back action is disabled during the exam."
    viewModel.logStudentViolation(...)
}
```

```kotlin
val observer = LifecycleEventObserver { _, event ->
    if (event == Lifecycle.Event.ON_PAUSE || event == Lifecycle.Event.ON_STOP) {
        privacyOverlayMessage = "Exam security warning..."
        viewModel.logStudentViolation(...)
    }
}
```

- Secure shell guards are present in code.
- This was a static code inspection only.
- No phone/emulator runtime verification was possible in this pass.
- Assessment: PASS for static presence, not runtime-verified.

## J. No-Answer-Leak Static Inspection
- Live assigned package cache does not store answer keys, solution media, or unlock keys.
- Outbox stores only selected answers and sync metadata.
- Live secure attempt screen does not call the review route; review media stays in the separate review flow.
- Correct answers and solutions remain review-only in the code paths inspected.
- Assessment: PASS

## K. Bugs Found
- No new backend or Android logic bugs were found in this validation pass.
- Earlier restore-edge hardening is already in place:
  - persisted in-flight answer saves restore as retryable pending state after restart.

## L. Fixes Applied
- No additional source code fixes were required in this validation pass.
- The report doc was created and the validation was completed without touching `examination-android` or old RMC modules.

## M. What Still Needs Real-Device Testing
- Assigned-package cache restore after app kill/restart.
- Answer outbox restore after app kill/restart.
- Runtime `FLAG_SECURE` screenshot blocking.
- Runtime back-navigation blocking.
- Runtime privacy overlay behavior on background/app-switch.
- Any `installDebug`/ADB device install flow.

## N. Recommended Next Phase
- Add a lightweight background retry worker for the answer outbox while the secure attempt is active.
- After that, consider a richer device-side retry/status banner only if the current UI feels too quiet during poor network conditions.
