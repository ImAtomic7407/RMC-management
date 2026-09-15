# Examination Database Schema

This document describes the separate Examination backend schema foundation for the mobile exam system.

## Scope

The schema includes:
- authentication and user profiles
- identity bridge data
- exams and fixed three-section structure
- typed MCQ options
- question and solution media
- live attempts and results
- practice unlock tracking
- leaderboard caches
- audit logs

## Important rule reminders

- Exactly 3 fixed sections: Physics, Chemistry, Maths
- Question types are only MCQ and INTEGER
- MCQ options are typed manually
- No option images
- `question_media.purpose` only supports QUESTION and SOLUTION
- Solution media is policy-gated and hidden from live student payloads

