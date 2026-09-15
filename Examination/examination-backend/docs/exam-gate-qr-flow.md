# Exam Gate QR Flow

This backend phase adds the controlled exam-center entry flow for official exams.

## Teacher flow

1. Teacher schedules a versioned exam as usual.
2. Teacher manually starts the exam with `POST /api/exams/:examId/start`.
3. Teacher opens the gate session list with `GET /api/exams/:examId/gate/sessions`.
4. Teacher scans the student QR and verifies it with `POST /api/exams/:examId/gate/verify-qr`.
5. On successful verification the backend creates or reuses a student-specific assigned paper instance for that exam.

## Student flow

1. Student opens the exam.
2. Student requests a short-lived QR with `POST /api/student/exams/:examId/gate/qr`.
3. Student polls `GET /api/student/exams/:examId/gate/status`.
4. Student receives a waiting-room state after verification.
5. Student updates paper download readiness with `PATCH /api/student/exams/:examId/gate/paper-download-status`.
6. Student downloads the safe assigned live payload with `GET /api/student/exams/:examId/download-payload?device_id=...`.
7. Student starts the official attempt with `POST /api/student/exams/:examId/start` using the bound `device_id`.

## Stored gate state

- `exam_gate_sessions`
  - exam, student, UID snapshot, device id
  - QR token hash and expiry
  - gate status
  - device bind status
  - paper download status
  - verification metadata
  - optional linked attempt
- `student_exam_paper_instances`
  - student-specific frozen assigned paper created at gate verification time
  - assigned student number, variant seed, live package checksum
  - locked review package checksum and lock state
- `student_exam_paper_questions`
  - per-student question selection and order
  - frozen section/question ordering for live delivery and later review
- `exam_attempt_violations`
  - stores later secure-mode violations

## Security rules

- QR tokens are short-lived and stored hashed.
- Teacher verification checks exam, student, UID, device, and expiry.
- Teacher verification also creates the assigned paper instance when needed.
- Official attempt start requires a verified gate session and the bound device id.
- Live attempt payloads stay answer-safe.
- The safe live payload uses the assigned paper order, not the shared paper order.

## Waiting-room payload

The student gate status and download payload expose:

- `gate_status`
- `device_bind_status`
- `paper_download_status`
- `can_enter_waiting_room`
- `can_start_attempt`
- UID / device metadata

## Violation skeleton

The backend now supports logging later secure-mode events such as:

- app backgrounding
- app switching
- screenshot attempts
- multi-window / overlay triggers
- network loss
- timer tamper attempts

Android enforcement is intentionally deferred to a later phase.
