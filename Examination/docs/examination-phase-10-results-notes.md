# Phase 10 Result Notes

## Created

- Scoring engine
- Section result snapshots
- Attempt result snapshots
- Teacher/admin result list and detail routes
- Student own result visibility after result release
- Manual recalculate endpoint for admin or teacher use

## Not created

- Leaderboard generation
- Leaderboard APIs
- Practice unlock flow
- Student solution media access
- Android UI

## Safety

- Results use structured answer data only
- MCQ evaluation uses `question_options.is_correct`
- Integer evaluation uses canonicalized comparison against `correct_integer_answer`
- Question image text is never used for scoring
- Student result visibility stays conservative until exam result release

