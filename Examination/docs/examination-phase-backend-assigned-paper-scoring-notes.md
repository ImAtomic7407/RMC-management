Backend Phase Notes: Assigned Paper Scoring

This phase hardens official result calculation so it scores from the student's assigned paper instance rather than from mutable source paper questions.

Added
- assigned-paper-first result recalculation
- answer metadata support for assigned_question_id and version_question_id
- result snapshot traceability with assigned_paper_instance_id
- review order compatibility with the assigned paper
- leaderboard compatibility with stored official result rows

Smoke test
- exam 14 was used as the smoke target
- student 1 and student 2 received different assigned question orders
- both attempts were scored from their own assigned paper instance
- the official result rows stored `assigned_paper_instance_id`
- review opened using the assigned order after result release
- leaderboard regenerated from stored result rows only

Validation
- Prisma validate passed
- Prisma migrate dev applied `harden_assigned_paper_scoring`
- Prisma generate passed after stopping the backend lock on Windows
- Typecheck passed
