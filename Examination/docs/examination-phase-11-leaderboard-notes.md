# Phase 11 Leaderboard Notes

## Added

- Cached exam leaderboard generation
- Cached batch leaderboard generation
- Cached overall leaderboard generation
- Teacher/admin leaderboard viewing routes
- Student leaderboard route with release gating
- Rank fields surfaced in student result history

## Scope rules

- Exam and batch leaderboards use stored attempt result snapshots.
- Overall leaderboard aggregates released results across exams.
- Student leaderboard visibility is restricted to released results.

## Storage notes

- `leaderboard_entries` stores one cached row per ranked entry.
- Existing scope rows are deleted before regeneration.
- Exam and batch scopes use `attempt_id` as the deterministic INT-safe tie-break value.
- Overall scope uses `exams_count` as the tie-break value.

## Not added

- Practice unlock
- Android UI
- Export/PDF
- Option image support

