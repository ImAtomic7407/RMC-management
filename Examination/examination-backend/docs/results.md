# Results

This module calculates and serves exam results after submission.

## Includes

- MCQ scoring using structured typed options
- Integer scoring using canonicalized integer comparison
- Section-wise result snapshots for Physics, Chemistry, and Maths
- Total score, count breakdown, and percentage
- Teacher/admin result list and detail views
- Student own result views after result release
- Version-aware scoring for scheduled exams that uses frozen question paper version tables

## Excludes

- Leaderboards
- Practice solution unlock
- Public solution media access
- Question image grading

## Notes

- Negative marking is supported.
- Total score may be negative if the marking scheme produces that outcome.
- Recalculation is idempotent and replaces existing section/result snapshots transactionally.
- For versioned exams, recalculation uses frozen `question_paper_version_*` data and stores version metadata on `attempt_results`.
- Legacy exams without a version still use the original live `questions` path.
