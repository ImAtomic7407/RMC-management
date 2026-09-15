# Student Attempts

This module handles student-facing exam access and live attempt flow.

## Supported routes

- `GET /api/student/exams`
- `GET /api/student/exams/:examId`
- `POST /api/student/exams/:examId/start`
- `PATCH /api/student/attempts/:attemptId/answers`
- `POST /api/student/attempts/:attemptId/submit`
- `GET /api/student/exams/:examId/questions/:questionId/media/:mediaId`

## Safety rules

- Only students may access these routes
- Solution images are never exposed
- Correct answers are never exposed
- MCQ options are returned without correctness flags
- Integer answers are not returned
- Time checks are enforced server-side

