Backend Phase Notes: Student Assigned Paper Packages

This phase introduces student-specific assigned paper instances for official exams.

Added
- deterministic student-specific assigned paper creation during QR verification
- per-student question selection and question ordering
- safe live package download payload
- locked review package contract
- review unlock endpoint contract
- official review compatibility with assigned order

Key rules
- the assigned package is frozen forever after generation
- live payload never exposes correct answers or solutions
- unlock is blocked until the exam result/review policy allows it
- selected-question reattempt is not implemented

Smoke test
- scheduled exam was started manually
- two students were QR verified on the same exam
- each student received a different assigned question order
- the download payload matched the assigned package
- the locked review package stayed locked
- review unlock was blocked before release with `REVIEW_NOT_RELEASED`

Validation
- Prisma validate passed
- Prisma generate passed after briefly stopping the backend process on Windows
- Typecheck passed
