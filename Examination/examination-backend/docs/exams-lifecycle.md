# Exam Lifecycle API

This document defines the teacher/admin exam lifecycle foundation for the separate Examination backend.

## Scope

- Create exam with the required three sections
- List exams
- Get exam details
- Publish exam
- Close exam
- Release exam result

## Rules enforced

- Exactly three sections are required:
  - PHYSICS
  - CHEMISTRY
  - MATHS
- Only `LIVE` and `PRACTICE` exam modes are accepted
- Only solution policies:
  - `AFTER_EXAM_END`
  - `AFTER_RESULT_RELEASE`
  - `NEVER`
  - `PRACTICE_UNLOCK_RULE`
- All routes require authentication
- Only `ADMIN` and `TEACHER` may access these routes
- Schema readiness is checked before DB-backed operations

## Important note

This phase does **not** add question editor APIs, media upload APIs, student attempt APIs, or grading/result engine logic.

## Lifecycle statuses

- `DRAFT`
- `PUBLISHED`
- `CLOSED`
- `RESULT_RELEASED`

