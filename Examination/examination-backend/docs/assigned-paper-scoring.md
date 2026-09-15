# Assigned Paper Scoring

Official exam scoring is now assigned-paper-first.

## Why this exists

A versioned official exam is not one identical question order for every student. Each verified student gets a frozen assigned paper instance that can differ in selection and order.

Scoring must therefore be based on the assigned paper rows, not on editable source paper questions.

## Official scoring source

Final scoring uses:

1. `student_exam_paper_instances`
2. `student_exam_paper_questions`
3. `question_paper_version_questions`
4. `question_paper_version_options`
5. saved `attempt_answers`

## Answer id mapping

The backend accepts answer saves using:

- `assigned_question_id`
- `version_question_id`
- `question_id` for legacy compatibility

For official exams, the backend stores enough metadata to map each answer back to the assigned paper instance and the frozen version question.

## Final answer sheet concept

At submit time, the backend reconstructs a final answer sheet for the student containing:

- `attempt_id`
- `exam_id`
- `student_id`
- `device_id`
- `assigned_paper_instance_id`
- ordered answers by `student_question_order`
- question type, selected option, integer answer, and section metadata

## Result calculation

For each assigned question:

- no answer => `UNATTEMPTED`
- MCQ => compare against frozen version option data
- INTEGER => compare against frozen version integer answer

The official result stores:

- `total_score`
- `max_score`
- `percentage`
- `correct_count`
- `wrong_count`
- `unattempted_count`
- section totals
- `evaluated_question_paper_version_id`
- `evaluated_question_paper_version_number`
- `assigned_paper_instance_id`

## Review order rule

Student review uses the assigned paper order:

- `student_exam_paper_questions.student_question_order`

The review screen must not reorder back to source-paper order.

## Leaderboard rule

Leaderboard generation uses stored official result rows only.

It does not recalculate from mutable source questions and does not include practice attempts.

## Teacher close and timer-end compatibility

The same assigned-paper scoring path is reusable for:

- student submit
- timer-end auto-submit
- future teacher force-submit

## Future work

- offline review package unlocking
- PDF export of the unlocked review package
- practice / not-ranked full-paper retest flow
