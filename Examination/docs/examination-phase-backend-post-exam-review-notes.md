# Backend Phase Notes: Post-Exam Review

This phase adds the official student post-exam review path for released versioned exams.

## Added

- `GET /api/student/results/:attemptId/review`
- Protected review media streaming for QUESTION and SOLUTION media
- Review payloads built from the frozen question paper version snapshot
- Per-question review data:
  - student answer
  - correct answer
  - status
  - marks awarded
  - question media
  - solution media
- Review policy checks for student ownership, submission state, and result release

## Still legacy

- Legacy non-versioned exams are not reviewed by this new route
- Self-practice review is not implemented yet
- Teacher/admin review is deferred
- Live attempt answer leakage remains blocked by the live attempt routes

## Security and policy notes

- Review is only available after result release
- The review path does not use live editable paper rows
- QUESTION and SOLUTION media are both served through policy-checked review URLs
- Another student cannot open someone else’s review
- Active live attempts are blocked from review

## Next phase

- Keep the official attempt and review paths aligned with the frozen version model
- Add self-practice as a separate feature later
- Add teacher/admin review only if it becomes a product requirement
- Wire the Compose v2 review UI to this endpoint after the backend contract is stable
