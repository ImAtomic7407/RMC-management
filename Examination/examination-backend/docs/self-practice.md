# Self Practice

Self practice is a student-only, not-ranked learning mode built on frozen `question_paper_versions`.

## Model

- `question_papers` can be marked `is_self_practice_enabled = true`
- practice duration is stored on the paper as `self_practice_duration_seconds`
- practice solution policy is stored on the paper as `self_practice_solution_policy`
- each practice session creates a new immutable `question_paper_versions` snapshot
- practice attempts are stored in separate `practice_attempts` / `practice_attempt_answers` / `practice_attempt_results` / `practice_attempt_section_results` tables
- practice attempts always set:
  - `attempt_context = SELF_PRACTICE`
  - `counts_for_leaderboard = false`
  - `counts_for_official_result = false`

## Supported policies

- `AFTER_SUBMIT`
- `NEVER`

## Deferred policies

- `AFTER_CORRECT`
- `AFTER_TWO_WRONG`

Those policies are accepted in the schema, but the current implementation only fully supports `AFTER_SUBMIT` and `NEVER`.

## Routes

### Student paper list

- `GET /api/student/practice/papers`

### Start / resume

- `POST /api/student/practice/papers/:paperId/start`

### Attempt payload

- `GET /api/student/practice/attempts/:attemptId`

### Save answers

- `PATCH /api/student/practice/attempts/:attemptId/answers`

### Submit

- `POST /api/student/practice/attempts/:attemptId/submit`

### Result history

- `GET /api/student/practice/results`
- `GET /api/student/practice/results/:attemptId`

### Review

- `GET /api/student/practice/results/:attemptId/review`
- `GET /api/student/practice/results/:attemptId/review/questions/:versionQuestionId/media/:mediaId`
- `GET /api/student/practice/results/:attemptId/review/questions/:versionQuestionId/solution/:mediaId`

## What the student sees

- question text/image
- A/B/C/D options with optional option text
- saved answers while attempting
- personal score after submit
- correct answer and solution media only when policy allows
- `not_ranked = true`

## What the student does not get

- official rank
- official leaderboard placement
- official exam marks

## Leaderboard exclusion

- Practice attempts are stored separately and are never read by the official leaderboard generator.
- They remain `counts_for_leaderboard = false` and `counts_for_official_result = false`.

## Android v2 expectation

The future Compose v2 UI can show practice mode as a separate bottom-nav section:

- Home
- Exams
- Practice
- Results
- Leaderboard

Practice attempt cards can reuse the same question UI style as official exams, but with a clear `Practice / Not Ranked` badge.
