# Backend Phase Notes: Version-Based Results

This phase migrated official result calculation for scheduled/versioned exams to the frozen question paper snapshot model.

## What changed

- Versioned exams now calculate results from immutable `question_paper_version_*` rows.
- Legacy exams without `question_paper_version_id` still calculate from the original live `questions` / `question_options` tables.
- `attempt_results` now stores version metadata for recalculated versioned exams:
  - `evaluated_question_paper_version_id`
  - `evaluated_question_paper_version_number`
  - `scoring_source`
- Result detail/list APIs now expose the version metadata when it exists.
- Section result rows continue to be stored separately in `attempt_section_results`.

## Scoring rules used

### MCQ

- Correct option is taken from the frozen version options where `is_correct = true`.
- Student answer is mapped to the frozen option first by `original_option_id`, then by option label if needed.
- Correct answer awards the frozen question `marks`.
- Wrong answer subtracts the frozen question `negative_marks`.
- Unattempted answer contributes `0`.

### INTEGER

- Correct integer answer is read from the frozen version question row.
- Student answer is canonicalized before comparison.
- Correct answer awards the frozen question `marks`.
- Wrong answer subtracts the frozen question `negative_marks`.
- Unattempted answer contributes `0`.

## Answer compatibility

The current attempt storage still uses the legacy compatibility columns:

- `attempt_answers.question_id`
- `attempt_answers.selected_option_id`
- `attempt_answers.integer_answer`

For versioned exams, the backend maps those saved legacy fields back to the frozen version question rows using:

- `original_question_id`
- `original_option_id`
- fallback `section_code + question_order`

This keeps the official student attempt path safe while the schema remains compatible with older attempts.

## What remains legacy

- Old non-versioned exams still use the live editable question tables.
- Attempt storage still uses the old compatibility columns rather than pure version-question foreign keys.
- Leaderboard generation still consumes stored result rows and is not re-authored around version tables yet.

## Validation completed

- Prisma schema validation passed.
- Prisma client generation passed.
- Typecheck passed.
- Smoke test confirmed:
  - versioned exam result recalculation used the frozen snapshot
  - editing the source question paper after scheduling did not change the already stored result
  - legacy exam results still calculated correctly through the fallback path

## What is intentionally not implemented yet

- Self-practice result scoring for versioned papers
- Post-exam solution review / solution unlock behavior
- Public student access to correct answers or solution media during the live attempt path

Those are intentionally deferred until the official version-based attempt and result path is considered stable.

## Next phase

1. Harden leaderboard policy so released leaderboards rely only on official version-based results.
2. Keep practice/self-practice separate from official exam scoring.
3. Add post-exam review and solution unlock only after the official path is locked and verified.
