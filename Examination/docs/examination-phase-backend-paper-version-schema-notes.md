# Examination Backend Phase A Notes

This note captures the first backend schema phase for the Examination system.

## Goal of this phase

Add the schema foundation for:

- editable Question Papers
- immutable Question Paper Versions
- Exams referencing frozen paper versions

This phase is intentionally limited to the backend schema and migration layer.

## What changed

### New source paper tables

- `question_papers`
- `question_paper_sections`
- `paper_questions`
- `paper_question_options`
- `paper_question_media`

### New immutable snapshot tables

- `question_paper_versions`
- `question_paper_version_sections`
- `question_paper_version_questions`
- `question_paper_version_options`
- `question_paper_version_media`

### Exam transition fields

The `exams` table now includes nullable:

- `question_paper_id`
- `question_paper_version_id`

These fields allow the backend to transition toward immutable scheduled exams without breaking the current live schema immediately.

## Why this matters

The previous model let an exam own editable live question rows directly.

That is not safe for scheduled conducted exams because:

- a source paper can be edited later
- older exams must not change after scheduling
- student attempts/results must remain tied to the frozen version used at schedule time

## What still remains for later phases

Not yet implemented in this phase:

- schedule API snapshot creation
- question paper CRUD APIs
- paper media/version media CRUD APIs
- student attempt migration to version tables
- result/leaderboard migration to version tables

## Validation status

This phase was validated with:

- `npm run typecheck`
- `npx prisma validate`
- `npx prisma generate`
- `npx prisma migrate dev --name add_question_paper_versions`

The migration was applied successfully and Prisma Client was regenerated.

## Next phase recommendation

Implement the schedule-exam API so it:

1. reads a source question paper
2. creates a frozen question paper version
3. creates an exam that references that version
4. preserves the old live tables only for compatibility during transition
