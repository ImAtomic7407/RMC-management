# Controlled Exam Hardening Phase

## Current focus
- Assigned-paper delivery is durable on the device.
- Secure start remains backend-authorized.
- Answer changes now persist to a local outbox before backend sync.
- Unsynced answers are blocked from final submit.

## What still stays server-authoritative
- Attempt start and resume
- Attempt finalization
- Result calculation
- Review unlock
- Leaderboards

## Remaining limitations
- Question/package cache is file-based, not Room-based.
- Answer outbox is file-based, not Room-based.
- Kiosk-grade anti-cheat still depends on normal Android best-effort controls.
