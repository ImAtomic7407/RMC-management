# Post-Exam Review

This module serves the official post-exam review experience for released versioned exams.

## Supported route

- `GET /api/student/results/:attemptId/review`

## Policy rules

Review is allowed only when all of the following are true:

- The attempt belongs to the authenticated student.
- The attempt is submitted.
- The exam result is released.
- The attempt has a stored result row.
- The exam is a versioned exam with `question_paper_version_id`.
- The review is built from the frozen `question_paper_version_*` snapshot, not from mutable source questions.

Review is blocked for:

- Another student’s attempt
- Active/in-progress live attempts
- Unreleased exams
- Legacy exams without a frozen question paper version
- Any attempt without a stored official result

## Response shape

The response is designed for the future Android v2 review UI.

Top-level payload:

- `attempt_id`
- `exam_id`
- `exam_title`
- `exam_mode`
- `question_paper_version_id`
- `question_paper_version_number`
- `student`
- `summary`
- `sections`

Student payload:

- `id`
- `name`

Summary payload:

- `total_score`
- `max_score`
- `percentage`
- `rank`
- `correct_count`
- `wrong_count`
- `unattempted_count`

Section payload:

- `section_code`
- `section_title`
- `section_order`
- `score`
- `max_score`
- `correct_count`
- `wrong_count`
- `unattempted_count`
- `questions[]`

Question payload:

- `version_question_id`
- `question_order`
- `question_type`
- `question_text`
- `question_media[]`
- `options[]`
- `student_answer`
- `correct_answer`

## Assigned order note

When an assigned paper exists, the review payload preserves the student's frozen delivery order:

- `assigned_question_id`
- `student_question_order`
- `section_question_order`
- `original_question_order`

The review screen must not reorder questions client-side back into source-paper order.
- `status`
- `marks_awarded`
- `max_marks`
- `negative_marks`
- `solution`

## Versioned data source

For versioned exams, review reads from:

- `question_paper_version_sections`
- `question_paper_version_questions`
- `question_paper_version_options`
- `question_paper_version_media`
- `attempt_answers`
- `attempt_results`
- `attempt_section_results`

It does not read answer keys from:

- editable `paper_questions`
- editable `paper_question_options`
- the current source paper
- any live mutable paper state

## Answer/status rules

### MCQ

- No selected answer: `UNATTEMPTED`
- Selected option matches frozen correct option: `CORRECT`
- Any other selected option: `WRONG`

### INTEGER

- No integer answer: `UNATTEMPTED`
- Normalized student integer matches frozen answer: `CORRECT`
- Otherwise: `WRONG`

Scoring mirrors the official version-based result calculation.

## Media access rules

Review media is streamed only after the policy checks pass.

- QUESTION media is served from the frozen version media rows.
- SOLUTION media is served from the frozen version media rows.
- No direct storage path is exposed to the client.
- The media endpoints verify the authenticated student, the attempt ownership, the review policy, the version question, and the media purpose.

Routes:

- `GET /api/student/results/:attemptId/review/questions/:versionQuestionId/media/:mediaId`
- `GET /api/student/results/:attemptId/review/questions/:versionQuestionId/solution/:mediaId`

## Android v2 expectations

The future Compose v2 review screen should be able to render:

- top summary card
- section tabs for Physics / Chemistry / Maths
- question review cards
- selected answer highlight
- correct answer highlight
- marks gained/lost
- expandable solution area
- scrollable solution media
- optional explanation text placeholder when available later

## Notes

- Self-practice review is handled by separate `practice` routes and uses the frozen practice attempt/version tables, not this official exam review path.
- Post-exam review is intentionally separate from the live attempt path.
- Teacher/admin review can be added later if required, but it is deferred for now.
