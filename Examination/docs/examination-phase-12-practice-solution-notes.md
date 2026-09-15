# Phase 12 Notes

Phase 12 introduces the practice solution unlock and student solution-access foundation for the separate Examination backend.

## What changed

- Practice answer checking for MCQ and INTEGER questions.
- Per-question practice attempt tracking.
- Unlock-on-correct and unlock-on-two-wrongs behavior.
- Authenticated student solution access for practice papers.
- Authenticated student solution access for live exams when policy allows it.
- Live exam solution access remains blocked during active attempts.

## What did not change

- No Android UI.
- No analytics/export.
- No option image support.
- No public unauthenticated solution URLs.
- No old RMC production modules were touched.

## Verification

- TypeScript typecheck passed.
- The local Examination SQLite database is ready and healthy.
- A practice smoke paper was validated end to end:
  - first wrong answer stayed locked
  - second wrong answer unlocked the solution
  - authenticated solution streaming succeeded

