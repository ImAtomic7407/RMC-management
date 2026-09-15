# Question Paper Version Schema

This document describes the backend schema foundation for editable Question Papers and immutable Question Paper Versions.

## Why this exists

The Examination system now needs two separate concepts:

- **Question Paper**: editable source/template that can be reused and edited later
- **Question Paper Version**: immutable frozen snapshot captured when an exam is scheduled

An Exam now references the frozen version, not only the live editable paper.

## What was added

### Source paper tables

- `question_papers`
- `question_paper_sections`
- `paper_questions`
- `paper_question_options`
- `paper_question_media`

### Immutable version tables

- `question_paper_versions`
- `question_paper_version_sections`
- `question_paper_version_questions`
- `question_paper_version_options`
- `question_paper_version_media`

### Exam link

The `exams` table now has nullable transition fields:

- `question_paper_id`
- `question_paper_version_id`

These fields let the backend move toward snapshot-driven exams without deleting the current live exam model yet.

## Source paper model summary

### `question_papers`

Stores the editable reusable source paper.

Important columns:

- `title`
- `batch_id`
- `category`
- `status` (`DRAFT`, `ARCHIVED`)
- `instructions`
- `created_by`
- timestamps

### `question_paper_sections`

Stores the fixed three-section layout for a paper.

Important columns:

- `question_paper_id`
- `section_code` (`PHYSICS`, `CHEMISTRY`, `MATHS`)
- `section_order`
- `question_count_target`
- `default_marks`
- `default_negative_marks`

### `paper_questions`

Stores editable questions belonging to a source paper.

Important columns:

- `question_paper_id`
- `section_code`
- `question_type` (`MCQ`, `INTEGER`)
- `question_order`
- `question_text`
- `correct_integer_answer`
- `marks`
- `negative_marks`
- `is_active`
- `created_by`
- timestamps

### `paper_question_options`

Stores MCQ options for the editable paper question.

Important columns:

- `paper_question_id`
- `option_label` (`A`, `B`, `C`, `D`)
- `option_text`
- `option_order`
- `is_correct`

### `paper_question_media`

Stores editable media attached to a source question.

Important columns:

- `paper_question_id`
- `purpose` (`QUESTION`, `SOLUTION`)
- `storage_url`
- `mime_type`
- `checksum`
- `width`
- `height`
- `sort_order`
- `uploaded_by`

## Version/snapshot model summary

### `question_paper_versions`

Stores the immutable snapshot metadata for a source paper.

Important columns:

- `question_paper_id`
- `version_number`
- `title_snapshot`
- `instructions_snapshot`
- `created_from_status`
- `created_by`
- `created_at`

### `question_paper_version_sections`

Stores the frozen section defaults for the version.

### `question_paper_version_questions`

Stores frozen question rows copied from the source paper.

Important columns:

- `version_id`
- `original_question_id`
- `section_code`
- `question_type`
- `question_order`
- `question_text`
- `correct_integer_answer`
- `marks`
- `negative_marks`
- `is_active_snapshot`

### `question_paper_version_options`

Stores frozen MCQ option rows copied from the source paper.

### `question_paper_version_media`

Stores frozen media metadata copied from the source paper.

Important columns:

- `version_question_id`
- `original_media_id`
- `purpose`
- `storage_url`
- `mime_type`
- `checksum`
- `width`
- `height`
- `sort_order`
- `created_at`

## How exams now fit

The `exams` table now has:

- `question_paper_id`
- `question_paper_version_id`

The intended future flow is:

1. Teacher edits a source `question_papers` record.
2. Teacher schedules an exam from that paper.
3. Backend creates a new immutable `question_paper_versions` row.
4. The exam stores the frozen version id.
5. Student attempts and results are eventually based on the frozen version tables.

## What is not migrated yet

This phase only creates the schema foundation.

Not yet moved:

- exam scheduling service logic
- student attempt read/write logic
- results computation
- leaderboard computation
- API routes for paper/version CRUD
- media duplication/versioning workflow

The old live exam/question model still exists for transition safety.

## Constraints and indexes

The schema includes unique constraints and indexes for:

- one section per paper per section code
- one option label per question
- one version number per source paper
- one section per version per section code
- fast lookup by creator, status, section order, and question order

## Next phase

The next backend phase should:

1. add schedule-exam logic that creates a frozen version
2. switch exam read paths to version tables
3. switch student attempt/result/leaderboard logic to version tables
4. keep the existing live tables during transition until the new flow is fully verified
