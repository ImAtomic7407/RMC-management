# Identity / Roster Bridge

This document describes the lightweight identity bridge for the separate Examination backend.

## Purpose

The bridge manages roster verification and import inside the Examination database only.

It is used to support future synchronization of:
- student UID
- student name
- student batch/class
- student active/inactive status
- teacher/admin identity
- teacher/admin active/inactive status

## Supported workflows

### Health
`GET /api/identity/health`

Returns:
- database readiness
- identity bridge readiness

### Batch upsert
`POST /api/identity/batches/upsert`

Creates or updates batch records by unique batch name.

### Student verification
`POST /api/identity/students/verify`

Checks whether a student record already exists in the Examination database.

### Student import
`POST /api/identity/students/import`

Creates or updates the batch, user, profile, and identity bridge row for student roster records.

### Teacher/admin verification
`POST /api/identity/teachers/verify`

Checks whether a teacher/admin record already exists in the Examination database.

### Teacher/admin import
`POST /api/identity/teachers/import`

Creates or updates the user, teacher profile, and identity bridge row for teacher/admin roster records.

## Rules

- All routes require auth
- Admin-only routes are required for mutation/import actions
- Routes fail gracefully with `503` when the schema is not actually ready
- No RMC production module is touched
- No exam creation, question, attempt, or answer APIs are introduced here

## Important limitation

Because Phase 3 migration application still reports `schemaReady: false` in this environment, the bridge code is built to protect itself:
- health can report readiness
- mutation routes refuse to operate until the schema is ready

