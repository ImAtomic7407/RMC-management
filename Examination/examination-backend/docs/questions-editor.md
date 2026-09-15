# Question Editor API

This document defines the teacher/admin question editor foundation for the separate Examination backend.

## Scope

- Add MCQ questions with typed options
- Add INTEGER questions with structured answers
- List questions for an exam
- Get question detail for teacher/admin editing
- Update draft questions
- Deactivate draft questions
- Reorder questions inside each section

## Rules enforced

- All routes require authentication
- Only `ADMIN` and `TEACHER` may use these routes
- Questions can only be edited while the parent exam is in `DRAFT`
- Questions must belong to one of the three fixed sections:
  - PHYSICS
  - CHEMISTRY
  - MATHS
- MCQ options are typed manually
- No option images
- No media upload in this phase
- Structured data remains the source of truth for grading later

## Draft-only behavior

- Create is allowed only when exam status is `DRAFT`
- Update is allowed only when exam status is `DRAFT`
- Deactivate is allowed only when exam status is `DRAFT`
- Reorder is allowed only when exam status is `DRAFT`

## Validation

- MCQ requires typed options and a matching correct option label
- INTEGER requires a structured integer answer
- Section question counts must not exceed the configured section target

