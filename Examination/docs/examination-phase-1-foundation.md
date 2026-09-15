# Examination Management System - Phase 1 Foundation

## 1. Final Architecture

The Examination Management System will be built as a **totally separate app/backend**.

### Components
- Separate Examination backend
- Separate Android Examination app
- Separate Examination database/schema
- Separate exam media storage
- Separate result and leaderboard engine
- Lightweight identity/roster sync bridge from the existing RMC system only

### Non-goals for this phase
- Do not build inside the existing RMC app
- Do not patch existing Attendance, Fees, Calling, Dashboard, or old report modules
- Do not create production APIs yet
- Do not create full Android screens yet
- Do not create final migrations yet

### Integration boundary
The only connection to the existing RMC world is a narrow identity/roster bridge that can verify or import:
- student UID
- student name
- student batch/class
- student active/inactive status
- teacher/admin identity
- teacher/admin active/inactive status

Everything else is owned by the Examination system itself.

---

## 2. What the Exam App Owns

The Examination app/backend owns all exam-domain functionality:
- auth/session for the exam app
- users
- teachers
- students
- batches/classes
- exams
- sections
- questions
- MCQ typed options
- integer answers
- media
- attempts
- results
- leaderboard
- analytics
- audit logs

This ownership includes:
- role enforcement
- answer evaluation
- timer handling
- autosave behavior
- solution image access control
- history and leaderboard calculations

---

## 3. What the Identity Bridge Imports/Verifies

The identity/roster bridge is intentionally lightweight.

It may verify or import:
- student UID
- student name
- batch/class
- active status
- teacher/admin identity
- active status

It must not become the source of truth for exam behavior, exam data, attempt state, or result generation.

---

## 4. Proposed Repository / Folder Structure

The Examination system should live in a clean separate structure:

```text
examination-system/
  examination-backend/
    src/
      modules/
        auth/
        identity/
        exams/
        sections/
        questions/
        media/
        attempts/
        results/
        leaderboard/
        analytics/
        audit/
    migrations/
    docs/
  examination-android/
    app/
    docs/
  examination-docs/
    api-contract.md
    schema-blueprint.md
    android-screen-flow.md
```

### Notes on the structure
- `examination-backend/` is the only backend for the exam product
- `examination-android/` is the only mobile app for the exam product
- `examination-docs/` holds shared design and contract references
- Existing RMC modules remain untouched

---

## 5. Future Table List and Purpose

This is the planned schema surface for the separate Examination database.

### `users`
Purpose:
- login identity for exam app roles

### `student_profiles`
Purpose:
- student identity linked to the exam app user record
- stores UID and batch linkage

### `teacher_profiles`
Purpose:
- teacher/admin identity linked to the exam app user record

### `batches`
Purpose:
- class, batch, or course grouping for exam assignment

### `identity_bridge`
Purpose:
- sync/verification bridge from the existing RMC roster source

### `exams`
Purpose:
- exam header
- mode, duration, policy, lifecycle state

### `exam_sections`
Purpose:
- fixed three-section structure for Physics, Chemistry, Maths
- section-level counts and default marks

### `questions`
Purpose:
- structured question record
- section, type, score rules, ordering, metadata

### `question_options`
Purpose:
- typed MCQ options
- source of truth for MCQ evaluation

### `question_media`
Purpose:
- question image and solution image storage references only

### `exam_assignments`
Purpose:
- assign exams to batches or specific students

### `exam_attempts`
Purpose:
- live attempt lifecycle
- start/end timestamps
- submission state

### `attempt_answers`
Purpose:
- student responses per question for live exams

### `attempt_section_results`
Purpose:
- Physics/Chemistry/Maths section-wise scoring

### `attempt_results`
Purpose:
- final rollup result snapshot for one attempt

### `practice_question_attempts`
Purpose:
- per-question unlock tracking in practice mode

### `leaderboard_entries`
Purpose:
- cached leaderboard rows for exam, batch, and overall scopes

### `exam_audit_logs`
Purpose:
- audit trail for exam actions and media access

---

## 6. Final Enum List

These enums are fixed for the Examination foundation.

### `user_role`
- `ADMIN`
- `TEACHER`
- `STUDENT`

### `user_status`
- `ACTIVE`
- `BLOCKED`
- `PENDING`

### `exam_status`
- `DRAFT`
- `PUBLISHED`
- `CLOSED`
- `RESULT_RELEASED`
- `ARCHIVED`

### `exam_mode`
- `LIVE`
- `PRACTICE`

### `solution_release_policy`
- `AFTER_EXAM_END`
- `AFTER_RESULT_RELEASE`
- `NEVER`
- `PRACTICE_UNLOCK_RULE`

### `section_code`
- `PHYSICS`
- `CHEMISTRY`
- `MATHS`

### `question_type`
- `MCQ`
- `INTEGER`

### `question_media_purpose`
- `QUESTION`
- `SOLUTION`

Important:
- `question_media_purpose` must **not** contain `OPTION`

### `attempt_status`
- `IN_PROGRESS`
- `SUBMITTED`
- `AUTO_SUBMITTED`
- `EXPIRED`
- `CANCELLED`

### `leaderboard_scope`
- `EXAM`
- `BATCH`
- `OVERALL`

---

## 7. Future Build Phases

The implementation will proceed in safe increments:

1. Backend project scaffold
2. Android project scaffold
3. Database schema/migrations
4. Auth/session
5. Identity/roster sync
6. Teacher exam creation
7. Section configuration
8. Question editor with typed MCQ options
9. Question image and solution image upload
10. Student exam attempt flow
11. Timer/autosave/submit
12. Evaluation engine
13. Practice solution unlock
14. Results/history
15. Leaderboard
16. Analytics/export
17. Security hardening

---

## 8. Product Rules That Must Stay Locked

These rules are non-negotiable for the Examination system:

- Every paper has exactly 3 fixed sections: Physics, Chemistry, Maths
- Teacher can set a custom question count for each section
- Teacher can add questions in any section and any order
- Only two question types exist: MCQ and INTEGER
- MCQ options are always typed manually by the teacher one by one
- There are no option images
- `question_media.purpose` only supports `QUESTION` and `SOLUTION`
- Question image is display-only
- Typed MCQ options are the source of truth for evaluation
- Integer answers are stored separately as structured answer data
- Solution image is hidden until allowed
- Live exam payload must never include solution image URL or correct answer
- Practice mode unlocks solution after correct answer or after 2 wrong attempts

---

## 9. Guardrails

The following guardrails must be maintained throughout implementation:

- Do not add option images anywhere
- Do not leak solution images before policy allows them
- Do not leak correct answers to the student live payload
- Do not grade from image text
- Do not depend on client-side timer trust
- Server must grade all answers
- Server must authorize solution-image access
- Existing RMC modules must not be modified
- Attendance, Fees, Calling, Dashboard, and old reports remain untouched

---

## 10. Phase 1 Deliverable

Phase 1 delivers the foundation only:
- a locked architecture decision
- a clean separate folder/repo blueprint
- the planned domain model
- fixed enums
- future phase sequencing
- non-negotiable product guardrails

No production code is created in this phase.
No production API is created in this phase.
No final migration is created in this phase.
No existing RMC file is modified in this phase.

