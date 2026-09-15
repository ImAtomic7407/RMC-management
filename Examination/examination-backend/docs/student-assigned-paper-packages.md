# Student Assigned Paper Packages

This backend phase turns the official exam paper into a student-specific assigned package at QR verification time.

## Why this exists

A question paper is treated as a pool. The scheduled exam delivers a frozen subset and order per student so students do not all receive the exact same visible sequence.

The goals are:

- keep the official paper frozen
- reduce same-time same-question overlap
- support later offline review
- keep live answers/solutions locked until policy allows unlock

## Models

### `student_exam_paper_instances`

One frozen assigned package per student per exam.

Key fields:

- exam id
- student id
- gate session id
- question paper version id
- assigned student number
- variant seed
- package status
- review lock status
- package checksums

### `student_exam_paper_questions`

One row per delivered question in the assigned package.

Key fields:

- assigned question id
- version question id
- section code
- student question order
- section question order
- original question order

## Selection and shuffle

The generation algorithm is deterministic and uses:

- exam id
- student id
- gate session id
- assigned student number
- version id
- server salt

Default delivery rules are section based:

- deliver the configured target count when available
- if available questions are fewer than target, deliver what exists and attach a warning
- if extra questions exist, use a rotated subset with deterministic shuffling

This gives students different assigned order where possible while keeping the package stable forever after generation.

## Live package

The safe live package includes:

- question text
- question media metadata
- option labels and option text
- assigned question id
- version question id
- student question order
- section order
- timer metadata

The live package does not include:

- correct option
- correct integer answer
- solution media
- explanation text
- answer key
- unlock key

## Locked review package

The locked review contract exists immediately, but the package stays locked until the result/review policy allows unlock.

Current contract fields:

- lock status
- checksum
- key id
- encrypted-payload availability flag

The backend does not expose the raw unlock key before release.

## Unlock

`GET /api/student/exams/:examId/assigned-paper/review-unlock?device_id=...`

Unlock is only allowed when:

- the student belongs to the exam
- QR verification has completed
- the device matches the verified session
- the exam result/review policy allows release
- the attempt is submitted
- the result exists

## Compatibility notes

- Existing official review paths now sort by assigned question order when an assigned paper exists.
- The safe live download payload also uses the assigned paper order.
- Selected-question reattempt is not part of this phase.

## Official scoring

Official result calculation is now assigned-paper-first:

1. `student_exam_paper_instances`
2. `student_exam_paper_questions`
3. frozen `question_paper_version_questions`
4. frozen `question_paper_version_options`
5. saved `attempt_answers`

This means:

- students can receive different question orders
- students can receive different subsets when extra questions exist
- the stored official result is recalculated from the assigned paper rows
- `assigned_paper_instance_id` is stored in the official result snapshot for traceability
- mutable source paper questions are no longer the official scoring source

## Future work

- offline PDF export of the unlocked review package
- secure Android exam mode
- result-time unlock policy automation if needed
