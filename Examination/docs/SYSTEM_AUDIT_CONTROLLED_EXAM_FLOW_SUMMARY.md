# Controlled Exam Flow Summary

## Top 10 Risks

1. Assigned-paper generation can race when two students scan at nearly the same time.
2. Waiting-room package state is memory-only and disappears on app kill.
3. Secure mode can start while the assigned package is still preparing.
4. No teacher force-submit route was found.
5. Result release does not currently guarantee leaderboard regeneration in the same handler.
6. Frontend answer save still sends `version_question_id`, not `assigned_question_id`.
7. Polling every 3 seconds will become noisy with more devices.
8. Null backend fields can still break some UI mappings if not carefully normalized.
9. No durable offline review/package cache exists.
10. Kiosk-grade cheating prevention is not present on ordinary phones.

## Top 10 Good Parts

1. Assigned paper is built from an immutable question-paper version snapshot.
2. Assigned order is frozen and preserved through review.
3. Live package does not expose answers or solutions.
4. Review unlock is gated by result release and submitted attempt.
5. Answer save and submit are server-validated.
6. Result recalculation is server-side.
7. `FLAG_SECURE` is enabled during secure attempt mode.
8. Back attempts are blocked and logged.
9. Question media and solution media are separated by purpose and route.
10. Leaderboard reads stored official results rather than recalculating from mutable source questions.

## Top 10 Fixes

1. Add durable assigned-package storage on the student device.
2. Eliminate the generation race in assigned-paper creation.
3. Add teacher finalize/force-submit capability.
4. Regenerate leaderboard automatically at result release.
5. Include `assigned_question_id` in frontend save payloads.
6. Add an outbox/retry queue for offline answer saves.
7. Reduce polling or move to push updates.
8. Harden result/review null mappings everywhere.
9. Add checksum validation for the downloaded assigned package.
10. Add managed-device/kiosk controls if exam security must be stronger.

## Next Recommended Phase

Hardening phase, not a new feature phase:
- make assigned-paper delivery race-safe,
- add durable device-side package cache,
- and add server-side teacher finalize/force-submit.

