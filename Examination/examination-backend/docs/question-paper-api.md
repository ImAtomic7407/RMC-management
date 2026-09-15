# Question Paper API

This backend phase introduces a new source-paper model for the Examination system.

## Purpose

- Question Papers are editable reusable source templates.
- Exams are scheduled snapshots created from a selected Question Paper.
- The scheduled exam stores a frozen `question_paper_version` so later source edits do not change old exams.

## Core rules

- Exactly three fixed sections are used:
  - `PHYSICS`
  - `CHEMISTRY`
  - `MATHS`
- Question types are only:
  - `MCQ`
  - `INTEGER`
- MCQ options are always fixed `A/B/C/D`.
- Option text is optional.
- Only two media purposes are allowed:
  - `QUESTION`
  - `SOLUTION`
- No option image support exists.
- Question papers can optionally be practice-enabled for self-study mode:
  - `is_self_practice_enabled`
  - `self_practice_duration_seconds`
  - `self_practice_solution_policy`
  - practice attempts are created through separate self-practice routes and remain not ranked

## Routes

### Question Papers

#### `GET /api/question-papers`
List source papers for teacher/admin users.

Query:
- `include_archived` optional boolean, defaults to `true`

Response:
```json
{
  "status": "success",
  "count": 1,
  "question_papers": []
}
```

#### `POST /api/question-papers`
Create a new editable source paper.

Request:
```json
{
  "title": "JEE Mock Paper 1",
  "batch_id": 1,
  "category": "JEE",
  "instructions": "Read all questions carefully.",
  "sections": [
    {
      "section_code": "PHYSICS",
      "question_count_target": 30,
      "default_marks": 4,
      "default_negative_marks": 1
    },
    {
      "section_code": "CHEMISTRY",
      "question_count_target": 30,
      "default_marks": 4,
      "default_negative_marks": 1
    },
    {
      "section_code": "MATHS",
      "question_count_target": 30,
      "default_marks": 4,
      "default_negative_marks": 1
    }
  ]
}
```

Validation:
- If `sections` is omitted, backend creates sane defaults for all three fixed sections.
- If provided, all three sections must be present exactly once.
- Duplicate section codes are rejected.

#### `GET /api/question-papers/:paperId`
Get paper detail with section summaries and question counts.

#### `PATCH /api/question-papers/:paperId`
Update title, category, instructions, or section defaults.

#### `DELETE /api/question-papers/:paperId`
Archive the source paper.

### Paper Questions

#### `GET /api/question-papers/:paperId/questions`
List editable source questions.

Response includes:
- question metadata
- MCQ options
- QUESTION/SOLUTION media metadata
- marks/negative marks
- active flag

#### `POST /api/question-papers/:paperId/questions`
Create a source question.

MCQ rules:
- must include exactly four options
- must include exactly one correct option label

INTEGER rules:
- must include an integer answer
- decimals are rejected
- normalization is applied:
  - `042` -> `42`
  - `+42` -> `42`
  - `-0042` -> `-42`

#### `GET /api/question-papers/:paperId/questions/:questionId`
Get one source question with options and media metadata.

#### `PATCH /api/question-papers/:paperId/questions/:questionId`
Update a source question.

#### `DELETE /api/question-papers/:paperId/questions/:questionId`
Soft delete by setting `is_active = false`.

#### `POST /api/question-papers/:paperId/questions/reorder`
Reorder questions within a section.

### Paper Media

#### `GET /api/question-papers/:paperId/questions/:questionId/media`
List media metadata for a source question.

#### `GET /api/question-papers/:paperId/questions/:questionId/media/:mediaId`
Stream image bytes for a specific media row.

#### `POST /api/question-papers/:paperId/questions/:questionId/media`
Upload new source question media.

#### `PUT /api/question-papers/:paperId/questions/:questionId/media/:mediaId`
Replace an existing media row with a new uploaded file.

#### `DELETE /api/question-papers/:paperId/questions/:questionId/media/:mediaId`
Delete a media row and its file.

Media validation:
- JPEG
- PNG
- WEBP

Storage:
- `uploads/question-paper-media/question/`
- `uploads/question-paper-media/solution/`

## Schedule Exam

### `POST /api/exams/schedule`
Create a scheduled exam from the current source paper state.

Request:
```json
{
  "question_paper_id": 1,
  "title": "JEE Mock Test 1",
  "batch_id": 1,
  "exam_mode": "LIVE",
  "scheduled_at": "2026-06-01T10:00:00.000Z",
  "duration_seconds": 10800,
  "solution_release_policy": "AFTER_RESULT_RELEASE"
}
```

Behavior:
1. Validate the source paper exists and is not archived.
2. Validate all three sections exist.
3. Validate there is at least one active question.
4. Create a new immutable `question_paper_versions` row.
5. Copy sections, active questions, MCQ options, and media metadata into version tables.
6. Create an exam referencing:
   - `question_paper_id`
   - `question_paper_version_id`

Important:
- The version is immutable after creation.
- Editing the source paper later does not change the scheduled exam.

## Transition notes

- The old live exam/question tables remain in the backend for transition safety.
- Student attempt/result/leaderboard migration to version tables is a later phase.
- This phase focuses on source paper editing and frozen scheduling only.
- Self-practice is a separate student flow built on frozen versions and is excluded from official leaderboards and official result lists.
