# Backend Phase Notes: Version-Based Leaderboard

This phase hardens official leaderboard generation so it relies only on released exam results and stored snapshot metadata.

## Added

- Official-only leaderboard filtering for released exams
- Version-aware leaderboard handling for scheduled/versioned exams
- Stored result metadata usage:
  - `evaluated_question_paper_version_id`
  - `evaluated_question_paper_version_number`
  - `scoring_source`
- Competition ranking for exam and batch leaderboards
- Overall leaderboard aggregation from released result rows only
- Student-visible leaderboard gating to released exams/results

## Still legacy

- Older exams without `question_paper_version_id` still use the legacy stored result path
- Attempt storage still uses the legacy compatibility columns
- Leaderboard regeneration still consumes stored result rows; it does not recalculate from editable paper tables

## Future exclusion policy

The leaderboard code is now structured so it can later exclude:

- `SELF_PRACTICE` attempts
- personal practice results
- not-ranked attempts
- any unofficial practice-only result rows

Those flows are not implemented yet, but the official leaderboard policy now leaves room for them without mixing them into exam rankings.

## Validation completed

- Released versioned exam leaderboard regeneration succeeded
- Legacy exam leaderboard regeneration succeeded
- Student leaderboard view succeeded for a released versioned exam
- Result rows surfaced version metadata correctly

## Next phase

- Keep leaderboard policy aligned with official released exam results only
- Add self-practice separately when that flow is introduced
- Add post-exam review / solution unlock only after the official attempt path remains stable
