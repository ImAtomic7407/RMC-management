# Controlled Exam Finalize Phase

## What Changed

- Added a server-side teacher finalize path for official exams.
- Finalize closes the exam and force-submits any non-terminal attempts using the saved answers already on the server.
- Result release remains separate from finalize.

## Routes

- `POST /api/exams/:examId/finalize`
  - Teacher/admin only.
  - Closes the exam.
  - Finalizes `IN_PROGRESS` and `EXPIRED` attempts as `AUTO_SUBMITTED`.
  - Recalculates official results from the assigned-paper-first scoring pipeline.
  - Returns a summary of what was finalized.

- `POST /api/exams/:examId/close`
  - Backward-compatible alias for finalize.
  - Existing teacher UI can keep calling close while the backend now performs authoritative finalization.

- `POST /api/exams/:examId/release-result`
  - Requires the exam to be `CLOSED`.
  - Requires all attempts to be terminal.
  - Releases results, review, and leaderboard visibility only after finalize is complete.

## Statuses Used

- `IN_PROGRESS`
- `SUBMITTED`
- `AUTO_SUBMITTED`
- `EXPIRED`
- `CLOSED`
- `RESULT_RELEASED`

## Scoring Behavior

Official result calculation still uses the assigned-paper-first source chain:

- `student_exam_paper_instances`
- `student_exam_paper_questions`
- `question_paper_version_questions`
- `question_paper_version_options`
- `attempt_answers`

If a student has no saved answers, finalize still creates a result row with:

- score `0`
- all assigned questions marked unattempted
- section totals calculated correctly

## Release Result Behavior

- Finalize does not release results automatically.
- Release is rejected unless the exam is already `CLOSED`.
- Release regenerates exam leaderboard, batch leaderboard, and overall leaderboard from stored official results.

## Post-Finalize Restrictions

After finalize:

- answer save is rejected
- start/resume is rejected or returns a terminal state
- submit is idempotent and safe
- review remains locked until result release

## Smoke Test Summary

Backend smoke verified:

- manual submit remains safe after finalize
- already submitted attempts are not duplicated
- zero-answer attempts finalize to a valid `0` score result
- result release still gates review unlock
- leaderboard regenerates after release

## Remaining Limitation

- `FORCE_SUBMITTED` is not a separate persisted attempt status yet.
- The backend uses `AUTO_SUBMITTED` for server-finalized attempts for now.
- Teacher force-finalize is supported, but a distinct enum can be added later if the product wants to differentiate teacher-finalized vs timer-finalized attempts.
