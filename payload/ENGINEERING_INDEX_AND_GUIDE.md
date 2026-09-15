# RMC Attendance System - Engineering Index and Guide

Last updated: 2026-04-07

This document is the fast navigation map for backend/frontend ownership, route contracts, and common failure points.
Use this first before deep-diving `server.js` or large EJS files.

## 1) Core File Index

### Backend
- `payload/server/server.js`
  - Main API surface, auth middleware, material/notice/session logic, live stream events.
  - Key anchors:
    - `buildWeeklyAttendanceReport` (~line 1962)
    - `listMaterials` (~line 2606)
    - `resolveMaterialBatchId` (~line 2616)
    - `enrichMaterialRecord` (~line 2638)
    - `closeSessionById` (~line 2733)
    - `GET /api/live/stream` (~line 3268)
    - `GET /api/student/materials` (~line 3818)
    - `GET /api/student/notices` (~line 3851)
    - `GET /api/student/notices/:id` (~line 3904)
    - `POST /api/materials/upload` (~line 4881)
    - `POST /api/materials` (~line 4904)
    - `GET /api/notices` (~line 5003)
    - `POST /api/notices` (~line 5013)
    - `POST /api/sessions/:id/close` (~line 5178)
    - `POST /api/sessions/close` (~line 5188)

### Frontend (Student)
- `payload/views/student_portal.ejs`
  - Student tabs, materials/notices rendering, live update client, scoreboard.
  - Key anchors:
    - `section-identity` (~line 51)
    - `section-materials` (~line 334)
    - `material-list` (~line 340)
    - `section-notices` (~line 350)
    - `notice-list` (~line 356)
    - `notice-detail` (~line 368)
    - `initLiveUpdates` (~line 485)
    - `loadMaterialsSection` (~line 826)
    - `loadNoticeSections` (~line 852)
    - `loadNoticeDetail` (~line 912)
    - `new ZenPillars(...)` (~line 970)

### Frontend (Teacher Materials Workspace)
- `payload/views/materials.ejs`
  - Add/upload/save/delete material UI.
  - Key anchors:
    - `add-material-form` (~line 35)
    - `batch-material-select` (~line 42)
    - `file-upload-input` (~line 52)
    - `uploadFileWithProgress` (~line 156)
    - `loadMaterials` (~line 230)
    - `materialForm.onsubmit` (~line 252)
    - `window.deleteMaterial` (~line 325)

### Shared Tab Engine
- `payload/public/js/modules/zen_pillars.js`
  - Tab activation and section show/hide behavior.
  - Key anchors:
    - `class ZenPillars` (~line 7)
    - section query uses direct child selector `#zen-sections > .zen-section` (~line 91)

## 2) API Contracts (Current)

### Materials

#### `POST /api/materials/upload`
- Auth: staff (`isAuthenticated`)
- Input: multipart/form-data (`file`)
- Output:
```json
{
  "status": "success",
  "file": {
    "url": "/materials/<stored_file>",
    "name": "<original_name>",
    "stored_name": "<stored_name>",
    "size": 12345,
    "mimetype": "application/pdf"
  }
}
```

#### `POST /api/materials`
- Auth: staff
- Input JSON:
```json
{
  "title": "Chapter 1 Notes",
  "batch_id": "12",
  "description": "optional",
  "file_path": "/materials/ch1_123.pdf"
}
```
- Notes:
  - `batch_id` or `batch_name` is accepted (`resolveMaterialBatchId` handles both).
  - Batch is mandatory.
  - `file_path` must be `/materials/...` or full `http/https` URL.
- Output:
```json
{
  "status": "success",
  "material": { "...normalized material row..." }
}
```

#### `GET /api/materials`
- Auth: staff
- Output:
```json
{
  "status": "success",
  "materials": [ ... ]
}
```

#### `GET /api/student/materials`
- Auth: student
- Uses resolved student batches (`getStudentSessionBatchesResolved`).
- Output:
```json
{
  "status": "success",
  "materials": [ ... ]
}
```

### Notices

#### `POST /api/notices`
- Auth: staff
- Input:
```json
{
  "title": "Holiday",
  "content": "Class closed",
  "target_batch": "ALL | exact batch name"
}
```
- Behavior:
  - Persists to `notices`.
  - Creates direct `notifications` rows for target students.
  - Emits live update events (`student_notice`, `notice_update`).
  - Sends push (if subscribed).

#### `GET /api/student/notices`
- Auth: student
- Returns merged, deduped list of batch notices and direct notice notifications.

#### `GET /api/student/notices/:id`
- Auth: student
- Returns full notice detail only if assigned to student batch (or `ALL`).

## 3) Live Update Model (Current)

- Transport is SSE (not WebSocket):
  - `GET /api/live/stream`
- Client listener:
  - `student_portal.ejs -> initLiveUpdates()`
- Events currently used:
  - `material_update`
  - `notice_update`
  - `student_notice`
  - attendance/system events (`attendance_notice`, `absence_alert`, `system_reset`)

## 4) Known Pitfalls and Recovery

### Pitfall A: Tab shows blank but API is returning data
- Root cause pattern: invalid section nesting in `student_portal.ejs`.
- `ZenPillars` only toggles direct children of `#zen-sections`:
  - selector: `#zen-sections > .zen-section`
- If one section is accidentally nested inside another, hiding parent hides child tabs.
- Check:
  - Ensure each `section-*` div closes before next section starts.

### Pitfall B: Materials visible in API but not UI
- Verify UI expects object shape:
  - `payload.materials` (new contract), not raw array only.
- Confirm `renderMaterialItems(materials)` is called.
- Confirm tab active state triggers `loadMaterialsSection()` on enter.

