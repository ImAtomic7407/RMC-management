# Examination Management System - Phase 3 Schema Notes

## What was created

- Prisma-based schema foundation for the separate Examination backend
- SQLite datasource for local development
- Enum definitions for exam roles, status, modes, sections, question types, media purposes, attempt states, leaderboard scopes, and audit actor roles
- Full model set for users, profiles, batches, identity bridge, exams, sections, questions, options, media, assignments, attempts, results, practice tracking, leaderboards, and audit logs
- Prisma client helper in backend shared code
- Basic database readiness check on `/health`
- Schema documentation file in backend docs

## What was intentionally not created

- No production exam APIs
- No Android UI
- No auth login logic
- No identity sync runtime
- No teacher/student feature flows
- No option image support
- No student payloads exposing correct answers or solution media

## Separation from RMC

This schema work is isolated inside:

`A:\RMC_Local_Installer\Examination\examination-backend`

It does not modify the existing RMC app/backend modules, and it does not touch:
- Attendance
- Fees
- Calling
- Dashboard
- old reports

## Next phase

Next recommended phase:
1. Auth/session foundation

That phase should build the exam-app login/session layer and the first identity verification bridge on top of this schema.
