# Backend Phase B Notes - Question Paper API

This note records the transition from schema-only support to working source-paper and scheduling APIs.

## What was added

- Question Paper CRUD
- Question Paper question CRUD
- Question Paper media routes
- Schedule Exam endpoint
- Frozen Question Paper Version creation at schedule time
- Exam records now store:
  - `question_paper_id`
  - `question_paper_version_id`

## What remains legacy

- Existing exam/question tables are still present for transition safety.
- Student attempt, result, and leaderboard logic still have legacy dependencies that will be migrated later.
- The old exam lifecycle routes still exist while the new paper/version flow is introduced.

## Next phase

- Move student attempt payloads to `question_paper_version_*` tables.
- Move result calculation to the frozen version tables.
- Move leaderboard generation to the frozen version results.
- Then wire the AI Studio v2 frontend to these new paper and schedule APIs.
