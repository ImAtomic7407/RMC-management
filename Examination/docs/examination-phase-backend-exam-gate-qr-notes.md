Backend Phase Notes: Exam Gate QR Flow

This phase introduces a controlled exam-center entry path for official exams.

Added
- Teacher manual exam start
- Student QR issuance and refresh
- Teacher QR verification
- Exam presence/attendance session storage
- Device binding for the exam session
- Waiting-room status and paper-download readiness
- Violation logging skeleton for later secure-mode enforcement

Still deferred
- Android secure-mode enforcement
- Student student-side UI integration
- Results/leaderboard changes
- Practice/self-practice changes
- Selected-question reattempt

Validation
- Prisma schema validated
- Prisma client regenerated
- Backend typecheck passed
- Smoke test confirmed:
  - QR verification required before attempt start
  - verified gate sessions become BOUND
  - device mismatch is rejected
  - waiting-room payload becomes startable after verification
  - violation logging stores rows
