-- CreateTable
CREATE TABLE "exam_gate_sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "exam_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "uid_snapshot" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "qr_token_hash" TEXT NOT NULL,
    "qr_expires_at" DATETIME NOT NULL,
    "gate_status" TEXT NOT NULL DEFAULT 'WAITING_FOR_SCAN',
    "device_bind_status" TEXT NOT NULL DEFAULT 'UNBOUND',
    "paper_download_status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "verified_by_teacher_id" INTEGER,
    "verified_at" DATETIME,
    "attempt_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exam_gate_sessions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exam_gate_sessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exam_gate_sessions_verified_by_teacher_id_fkey" FOREIGN KEY ("verified_by_teacher_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "exam_gate_sessions_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "exam_attempt_violations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "exam_id" INTEGER NOT NULL,
    "attempt_id" INTEGER,
    "gate_session_id" INTEGER,
    "student_id" INTEGER NOT NULL,
    "device_id" TEXT,
    "violation_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT,
    "metadata_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exam_attempt_violations_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exam_attempt_violations_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "exam_attempt_violations_gate_session_id_fkey" FOREIGN KEY ("gate_session_id") REFERENCES "exam_gate_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "exam_attempt_violations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_exams" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "batch_id" INTEGER,
    "question_paper_id" INTEGER,
    "question_paper_version_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "exam_mode" TEXT NOT NULL DEFAULT 'LIVE',
    "duration_seconds" INTEGER NOT NULL,
    "instructions" TEXT,
    "solution_release_policy" TEXT NOT NULL,
    "exam_date_time" DATETIME,
    "published_at" DATETIME,
    "closed_at" DATETIME,
    "result_released_at" DATETIME,
    "started_at" DATETIME,
    "manually_started_by" INTEGER,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exams_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "exams_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "exams_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "exams_manually_started_by_fkey" FOREIGN KEY ("manually_started_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "exams_question_paper_id_fkey" FOREIGN KEY ("question_paper_id") REFERENCES "question_papers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "exams_question_paper_version_id_fkey" FOREIGN KEY ("question_paper_version_id") REFERENCES "question_paper_versions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_exams" ("batch_id", "closed_at", "created_at", "created_by", "duration_seconds", "exam_date_time", "exam_mode", "id", "instructions", "published_at", "question_paper_id", "question_paper_version_id", "result_released_at", "solution_release_policy", "status", "title", "updated_at", "updated_by") SELECT "batch_id", "closed_at", "created_at", "created_by", "duration_seconds", "exam_date_time", "exam_mode", "id", "instructions", "published_at", "question_paper_id", "question_paper_version_id", "result_released_at", "solution_release_policy", "status", "title", "updated_at", "updated_by" FROM "exams";
DROP TABLE "exams";
ALTER TABLE "new_exams" RENAME TO "exams";
CREATE INDEX "exams_batch_id_status_idx" ON "exams"("batch_id", "status");
CREATE INDEX "exams_status_exam_date_time_idx" ON "exams"("status", "exam_date_time");
CREATE INDEX "exams_created_by_created_at_idx" ON "exams"("created_by", "created_at");
CREATE INDEX "exams_question_paper_id_idx" ON "exams"("question_paper_id");
CREATE INDEX "exams_question_paper_version_id_idx" ON "exams"("question_paper_version_id");
CREATE INDEX "exams_started_at_idx" ON "exams"("started_at");
CREATE INDEX "exams_manually_started_by_idx" ON "exams"("manually_started_by");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "exam_gate_sessions_attempt_id_key" ON "exam_gate_sessions"("attempt_id");

-- CreateIndex
CREATE INDEX "exam_gate_sessions_exam_id_idx" ON "exam_gate_sessions"("exam_id");

-- CreateIndex
CREATE INDEX "exam_gate_sessions_student_id_idx" ON "exam_gate_sessions"("student_id");

-- CreateIndex
CREATE INDEX "exam_gate_sessions_qr_token_hash_idx" ON "exam_gate_sessions"("qr_token_hash");

-- CreateIndex
CREATE INDEX "exam_gate_sessions_attempt_id_idx" ON "exam_gate_sessions"("attempt_id");

-- CreateIndex
CREATE INDEX "exam_gate_sessions_verified_by_teacher_id_idx" ON "exam_gate_sessions"("verified_by_teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_gate_sessions_exam_id_student_id_key" ON "exam_gate_sessions"("exam_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_gate_sessions_exam_id_device_id_key" ON "exam_gate_sessions"("exam_id", "device_id");

-- CreateIndex
CREATE INDEX "exam_attempt_violations_exam_id_created_at_idx" ON "exam_attempt_violations"("exam_id", "created_at");

-- CreateIndex
CREATE INDEX "exam_attempt_violations_attempt_id_idx" ON "exam_attempt_violations"("attempt_id");

-- CreateIndex
CREATE INDEX "exam_attempt_violations_gate_session_id_idx" ON "exam_attempt_violations"("gate_session_id");

-- CreateIndex
CREATE INDEX "exam_attempt_violations_student_id_created_at_idx" ON "exam_attempt_violations"("student_id", "created_at");
