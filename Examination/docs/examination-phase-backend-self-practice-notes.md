# Backend Phase Notes: Self Practice

This phase adds a separate self-practice path that uses frozen question paper versions but never counts toward official exam ranking.

## Added

- practice-enabled question paper settings
- `practice_attempts` family of tables for the self-practice session/result lifecycle
- student practice paper list
- practice start / resume
- practice answer save
- practice submit and personal result calculation
- practice review and review media routes
- frozen snapshot stability for practice history

## Still legacy

- official exams continue to use `exams` / `exam_attempts`
- existing official result and leaderboard paths remain unchanged
- older practice-question unlock routes still exist for the legacy practice-exam flow
- `AFTER_CORRECT` and `AFTER_TWO_WRONG` are not fully implemented for self-practice review yet

## Next phase

- wire the Compose v2 frontend to the new practice endpoints
- decide whether the legacy practice-question unlock flow should be retired after the v2 UI ships
- add any richer practice policy behavior only after the current `AFTER_SUBMIT` / `NEVER` path is stable
