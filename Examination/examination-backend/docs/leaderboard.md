# Leaderboard

This module generates and serves cached leaderboard views from stored official result snapshots.

## Policy

- Only released official exams are eligible.
- Leaderboards never recalculate from editable source questions.
- Versioned exams must use stored `attempt_results` produced from frozen `question_paper_version_*` data.
- Legacy non-versioned exams may still use the legacy stored result path.
- Self-practice, personal practice, and not-ranked attempts are intentionally excluded from the official policy even though those flows are not implemented yet.
- Self-practice is now stored in separate practice attempt/result tables and does not participate in official leaderboard regeneration.
- Practice attempts must remain `counts_for_leaderboard = false` and `counts_for_official_result = false`.
- Official exam results are stored snapshots. The leaderboard regenerates from those stored rows and never recalculates from mutable source questions.

## Scope

- Exam-wise leaderboard
- Batch-wise leaderboard for a given exam
- Overall leaderboard across released exams
- Student leaderboard views after result release

## Ranking rules

### Exam and batch scopes

1. Higher `total_score`
2. Higher `percentage`
3. Fewer `wrong_count`
4. More `correct_count`
5. Earlier `submitted_at`
6. Lower `attempt_id` as deterministic fallback

Competition ranking is used, so tied rows can share the same rank:

- `1, 2, 2, 4`

### Overall scope

- Uses released exams only
- Aggregates by student from stored official results only
- Stores `total_score_sum`, `max_score_sum`, `average_percentage`, and `exams_count`
- `score` stores `total_score_sum`
- `percentage` stores `average_percentage`
- `tie_break_value` stores `exams_count`
- Result rows are filtered so versioned exams use `scoring_source = QUESTION_PAPER_VERSION`
- Legacy exams use `scoring_source = LEGACY_EXAM_QUESTIONS` or null
- Versioned official attempts now also carry `assigned_paper_instance_id` in the stored result snapshot for traceability.

## Student visibility

- Student leaderboard routes only expose released exams/results.
- Student leaderboard payloads include version metadata when available:
  - `evaluated_question_paper_version_id`
  - `evaluated_question_paper_version_number`
  - `scoring_source`
- Correct answers, solution images, and teacher answer keys are never exposed by leaderboard routes.

## Release gating

- Exam and batch views require the exam to be `RESULT_RELEASED`.
- Overall leaderboard is built only from released exam result rows.
- If a result row is missing, regeneration skips it instead of guessing.
- If a row has unsafe or mismatched scoring metadata, it is excluded from the official leaderboard path.

## Cached entries

`leaderboard_entries` is cleared and regenerated transactionally for the selected scope.

## Notes

- `tie_break_value` is kept within SQLite `INT` limits. For exam and batch scopes, `attempt_id` is used instead of a timestamp.
- No question image or solution media is used in ranking.
