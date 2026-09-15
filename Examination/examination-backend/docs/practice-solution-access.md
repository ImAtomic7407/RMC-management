# Practice and Solution Access

Phase 12 adds the student-side unlock and solution-access foundation for the separate Examination backend.

## Supported behaviors

- Practice-mode answer checking for MCQ and INTEGER questions.
- Per-student, per-exam, per-question unlock tracking in `practice_question_attempts`.
- Unlock solution access after:
  - a correct answer, or
  - two wrong answers.
- Student solution access for practice questions only after unlock.
- Live-exam solution access only when the exam policy allows it.
- Solution media stays hidden during active live exams.

## Endpoints

- `POST /api/student/practice/questions/:questionId/check`
- `GET /api/student/practice/questions/:questionId/solution`
- `GET /api/student/practice/questions/:questionId/solution/:mediaId`
- `GET /api/student/exams/:examId/questions/:questionId/solution`
- `GET /api/student/exams/:examId/questions/:questionId/solution/:mediaId`

## Access rules

### Practice mode

- Correct answer unlocks the solution immediately.
- First wrong answer keeps the solution locked.
- Second wrong answer unlocks the solution.
- Unlock is stored per student/question/exam and persists until reset by admin.

### Live exam mode

- Solution media is not returned in active exam paper payloads.
- `AFTER_EXAM_END` allows access after the exam is closed or the result is released.
- `AFTER_RESULT_RELEASE` allows access only after result release.
- `NEVER` blocks student access.
- `PRACTICE_UNLOCK_RULE` is reserved for practice mode and is rejected for live student solution access.

## Security notes

- No option images exist.
- `question_media.purpose` remains only `QUESTION` and `SOLUTION`.
- Student solution routes are authenticated and do not expose public unauthenticated URLs.
- Student live exam payloads still do not expose correct answers or solution media metadata.