### Pitfall C: Batch mismatch
- Teacher can send batch by ID or name.
- Backend resolves to canonical `batches.id`.
- Student retrieval uses resolved batch names from session/index.
- If mismatch suspected:
  - inspect `batches` table names
  - inspect student `master_student_index.batch_name`
  - inspect `materials.batch_id` foreign mapping

### Pitfall D: Session close appears blocked
- Close now prioritizes session status update and queues weekly report generation afterward.
- If close fails, inspect `closeSessionById` transaction area and DB lock state.

## 5) Fast Debug Playbooks

### Materials end-to-end
1. Teacher: upload file (`POST /api/materials/upload`) -> must return `file.url`.
2. Teacher: save material (`POST /api/materials`) -> must return `status=success`.
3. Staff list (`GET /api/materials`) should include row with correct `batch_name`.
4. Student list (`GET /api/student/materials`) should include same row for assigned batch.
5. Student UI: Materials tab should render cards in `#material-list`.

### Notices end-to-end
1. Teacher send (`POST /api/notices`) with exact target batch.
2. Student fetch list (`GET /api/student/notices`) should include row.
3. Student click detail (`GET /api/student/notices/:id`) should return full content.
4. Optional: verify direct notification row exists in `notifications`.

### Tab structure sanity check
1. Open `student_portal.ejs`.
2. Validate section order and balanced divs:
   - `section-identity`
   - `section-materials`
   - `section-notices`
   - `section-scoreboard`
3. Ensure all are siblings directly under `#zen-sections`.

## 6) Recommended Change Workflow

1. Update backend route contract first.
2. Update frontend fetch consumer shape immediately after.
3. Run one student role flow + one staff role flow.
4. Verify tab visibility and API response shape together (UI and network tab).
5. Keep this guide updated whenever endpoint shapes or tab layout change.

## 7) Android-First UI Blueprint (Student + Teacher)

This is the canonical layout contract for mobile work. If UI changes violate these rules, tabs and small-screen behavior will regress.

### Student portal layout contract
- File: `payload/views/student_portal.ejs`
- Mobile structure:
  1. Sticky compact header (identity + batch + live test indicator)
  2. Main content container (`#zen-sections`) with direct-child sections only
  3. Bottom navigation (`#mobile-bottom-nav`) for thumb-reach tab switching
- Current section ids that must remain direct children of `#zen-sections`:
  - `section-identity`
  - `section-tests`
  - `section-materials`
  - `section-notices`
  - `section-scoreboard`

### Student state-driven rendering contract
- Client state (in `student_portal.ejs`):
```js
studentState = {
  mode: "normal" | "test_locked" | "taking_test" | "result",
  activeSessionId: null,
  batch: "<resolved batch name>"
}
```
- UI behavior:
  - `normal`: all tabs enabled
  - `test_locked` / `taking_test`: show lock overlay, show live indicator, hide bottom nav, force tests section
  - `result`: allow scoreboard and test history

### Student live event contract (SSE)
- Stream: `GET /api/live/stream`
- Events consumed by student UI:
  - `material_update`
  - `notice_update`
  - `student_notice`
  - `test_started`
  - `test_locked` / `test_force_locked`
  - `test_submitted`
  - `test_closed` / `test_ended`

### Teacher mobile comfort rules
- File: `payload/views/dashboard_teacher.ejs`
- Tabs should not feel floating/crowded on phones:
  - hide pill icons on small screens
  - reduce pill padding
  - switch to compact grid layout at very small widths
  - avoid over-animated transforms on mobile tabs

## 8) Test System Integration Index

This section maps the implementation target for the full test engine lifecycle.

### Required lifecycle
1. Paper creation
2. Multi-question authoring
3. Batch assignment
4. Scheduled/forced launch
5. Attempt autosave + resume
6. Submission + scoring
7. Absence report
8. Leaderboard (session + cumulative)

### Target backend surface
- Teacher:
  - `POST /api/tests/papers`
  - `GET /api/tests/papers`
  - `GET /api/tests/papers/:id`
  - `PATCH /api/tests/papers/:id`
  - `DELETE /api/tests/papers/:id`
  - `POST /api/tests/papers/:id/questions`
  - `PATCH /api/tests/questions/:questionId`
  - `DELETE /api/tests/questions/:questionId`
  - `POST /api/tests/papers/:id/questions/reorder`
  - `POST /api/tests/papers/:id/assign`
  - `POST /api/tests/sessions/:id/start`
  - `POST /api/tests/sessions/:id/pause`
  - `POST /api/tests/sessions/:id/resume`
  - `POST /api/tests/sessions/:id/close`
  - `GET /api/tests/sessions/:id/report`
  - `GET /api/tests/sessions/:id/absentees`
  - `GET /api/tests/sessions/:id/leaderboard`
  - `GET /api/tests/sessions/:id/submissions`
- Student:
  - `GET /api/student/tests`
  - `GET /api/student/tests/:sessionId`
  - `POST /api/student/tests/:sessionId/start`
  - `POST /api/student/tests/:sessionId/answer`
  - `POST /api/student/tests/:sessionId/submit`
  - `GET /api/student/tests/:sessionId/status`
  - `GET /api/student/tests/:sessionId/leaderboard`

### Non-negotiable backend enforcement
- Mandatory tests must be enforced server-side, not only hidden in frontend.
- Non-test student API requests should return controlled lock response while test lock is active (for example `409 TEST_LOCKED`).
- Correct answers must never be sent to student before submission/finalization.

### Data model baseline
- `test_papers`
- `test_questions`
- `test_options`
- `test_assignments`
- `test_sessions`
- `student_test_attempts`
- `test_responses`
- `test_absence_reports`
- optional: `test_leaderboard_cache`
