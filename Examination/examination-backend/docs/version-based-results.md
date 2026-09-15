# Version-Based Results

This module now scores scheduled/versioned exams from the frozen `question_paper_version_*` tables instead of the editable source paper tables.

## Path selection

- If `exams.question_paper_version_id` is present, result recalculation uses the frozen version snapshot.
- If `exams.question_paper_version_id` is null, the legacy live `questions` / `question_options` path is used.

## Frozen scoring source

For versioned exams, recalculation reads from:

- `question_paper_version_sections`
- `question_paper_version_questions`
- `question_paper_version_options`
- `question_paper_version_media` only for metadata storage, not score logic

Stored result rows now keep:

- `evaluated_question_paper_version_id`
- `evaluated_question_paper_version_number`
- `scoring_source`

## Answer mapping

Existing attempt answers are still stored in the legacy compatibility tables.

- `attempt_answers.question_id` is mapped back to the frozen version question using `original_question_id`
- If needed, a fallback mapping by `section_code + question_order` is used
- `attempt_answers.selected_option_id` is mapped to the frozen version option using `original_option_id`
- If needed, a fallback label match is used

## Scoring rules

### MCQ

- Exactly one frozen correct option is read from `question_paper_version_options.is_correct = true`
- Correct answer: award `marks`
- Wrong answer: subtract `negative_marks`
- Unattempted: `0`

### INTEGER

- Correct integer answer is read from `question_paper_version_questions.correct_integer_answer`
- Student answer is canonicalized before comparison
- Correct answer: award `marks`
- Wrong answer: subtract `negative_marks`
- Unattempted: `0`

## Stored snapshot data

The recalculated result persists:

- `total_score`
- `max_score`
- `percentage`
- `correct_count`
- `wrong_count`
- `unattempted_count`
- section-wise scores and counts
- evaluated version metadata

## What is not implemented yet

- Self-practice result flow for versioned exams
- Post-exam solution review flow
- Public solution media exposure rules

Those are intentionally deferred until the official version-based attempt path is fully validated.
